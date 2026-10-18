const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Returns a list of problems. Also normalizes small issues in place (hidden flags, test count).
function exerciseProblems(ex) {
  const problems = [];
  if (!ex || typeof ex !== "object") return ["The exercise is not an object."];
  for (const f of ["title", "concept", "prompt_md", "function_name", "starter_code", "reference_solution"]) {
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

function failureText(res) {
  if (res.error) return "Running the reference solution raised: " + res.error;
  const bad = (res.results || []).filter((r) => r.status !== "pass");
  return bad.map((r) => {
    if (r.status === "fail") return `Test args ${r.args}: reference solution returned ${r.actual}, but expected_py is ${r.expected}.`;
    return `Test args ${r.args}: ${r.message}`;
  }).join("\n");
}

// Shape check, then run the reference solution against all tests. One repair call per failed exercise.
async function validatePlan(raw, level, report, signal) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.exercises)) throw { code: "invalid_json", message: "The plan has no exercise list." };
  const kept = [];
  for (let i = 0; i < raw.exercises.length; i++) {
    let ex = raw.exercises[i];
    const label = (ex && ex.title) || "Exercise " + (i + 1);
    report(i, "active", label, "Checking the reference solution against its tests");
    let problem = await checkExercise(ex);
    if (problem && !signal.aborted) {
      report(i, "active", label, "Check failed, asking Claude for a fix");
      try {
        const fixed = await ai.repairExercise(ex, problem, level, { signal });
        problem = await checkExercise(fixed);
        if (!problem) ex = fixed;
      } catch (e) {
        if (e && e.code === "cancelled") throw e;
        problem = problem + " (repair failed: " + aiErrorMessage(e) + ")";
      }
    }
    if (signal.aborted) throw { code: "cancelled", message: "Cancelled." };
    if (problem) {
      report(i, "fail", label, "Dropped: " + problem.split("\n")[0]);
    } else {
      report(i, "done", ex.title, `Reference solution passes all ${ex.tests.length} tests`);
      kept.push(ex);
    }
  }
  kept.forEach((ex, i) => { ex.id = "ex" + (i + 1); });
  return kept;
}

async function checkExercise(ex) {
  const problems = exerciseProblems(ex);
  if (problems.length) return problems.join(" ");
  const res = await runner.run(ex.reference_solution, ex.function_name, ex.tests, 8000, { purpose: "validate", exercise: ex.id || ex.title });
  const ok = !res.error && res.results.length === ex.tests.length && res.results.every((r) => r.status === "pass");
  return ok ? null : failureText(res);
}
