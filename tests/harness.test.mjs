// Unit tests for the Python test harness embedded in app/codinghost.html.
// Runs the harness in Pyodide under Node, using the vendored files in app/pyodide/.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const html = readFileSync(path.join(root, "app/codinghost.html"), "utf8");
const harness = html.match(/<script type="text\/x-python" id="py-harness">([\s\S]*?)<\/script>/)[1];
const plan = JSON.parse(readFileSync(path.join(root, "app/dev/sample-plan.json"), "utf8"));

let run;
before(async () => {
  const { loadPyodide } = require(path.join(root, "app/pyodide/pyodide.js"));
  const py = await loadPyodide({ indexURL: path.join(root, "app/pyodide") + path.sep });
  py.runPython(harness);
  const fn = py.globals.get("codinghost_run");
  run = (code, name, tests, limit = 0) => JSON.parse(fn(code, name, JSON.stringify(tests), limit));
});

const add = [
  { args_py: "(2, 3)", expected_py: "5", hidden: false },
  { args_py: "(-1, 1)", expected_py: "0", hidden: true },
];

test("correct solution passes every test", () => {
  const r = run("def add(a, b):\n    return a + b\n", "add", add);
  assert.equal(r.error, null);
  assert.deepEqual(r.results.map((x) => x.status), ["pass", "pass"]);
  assert.equal(r.results[1].hidden, true);
});

test("wrong value is a fail with actual and expected", () => {
  const r = run("def add(a, b):\n    return a - b\n", "add", add);
  assert.equal(r.results[0].status, "fail");
  assert.equal(r.results[0].actual, "-1");
  assert.equal(r.results[0].expected, "5");
});

test("syntax error reports the line", () => {
  const r = run("def add(a, b)\n    return a + b\n", "add", add);
  assert.match(r.error, /SyntaxError/);
  assert.equal(r.error_line, 1);
  assert.equal(r.results.length, 0);
});

test("runtime error in a test reports the user line, not harness frames", () => {
  const r = run("def add(a, b):\n    x = 1\n    return a / 0\n", "add", add);
  assert.equal(r.results[0].status, "error");
  assert.match(r.results[0].message, /ZeroDivisionError/);
  assert.equal(r.results[0].line, 3);
  assert.doesNotMatch(r.results[0].message, /codinghost_run/);
});

test("missing function is an error", () => {
  const r = run("def plus(a, b):\n    return a + b\n", "add", add);
  assert.match(r.error, /define a function named 'add'/);
});

test("stdout is captured", () => {
  const r = run("print('hello')\ndef add(a, b):\n    print(a, b)\n    return a + b\n", "add", add.slice(0, 1));
  assert.equal(r.stdout, "hello\n2 3\n");
});

test("input() raises a clear error", () => {
  const r = run("def add(a, b):\n    return int(input())\n", "add", add.slice(0, 1));
  assert.equal(r.results[0].status, "error");
  assert.match(r.results[0].message, /input\(\) is not available/);
});

test("trace guard stops an infinite loop (main-thread mode)", () => {
  const t0 = Date.now();
  const r = run("def add(a, b):\n    while True:\n        pass\n", "add", add, 1);
  assert.equal(r.timed_out, true);
  assert.match(r.error, /TimeoutError/);
  assert.ok(Date.now() - t0 < 5000);
});

test("except Exception in user code cannot swallow the timeout", () => {
  const r = run("def add(a, b):\n    while True:\n        try:\n            pass\n        except Exception:\n            pass\n", "add", add, 1);
  assert.equal(r.timed_out, true);
});

test("arguments are copied, so mutation does not leak between tests", () => {
  const tests = [
    { args_py: "([1],)", expected_py: "[1, 0]", hidden: false },
    { args_py: "([1],)", expected_py: "[1, 0]", hidden: false },
  ];
  const r = run("def f(xs):\n    xs.append(0)\n    return xs\n", "f", tests);
  assert.deepEqual(r.results.map((x) => x.status), ["pass", "pass"]);
});

test("single non-tuple args are wrapped", () => {
  const r = run("def sq(n):\n    return n * n\n", "sq", [{ args_py: "4", expected_py: "16" }]);
  assert.equal(r.results[0].status, "pass");
});

test("bad test definition is reported as invalid", () => {
  const r = run("def sq(n):\n    return n * n\n", "sq", [{ args_py: "(os.getcwd(),)", expected_py: "1" }]);
  assert.equal(r.results[0].status, "invalid");
});

test("dev sample plan: reference solutions pass, except the deliberate ex6 bug", () => {
  for (const ex of plan.exercises) {
    const r = run(ex.reference_solution, ex.function_name, ex.tests);
    const ok = !r.error && r.results.every((x) => x.status === "pass");
    assert.equal(ok, ex.id !== "ex6", ex.id + " reference check");
  }
  const fixed = plan._dev_repairs.ex6;
  const r = run(fixed.reference_solution, fixed.function_name, fixed.tests);
  assert.ok(r.results.every((x) => x.status === "pass"), "ex6 repair passes");
});

test("dev sample plan: starter code fails at least one test", () => {
  for (const ex of plan.exercises) {
    const r = run(ex.starter_code, ex.function_name, ex.tests);
    assert.ok(r.results.some((x) => x.status !== "pass"), ex.id);
  }
});
