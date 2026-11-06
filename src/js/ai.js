// ai: plan generation, repair and tutoring through sample

const ai = (() => {
  let sample = null;
  let limits = null;

  // The parts of the prompts that differ by language. The snippets go into JSON strings in the
  // prompt, so they are template literals with the JSON escapes written out (\\n, \\").
  const TEXT = {
    python: {
      course: "Python",
      fence: "python",
      pageTool: "len()",
      example: `words = ['hi', 'hello']\\nprint(len(words))  # 2`,
      fnName: "snake_case_name",
      starter: `def snake_case_name(a, b):\\n    \\"\\"\\"One-line docstring.\\"\\"\\"\\n    pass\\n`,
      solution: `def snake_case_name(a, b):\\n    return a + b\\n`,
      test: `"args_py": "(2, 3)", "expected_py": "5"`,
      runtime: "The learner's code runs in Pyodide in the browser with only the Python standard library. No third-party package can be installed.",
      unsupported: `Then decide whether the topic is about a package outside the standard library (for example numpy, pandas, requests, flask, django, matplotlib or pygame). If it is, do not write a plan. Reply with only this JSON object:
{"unsupported_package": "the package name", "suggestion": "a related topic that needs only the standard library"}
A general topic such as "data analysis" or "web scraping basics" is fine: write it with the standard library (csv, statistics, json, re, html.parser and so on).`,
      exercise: `- Every exercise asks the learner to write ONE function, named in "function_name". No classes, no input(), no printing required, no files or network. Standard library only: never import a third-party package.
- "starter_code" is the def line with its parameters, a one-line docstring, and \`pass\`.`,
      literals: `- "args_py" is a Python tuple literal of the positional arguments, for example "(2, 3)", or "([1, 2, 3],)" for one argument. "expected_py" is a Python literal of the return value. Use only literals: numbers, strings, booleans, None, lists, tuples, dicts, sets.
- Avoid float results unless the task says to round with round(x, 2). Avoid results with undefined order: ask for sorted lists instead.`,
      exampleRule: "prints its results, with the printed output in a comment after each print",
      idiom: "more idiomatic Python",
    },
    javascript: {
      course: "JavaScript",
      fence: "js",
      pageTool: ".map()",
      example: `const words = ['hi', 'hello'];\\nconsole.log(words.length);  // 2`,
      fnName: "camelCaseName",
      starter: `function camelCaseName(a, b) {\\n  // One-line description of what it returns.\\n}\\n`,
      solution: `function camelCaseName(a, b) {\\n  return a + b;\\n}\\n`,
      test: `"args_js": "[2, 3]", "expected_js": "5"`,
      runtime: "The learner's code runs in a Web Worker in the browser: plain modern JavaScript only. There is no DOM, no Node.js API (fs, http, process, require) and no npm package.",
      unsupported: `Then decide whether the topic is about a library, framework or API outside the core language (for example React, Vue, jQuery, Express, lodash, Node.js modules such as fs or http, the DOM, or fetch). If it is, do not write a plan. Reply with only this JSON object:
{"unsupported_package": "the library or API name", "suggestion": "a related topic that needs only core JavaScript"}
A general topic such as "data processing" or "text parsing" is fine: write it with core JavaScript (arrays, objects, strings, Map, Set, JSON, RegExp, Math and so on).`,
      exercise: `- Every exercise asks the learner to write ONE function, declared with \`function\` and named in "function_name" in camelCase. No classes, no prompt() or alert(), no console output required, no DOM, files, network, timers, or async code. Core JavaScript only: never import or require a module.
- "starter_code" is the function declaration with its parameters, a one-line comment that says what it returns, and an otherwise empty body.`,
      literals: `- "args_js" is a JavaScript array literal of the arguments, for example "[2, 3]", or "[[1, 2, 3]]" for one array argument. "expected_js" is a JavaScript literal of the return value. Use only literals: numbers, strings, booleans, null, arrays and plain objects. Never undefined, NaN, functions, Map, Set or Date. Results are compared with deep equality; object key order does not matter.
- Avoid float results unless the task says to round, for example to 2 decimals with Math.round(x * 100) / 100. Avoid results with undefined order: ask for sorted arrays instead.`,
      exampleRule: "logs its results with console.log, with the logged output in a comment after each call",
      idiom: "more idiomatic modern JavaScript",
    },
  };
  const textOf = (lang) => TEXT[lang.id];

  const planShape = (t) => `{
"topic": "string",
"level": "beginner | intermediate | advanced",
"summary": "1-2 sentences on what the learner practices",
"lessons": [
  {
    "id": "l1",
    "title": "short title",
    "pages": [
      {
        "title": "the one tool this page teaches, for example ${t.pageTool}",
        "body_md": "1 to 3 sentences of Markdown on what the tool does",
        "examples": [
          { "code": "${t.example}", "note": "one sentence on what to notice" }
        ]
      }
    ]
  }
],
"exercises": [
  {
    "id": "ex1",
    "lesson_id": "l1",
    "title": "short title",
    "concept": "the one concept this exercise practices",
    "prompt_md": "the task in Markdown",
    "hint_md": "a first hint in Markdown, shown only when the learner asks",
    "function_name": "${t.fnName}",
    "starter_code": "${t.starter}",
    "reference_solution": "${t.solution}",
    "tests": [
      { ${t.test}, "hidden": false }
    ]
  }
]
}`;

  const RULES = (t, level) => `Rules:
${t.exercise}
- "reference_solution" is a complete, correct implementation of the same function.
- 3 to 6 tests per exercise: at least 2 with "hidden": false and at least 1 with "hidden": true. The app shows the visible tests below the task as its examples, so the first visible test is a typical case, not an edge case.
${t.literals}
- "prompt_md" explains the task in 2 to 5 sentences of Markdown. It names the function and its parameters and says what it returns. Do not include example calls or "for example": the visible tests already show them. It describes only the behavior: never name the function, method, pattern or expression that solves it, and never show part of the solution.
- "hint_md" is 1 or 2 sentences that point toward the right tool or idea from the exercise's lesson, without code.
- Write for a ${level} learner.`;

  const LESSON_RULES = (t, count) => `Lesson rules:
- Write ${Math.ceil(count / 2)} lessons. The learner reads a lesson on its own screen, then solves its exercises without the lesson in view.
- A lesson has 2 to 4 pages, shown one at a time. Each page teaches exactly ONE function, method or piece of syntax, named in its "title".
- Every tool an exercise needs has its own page, in the exercise's lesson or an earlier one. Never mention a tool in passing, for example in a list of "useful pieces", without giving it a page.
- "body_md" is 1 to 3 sentences on what the tool does and when to use it.
- 1 or 2 examples per page. Each "code" is a short snippet of at most 6 lines that ${t.exampleRule}. Each "note" says in one sentence what to notice.
- Examples solve DIFFERENT problems than the exercises, so the learner must adapt them, not copy them. Never use an exercise's function name or any line of its solution.
- Order "exercises" lesson by lesson. Each exercise's "lesson_id" is the lesson it practices. Give each lesson 1 or 2 exercises, easiest first.`;

  function planPrompt(lang, topic, level, count) {
    const t = textOf(lang);
    return `You write short ${t.course} practice courses for an in-browser coding tutor.

Topic: ${topic}
Learner level: ${level}
Number of exercises: ${count}

${t.runtime}

First decide whether the topic names something a programming course can teach. A short broad topic such as "loops" or "strings" is fine: pick a sensible scope. If the input is a greeting, small talk, a question unrelated to programming, gibberish, or too vague to choose a subject (for example "hello", "how are you doing" or "stuff"), do not write a plan. Reply with only this JSON object:
{"not_a_topic": true}

${t.unsupported}

Otherwise write a short course about the topic: lessons, each followed by its exercises, exactly ${count} exercises in total, ordered from easiest to hardest. Each exercise practices one concept. Use ids "l1", "l2" for lessons and "ex1", "ex2" for exercises.

Reply with only one JSON object of this shape:
${planShape(t)}

${LESSON_RULES(t, count)}

${RULES(t, level)}`;
  }

  function repairPrompt(lang, ex, problem, level) {
    const t = textOf(lang);
    return `This exercise for a ${t.course} practice course failed an automatic check.

Problem: ${problem}

Exercise JSON:
${JSON.stringify(ex, null, 2)}

Fix the exercise so that its "reference_solution" passes every test and all rules hold. Fix whichever part is wrong: the tests, the solution, or the task text. Keep the same "id", "lesson_id" and topic.

${RULES(t, level)}

Reply with only the corrected exercise as one JSON object with the same fields as above.`;
  }

  function summarizeRun(lang, run, exercise) {
    if (!run) return "Not run yet.";
    const parts = [];
    if (run.error) parts.push("Error:\n" + run.error);
    const visible = (run.results || []).filter((r) => !r.hidden);
    const failed = visible.filter((r) => r.status !== "pass");
    const hiddenFailed = (run.results || []).filter((r) => r.hidden && r.status !== "pass").length;
    if (run.results && run.results.length) {
      parts.push(`${(run.results || []).filter((r) => r.status === "pass").length} of ${run.results.length} tests passed.`);
    }
    for (const r of failed) {
      const call = lang.call(exercise.function_name, r.args);
      if (r.status === "fail") parts.push(`${call} returned ${r.actual}, expected ${r.expected}`);
      else parts.push(`${call} raised:\n${r.message}`);
    }
    if (hiddenFailed) parts.push(`${hiddenFailed} hidden test(s) failed (inputs not shown).`);
    if (run.stdout) parts.push("Printed output:\n" + run.stdout.slice(0, 1500));
    return parts.join("\n\n") || "All tests passed.";
  }

  function helpPrompt({ lang, exercise, lesson, code, run, level, question, shownHint }) {
    const t = textOf(lang);
    return `You are a patient ${t.course} tutor inside a practice app. The learner is working on one exercise and asked for help.

How to answer:
- This is hint level ${level} of 3. Level 1: a conceptual nudge, no code. Level 2: point at the specific line or mistake in their code, without giving fixed code. Level 3: a small code fragment of at most 3 lines that shows the idea, not the whole function.
- Never write the complete solution, unless the learner's question explicitly asks for the full solution.
- If their code raised an error, first explain the error message in plain words.
- If their code already looks correct, say so and suggest what to check.
- Keep it under 120 words. Use Markdown and put code in backticks.

Exercise: ${exercise.title}
Concept: ${exercise.concept}
Task:
${exercise.prompt_md}
${lesson ? `
The learner read this lesson before the exercise. Point back to it when it helps:
${lesson.title}
${lessonPages(lesson).flatMap((p) => p.examples.map((e) => e.code)).join("\n\n")}
` : ""}${shownHint ? `
The learner already read this hint, so go further than it:
${exercise.hint_md}
` : ""}
Learner's code:
\`\`\`${t.fence}
${code}
\`\`\`

Last run:
${summarizeRun(lang, run, exercise)}

Learner's question: ${question ? question : "(none) Give the next hint."}`;
  }

  function reviewPrompt({ lang, exercise, code, level }) {
    const t = textOf(lang);
    return `You review code in a ${t.course} practice app. The learner's code below already passes every test. Help them write it better next time.

How to answer:
- Start with one sentence on what their code does well.
- Then give at most 2 concrete improvements, most valuable first: ${t.idiom}, clearer names, simpler logic, an edge case the tests miss, or efficiency.
- The learner is ${level}. Do not push advanced features on a beginner unless they make the code much simpler.
- If a change helps, show the improved function in one \`\`\`${t.fence} block.
- If their code is already clean and idiomatic, say so in one or two sentences. Do not invent problems.
- Keep it under 150 words. Use Markdown and put code in backticks.

Exercise: ${exercise.title}
Concept: ${exercise.concept}
Task:
${exercise.prompt_md}

Learner's passing code:
\`\`\`${t.fence}
${code}
\`\`\`

One correct solution, for your comparison only (theirs may be just as good):
\`\`\`${t.fence}
${exercise.reference_solution}
\`\`\``;
  }

  async function checkSize(prompt) {
    try { limits = limits || (await sample.limits()); } catch (e) { limits = { maxPromptBytes: Infinity }; }
    const bytes = new TextEncoder().encode(prompt).length;
    if (bytes > limits.maxPromptBytes) throw { code: "prompt_too_large", message: "This request is too long to send to Claude. Shorten your code or question." };
  }

  return {
    init(s) { sample = s; },
    get available() { return !!sample; },
    async generatePlan(lang, topic, level, count, opts) {
      const prompt = planPrompt(lang, topic, level, count);
      await checkSize(prompt);
      return sample.json(prompt, Object.assign({ modelTier: "complex" }, opts));
    },
    async repairExercise(lang, ex, problem, level, opts) {
      const prompt = repairPrompt(lang, ex, problem, level);
      await checkSize(prompt);
      return sample.json(prompt, Object.assign({ modelTier: "default" }, opts));
    },
    async help(args, opts) {
      const prompt = helpPrompt(args);
      await checkSize(prompt);
      return sample(prompt, Object.assign({ modelTier: "default", cache: false }, opts));
    },
    async review(args, opts) {
      const prompt = reviewPrompt(args);
      await checkSize(prompt);
      return sample(prompt, Object.assign({ modelTier: "default" }, opts));
    },
  };
})();

function aiErrorMessage(e) {
  const code = e && e.code;
  dbg.log("ai_error", { code: code || null, message: (e && e.message) || String(e) });
  if (code === "not_granted") return "Claude access was declined for this page. Reload the page to allow it.";
  if (code === "rate_limited" || code === "queue_overflow") return "Slow down, try again in a minute.";
  if (code === "invalid_json") return "Claude's reply was not usable plan data. Try again.";
  if (code === "prompt_too_large") return e.message;
  if (code === "cancelled") return "Cancelled.";
  if (code === "refused") return "Claude declined this request. Try a different topic.";
  if (code === "session_expired") return "Your claude.ai session expired. Reload the page.";
  return "Claude could not answer: " + ((e && e.message) || String(e));
}
