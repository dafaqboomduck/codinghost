const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Returns a list of problems. Also normalizes small issues in place (hidden flags, test count).
function exerciseProblems(ex) {
  const problems = [];
  if (!ex || typeof ex !== "object") return ["The exercise is not an object."];
  for (const f of ["title", "concept", "prompt_md", "hint_md", "function_name", "starter_code", "reference_solution"]) {
    if (typeof ex[f] !== "string" || !ex[f].trim()) problems.push(`Field "${f}" is missing or empty.`);
  }
  if (typeof ex.function_name === "string" && !IDENT.test(ex.function_name)) problems.push(`"function_name" is not a valid Python name.`);
  if (!Array.isArray(ex.tests)) {
    problems.push(`"tests" is not a list.`);
    return problems;
  }
  ex.tests = ex.tests.filter((t) => t && typeof t.args_py === "string" && typeof t.expected_py === "string")
    .map((t) => ({ args_py: t.args_py, expected_py: t.expected_py, hidden: !!t.hidden }));
  if (ex.tests.length > 6) {
    const hidden = ex.tests.filter((t) => t.hidden);
    const visible = ex.tests.filter((t) => !t.hidden);
    ex.tests = visible.slice(0, Math.max(2, 6 - Math.min(hidden.length, 2))).concat(hidden.slice(0, 2)).slice(0, 6);
  }
  if (ex.tests.length < 3) problems.push("It needs at least 3 tests.");
  else {
    if (!ex.tests.some((t) => t.hidden)) ex.tests[ex.tests.length - 1].hidden = true;
    if (ex.tests.filter((t) => !t.hidden).length < 1) ex.tests[0].hidden = false;
  }
  return problems;
}

const STRING_LITERAL = /^(['"]).*\1$/;

// Inline code in the task that also appears in the reference solution gives the answer away,
// like `r"\d+"` or `n % 2 == 0`. Plain names and plain strings are skipped: the task has to name
// the function and its parameters, and values like `None` or `'even'` are part of the spec.
function leakProblems(ex) {
  const problems = [];
  const leaks = (ex.prompt_md.match(/`[^`\n]+`/g) || [])
    .map((span) => span.slice(1, -1).trim())
    .filter((code) => code.length >= 3 && !code.includes(ex.function_name) && !IDENT.test(code) && !STRING_LITERAL.test(code))
    .filter((code) => ex.reference_solution.includes(code));
  if (leaks.length) problems.push(`"prompt_md" gives away part of the solution: ${leaks.map((c) => "`" + c + "`").join(", ")}. Describe only the behavior, and leave the tool to the lesson and "hint_md".`);
  return problems;
}

// An example that uses the exercise's function, or repeats a line of its solution, shows the answer one screen early.
// Short lines like `return result` are skipped: they appear in almost any example.
function exampleLeaks(code, ex) {
  if (code.includes(ex.function_name)) return true;
  const lines = new Set(code.split("\n").map((l) => l.trim()));
  return ex.reference_solution.split("\n").slice(1).map((l) => l.trim()).some((l) => l.length >= 10 && lines.has(l));
}

// Keeps the lessons that still have exercises, groups exercises under their lesson in lesson order,
// and drops examples that leak. Renumbers lessons to l1, l2, ... A plan without lessons stays without.
function shapeLessons(raw, exercises) {
  const lessons = (Array.isArray(raw.lessons) ? raw.lessons : []).filter((l) => l && typeof l.id === "string" && typeof l.title === "string");
  if (!lessons.length) {
    exercises.forEach((ex) => { delete ex.lesson_id; });
    return [];
  }
  const ids = new Set(lessons.map((l) => l.id));
  // An unknown lesson_id joins the lesson of the exercise before it, so the course still reads lesson, then its exercises.
  let prev = lessons[0].id;
  for (const ex of exercises) {
    if (!ids.has(ex.lesson_id)) ex.lesson_id = prev;
    prev = ex.lesson_id;
  }
  const groups = lessons.map((l) => ({ lesson: l, exercises: exercises.filter((ex) => ex.lesson_id === l.id) })).filter((g) => g.exercises.length);
  // Assign the new ids only after grouping: an old "l2" renamed to "l1" would otherwise collide with the old "l1".
  exercises.splice(0, exercises.length, ...groups.flatMap((g) => g.exercises));
  return groups.map((g, i) => {
    const id = "l" + (i + 1);
    g.exercises.forEach((ex) => { ex.lesson_id = id; });
    const examples = (Array.isArray(g.lesson.examples) ? g.lesson.examples : [])
      .filter((e) => e && typeof e.code === "string" && e.code.trim())
      .map((e) => ({ code: e.code.replace(/\s+$/, ""), note: typeof e.note === "string" ? e.note : "" }))
      .filter((e) => !g.exercises.some((ex) => exampleLeaks(e.code, ex)));
    return { id, title: g.lesson.title, intro_md: typeof g.lesson.intro_md === "string" ? g.lesson.intro_md : "", examples };
  });
}

function failureText(res) {
  if (res.error) return "Running the reference solution raised: " + res.error;
  const bad = (res.results || []).filter((r) => r.status !== "pass");
  return bad.map((r) => {
    if (r.status === "fail") return `Test args ${r.args}: reference solution returned ${r.actual}, but expected_py is ${r.expected}.`;
    return `Test args ${r.args}: ${r.message}`;
  }).join("\n");
}

// Shape check, run the reference solution against all tests, then a leak check. One repair call per flagged exercise.
// Returns { exercises, lessons } with both renumbered.
async function validatePlan(raw, level, report, signal) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.exercises)) throw { code: "invalid_json", message: "The plan has no exercise list." };
  const kept = [];
  for (let i = 0; i < raw.exercises.length; i++) {
    let ex = raw.exercises[i];
    const label = (ex && ex.title) || "Exercise " + (i + 1);
    report(i, "active", label, "Checking the reference solution against its tests");
    let check = await checkExercise(ex);
    if (check && !signal.aborted) {
      report(i, "active", label, check.hard ? "Check failed, asking Claude for a fix" : "Task gives the answer away, asking Claude for a rewrite");
      try {
        const fixed = await ai.repairExercise(ex, check.hard || check.soft, level, { signal });
        const after = await checkExercise(fixed);
        // A working exercise that still leaks beats dropping it, so only a hard failure keeps the original.
        if (!after || !after.hard) { ex = fixed; check = after; }
        else if (check.hard) check = after;
      } catch (e) {
        if (e && e.code === "cancelled") throw e;
        if (check.hard) check = { hard: check.hard + " (repair failed: " + aiErrorMessage(e) + ")" };
      }
    }
    if (signal.aborted) throw { code: "cancelled", message: "Cancelled." };
    if (check && check.hard) {
      report(i, "fail", label, "Dropped: " + check.hard.split("\n")[0]);
    } else {
      report(i, "done", ex.title, `Reference solution passes all ${ex.tests.length} tests`);
      kept.push(ex);
    }
  }
  const lessons = shapeLessons(raw, kept);
  kept.forEach((ex, i) => { ex.id = "ex" + (i + 1); });
  return { exercises: kept, lessons };
}

// Returns null, { hard } for an exercise that cannot be used, or { soft } for one that works but gives the answer away.
async function checkExercise(ex) {
  const problems = exerciseProblems(ex);
  if (problems.length) return { hard: problems.join(" ") };
  const res = await runner.run(ex.reference_solution, ex.function_name, ex.tests, 8000, { purpose: "validate", exercise: ex.id || ex.title });
  const ok = !res.error && res.results.length === ex.tests.length && res.results.every((r) => r.status === "pass");
  if (!ok) return { hard: failureText(res) };
  const leaks = leakProblems(ex);
  return leaks.length ? { soft: leaks.join(" ") } : null;
}
