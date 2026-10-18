// ai: plan generation, repair and tutoring through sample

const ai = (() => {
  let sample = null;
  let limits = null;

  const PLAN_SHAPE = `{
"topic": "string",
"level": "beginner | intermediate | advanced",
"summary": "1-2 sentences on what the learner practices",
"exercises": [
  {
    "id": "ex1",
    "title": "short title",
    "concept": "the one concept this exercise teaches",
    "prompt_md": "the task in Markdown",
    "function_name": "snake_case_name",
    "starter_code": "def snake_case_name(a, b):\\n    \\"\\"\\"One-line docstring.\\"\\"\\"\\n    pass\\n",
    "reference_solution": "def snake_case_name(a, b):\\n    return a + b\\n",
    "tests": [
      { "args_py": "(2, 3)", "expected_py": "5", "hidden": false }
    ]
  }
]
}`;

  const RULES = (level) => `Rules:
- Every exercise asks the learner to write ONE function, named in "function_name". No classes, no input(), no printing required, no files or network. Standard library only.
- "starter_code" is the def line with its parameters, a one-line docstring, and \`pass\`.
- "reference_solution" is a complete, correct implementation of the same function.
- 3 to 6 tests per exercise: at least 2 with "hidden": false and at least 1 with "hidden": true.
- "args_py" is a Python tuple literal of the positional arguments, for example "(2, 3)", or "([1, 2, 3],)" for one argument. "expected_py" is a Python literal of the return value. Use only literals: numbers, strings, booleans, None, lists, tuples, dicts, sets.
- Avoid float results unless the task says to round with round(x, 2). Avoid results with undefined order: ask for sorted lists instead.
- "prompt_md" explains the task in 2 to 5 sentences of Markdown. It names the function and its parameters, says what it returns, and shows one example call in inline code.
- Write for a ${level} learner.`;

  function planPrompt(topic, level, count) {
    return `You write short Python practice courses for an in-browser coding tutor.

Topic: ${topic}
Learner level: ${level}
Number of exercises: ${count}

Write exactly ${count} exercises about the topic, ordered from easiest to hardest. Each exercise teaches one concept. Use ids "ex1", "ex2", and so on.

Reply with only one JSON object of this shape:
${PLAN_SHAPE}

${RULES(level)}`;
  }

  function repairPrompt(ex, problem, level) {
    return `This exercise for a Python practice course failed an automatic check.

Problem: ${problem}

Exercise JSON:
${JSON.stringify(ex, null, 2)}

Fix the exercise so that its "reference_solution" passes every test and all rules hold. Fix whichever part is wrong: the tests, the solution, or the task text. Keep the same "id" and the same topic.

${RULES(level)}

Reply with only the corrected exercise as one JSON object with the same fields as above.`;
  }

  function summarizeRun(run, exercise) {
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
      const call = callText(exercise.function_name, r.args);
      if (r.status === "fail") parts.push(`${call} returned ${r.actual}, expected ${r.expected}`);
      else parts.push(`${call} raised:\n${r.message}`);
    }
    if (hiddenFailed) parts.push(`${hiddenFailed} hidden test(s) failed (inputs not shown).`);
    if (run.stdout) parts.push("Printed output:\n" + run.stdout.slice(0, 1500));
    return parts.join("\n\n") || "All tests passed.";
  }

  function helpPrompt({ exercise, code, run, level, question }) {
    return `You are a patient Python tutor inside a practice app. The learner is working on one exercise and asked for help.

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

Learner's code:
\`\`\`python
${code}
\`\`\`

Last run:
${summarizeRun(run, exercise)}

Learner's question: ${question ? question : "(none) Give the next hint."}`;
  }

  async function checkSize(prompt) {
    try { limits = limits || (await sample.limits()); } catch (e) { limits = { maxPromptBytes: Infinity }; }
    const bytes = new TextEncoder().encode(prompt).length;
    if (bytes > limits.maxPromptBytes) throw { code: "prompt_too_large", message: "This request is too long to send to Claude. Shorten your code or question." };
  }

  return {
    init(s) { sample = s; },
    get available() { return !!sample; },
    async generatePlan(topic, level, count, opts) {
      const prompt = planPrompt(topic, level, count);
      await checkSize(prompt);
      return sample.json(prompt, Object.assign({ modelTier: "complex" }, opts));
    },
    async repairExercise(ex, problem, level, opts) {
      const prompt = repairPrompt(ex, problem, level);
      await checkSize(prompt);
      return sample.json(prompt, Object.assign({ modelTier: "default" }, opts));
    },
    async help(args, opts) {
      const prompt = helpPrompt(args);
      await checkSize(prompt);
      return sample(prompt, Object.assign({ modelTier: "default", cache: false }, opts));
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
