// Unit tests for the JavaScript test harness in src/js/js-runner.js.
// Runs the generated worker source in a fresh vm context, the way a new worker would run it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { jsWorkerSource } = new Function(readFileSync(path.join(root, "src/js/js-runner.js"), "utf8") + "\nreturn { jsWorkerSource };")();

function run(code, name, tests) {
  const { source } = jsWorkerSource(code, name, tests);
  let posted = null;
  vm.runInNewContext(source, { postMessage: (m) => { posted = m; }, console: {} }, { filename: "blob:test" });
  // Arrays from the vm context have another realm's prototype, which deepStrictEqual rejects.
  return JSON.parse(JSON.stringify(posted));
}

const add = [
  { args_js: "[2, 3]", expected_js: "5", hidden: false },
  { args_js: "[-1, 1]", expected_js: "0", hidden: true },
];

test("correct solution passes every test", () => {
  const r = run("function add(a, b) {\n  return a + b;\n}\n", "add", add);
  assert.equal(r.error, null);
  assert.deepEqual(r.results.map((x) => x.status), ["pass", "pass"]);
  assert.equal(r.results[1].hidden, true);
  assert.equal(r.results[0].args, "[2, 3]");
});

test("wrong value is a fail with actual and expected", () => {
  const r = run("function add(a, b) {\n  return a - b;\n}\n", "add", add);
  assert.equal(r.results[0].status, "fail");
  assert.equal(r.results[0].actual, "-1");
  assert.equal(r.results[0].expected, "5");
});

test("arrays and objects compare deeply, object key order ignored", () => {
  const tests = [
    { args_js: "[[3, 1, 2]]", expected_js: "[1, 2, 3]" },
    { args_js: "[['a', 'b']]", expected_js: "{ b: 1, a: 1 }" },
  ];
  const r1 = run("function sorted(xs) { return [...xs].sort(); }", "sorted", tests.slice(0, 1));
  assert.equal(r1.results[0].status, "pass");
  const r2 = run("function count(xs) { const o = {}; for (const x of xs) o[x] = 1; return o; }", "count", tests.slice(1));
  assert.equal(r2.results[0].status, "pass");
  const r3 = run("function count(xs) { return new Set(xs); }", "count", tests.slice(1));
  assert.equal(r3.results[0].status, "fail");
  assert.equal(r3.results[0].actual, "Set(2) { 'a', 'b' }");
});

test("each test gets fresh arguments", () => {
  const tests = [{ args_js: "[[1]]", expected_js: "2" }, { args_js: "[[1]]", expected_js: "2" }];
  const r = run("function grow(xs) { xs.push(9); return xs.length; }", "grow", tests);
  assert.deepEqual(r.results.map((x) => x.status), ["pass", "pass"]);
});

test("runtime error names the line in the learner's code", () => {
  const r = run("function add(a, b) {\n  const x = null;\n  return x.y;\n}\n", "add", add.slice(0, 1));
  assert.equal(r.results[0].status, "error");
  assert.match(r.results[0].message, /^TypeError: .*\n    at line 3 of solution\.js$/);
  assert.equal(r.results[0].line, 3);
});

test("error at the top level is the run's error", () => {
  const r = run("const a = 1;\nundefinedThing();\nfunction add() {}\n", "add", add);
  assert.match(r.error, /ReferenceError: undefinedThing is not defined/);
  assert.equal(r.error_line, 2);
  assert.deepEqual(r.results, []);
});

test("missing function is reported", () => {
  const r = run("function plus(a, b) { return a + b; }", "add", add);
  assert.equal(r.error, "ReferenceError: define a function named 'add'");
});

test("arrow function in a const counts", () => {
  const r = run("const add = (a, b) => a + b;", "add", add);
  assert.equal(r.error, null);
  assert.equal(r.results[0].status, "pass");
});

test("console output is captured and formatted", () => {
  const r = run("function add(a, b) {\n  console.log('sum', a + b, [a, 'x'], { k: b });\n  console.error('oops');\n  return a + b;\n}", "add", add.slice(0, 1));
  assert.equal(r.stdout, "sum 5 [2, 'x'] { k: 3 }\n");
  assert.equal(r.stderr, "oops\n");
});

test("async functions are rejected with a clear message", () => {
  const r = run("async function add(a, b) { return a + b; }", "add", add.slice(0, 1));
  assert.equal(r.results[0].status, "error");
  assert.match(r.results[0].message, /returned a Promise/);
});

test("the learner's code cannot reach the harness's variables", () => {
  const r = run("const result = 1, send = null, tests = [];\nfunction add(a, b) { return a + b; }", "add", add);
  assert.equal(r.error, null);
  assert.equal(r.results.length, 2);
});

test("syntax error lines fall inside the learner's range", () => {
  const code = "function add(a, b) {\n  return a +;\n}";
  const { source, userStart, userEnd } = jsWorkerSource(code, "add", add);
  assert.equal(source.split("\n").slice(userStart - 1, userEnd).join("\n"), code);
  assert.throws(() => vm.runInNewContext(source, {}, { filename: "blob:test" }), (e) => e instanceof SyntaxError || e.name === "SyntaxError");
});

test("sample JS plan reference solutions pass their tests", () => {
  const plan = JSON.parse(readFileSync(path.join(root, "app/dev/sample-plan-js.json"), "utf8"));
  const broken = new Set(["ex3"]); // deliberate test bug for the repair path in the dev shim
  for (const ex of plan.exercises) {
    const r = run(ex.reference_solution, ex.function_name, ex.tests);
    const ok = r.error === null && r.results.every((x) => x.status === "pass");
    assert.equal(ok, !broken.has(ex.id), ex.id + ": " + JSON.stringify(r));
  }
  for (const ex of Object.values(plan._dev_repairs)) {
    const r = run(ex.reference_solution, ex.function_name, ex.tests);
    assert.ok(r.error === null && r.results.every((x) => x.status === "pass"), "repair " + ex.id);
  }
});
