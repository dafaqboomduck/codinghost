// jsRunner: JavaScript exercises, one fresh Web Worker per run

// Runs inside the worker. It is copied into the worker source with toString(), so it may only use
// its arguments and the worker's globals. getFn runs the learner's code and returns their function.
function jsHarness(fnName, tests, getFn, userStart, userEnd) {
  const MAX_OUT = 20000;
  const send = typeof self !== "undefined" ? self.postMessage.bind(self) : postMessage;
  const result = { stdout: "", stderr: "", error: null, error_line: null, timed_out: false, results: [] };
  const out = [];
  const err = [];

  // Close to Node's console.log: strings bare at the top, quoted inside arrays and objects.
  function show(v, depth, seen, top) {
    if (typeof v === "string") return top ? v : "'" + v.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n") + "'";
    if (v === null || v === undefined || typeof v === "number" || typeof v === "boolean") return Object.is(v, -0) ? "-0" : String(v);
    if (typeof v === "bigint") return v + "n";
    if (typeof v === "symbol") return v.toString();
    if (typeof v === "function") return "[Function: " + (v.name || "anonymous") + "]";
    if (seen.includes(v)) return "[Circular]";
    if (depth > 4) return Array.isArray(v) ? "[Array]" : "[Object]";
    const next = seen.concat([v]);
    const inner = (x) => show(x, depth + 1, next, false);
    if (Array.isArray(v)) return "[" + v.map(inner).join(", ") + "]";
    if (v instanceof Map) return "Map(" + v.size + ") {" + (v.size ? " " + [...v].map(([k, x]) => inner(k) + " => " + inner(x)).join(", ") + " " : "") + "}";
    if (v instanceof Set) return "Set(" + v.size + ") {" + (v.size ? " " + [...v].map(inner).join(", ") + " " : "") + "}";
    if (v instanceof Date) return isNaN(v) ? "Invalid Date" : v.toISOString();
    if (v instanceof Error) return v.name + ": " + v.message;
    const keys = Object.keys(v);
    const name = v.constructor && v.constructor !== Object && v.constructor.name ? v.constructor.name + " " : "";
    if (!keys.length) return name + "{}";
    return name + "{ " + keys.map((k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : "'" + k + "'") + ": " + inner(v[k])).join(", ") + " }";
  }
  const repr = (v) => { const s = show(v, 0, [], false); return s.length <= 300 ? s : s.slice(0, 300) + "..."; };
  const clip = (lines) => { const s = lines.join("\n") + (lines.length ? "\n" : ""); return s.length <= MAX_OUT ? s : s.slice(0, MAX_OUT) + "\n... output truncated ...\n"; };

  // Key order does not matter for objects; Map, Set and class instances only equal themselves.
  function same(a, b) {
    if (a === b) return true;
    if (typeof a === "number" && typeof b === "number") return a !== a && b !== b;
    if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => same(x, b[i]));
    if (Object.getPrototypeOf(a) !== Object.prototype || Object.getPrototypeOf(b) !== Object.prototype) return false;
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && same(a[k], b[k]));
  }

  // The last stack frame inside the learner's code, as a line number of their file.
  function userLine(e) {
    const stack = (e && typeof e.stack === "string" && e.stack) || "";
    for (const frame of stack.split("\n")) {
      const m = frame.match(/:(\d+):\d+\)?\s*$/);
      if (m && +m[1] >= userStart && +m[1] <= userEnd) return +m[1] - userStart + 1;
    }
    return null;
  }
  function describe(e) {
    if (!(e instanceof Error)) return "Uncaught " + repr(e);
    const line = userLine(e);
    return e.name + ": " + e.message + (line ? "\n    at line " + line + " of solution.js" : "");
  }

  const write = (into) => (...args) => into.push(args.map((a) => show(a, 0, [], true)).join(" "));
  console.log = console.info = console.debug = write(out);
  console.error = console.warn = write(err);

  try {
    let fn;
    try {
      fn = getFn();
    } catch (e) {
      result.error = describe(e);
      result.error_line = userLine(e);
    }
    if (!result.error && typeof fn !== "function") result.error = "ReferenceError: define a function named '" + fnName + "'";
    if (!result.error) {
      tests.forEach((t, index) => {
        const item = { index, hidden: !!t.hidden, args: t.args, expected: t.expected, actual: null, status: "pass", message: null, line: null };
        result.results.push(item);
        let args, expected;
        try {
          [args, expected] = t.make();
          if (!Array.isArray(args)) args = [args];
        } catch (e) {
          item.status = "invalid";
          item.message = "Bad test definition: " + describe(e);
          return;
        }
        let actual;
        try {
          actual = fn(...args);
        } catch (e) {
          item.status = "error";
          item.message = describe(e);
          item.line = userLine(e);
          return;
        }
        if (actual && typeof actual.then === "function") {
          item.status = "error";
          item.message = "TypeError: " + fnName + " returned a Promise. Write a normal function without async or await.";
          return;
        }
        item.actual = repr(actual);
        if (!same(actual, expected)) item.status = "fail";
      });
    }
  } catch (e) {
    result.error = "Runner error: " + ((e && e.message) || e);
  }
  result.stdout = clip(out);
  result.stderr = clip(err);
  send(result);
}

// Builds the worker script for one run. The learner's code goes in as source text, not through eval,
// so the page needs no 'unsafe-eval'; a syntax error in it then fails the whole script, and the
// runner maps the error's line number back with userStart.
// Returns { source, userStart, userEnd }, the line range of the learner's code inside source.
function jsWorkerSource(code, fnName, tests) {
  const list = tests.map((t) => "  { hidden: " + !!t.hidden + ", args: " + JSON.stringify(t.args_js) + ", expected: " + JSON.stringify(t.expected_js) +
    ", make: function () { return [(\n" + t.args_js + "\n), (\n" + t.expected_js + "\n)]; } }").join(",\n");
  const head = jsHarness.toString() + "\n\njsHarness(" + JSON.stringify(fnName) + ", [\n" + list + "\n], function () {\n";
  const userStart = head.split("\n").length;
  const userEnd = userStart + code.split("\n").length - 1;
  // fnName is a checked identifier. typeof is safe even when the learner never declared it.
  const tail = "\n;return typeof " + fnName + " === \"function\" ? " + fnName + " : undefined;\n}, " + userStart + ", " + userEnd + ");\n";
  return { source: head + code + tail, userStart, userEnd };
}

const jsRunner = (() => {
  const supported = typeof Worker === "function" && typeof Blob === "function";
  const status = supported ? { state: "ready", detail: "", mode: "worker" } : { state: "failed", detail: "This browser cannot start Web Workers.", mode: null };
  let queue = Promise.resolve();
  let seq = 0;
  let stage = "idle";

  const failResult = (msg) => ({ stdout: "", stderr: "", results: [], error_line: null, timed_out: false, error: msg });

  // A syntax error stops the script before the harness runs, so it arrives as the worker's error event.
  function scriptError(e, userStart, userEnd) {
    const msg = String(e.message || "the script did not start").replace(/^Uncaught /, "");
    const line = e.lineno >= userStart && e.lineno <= userEnd ? e.lineno - userStart + 1 : null;
    if (line) return Object.assign(failResult(msg + "\n    at line " + line + " of solution.js"), { error_line: line });
    if (e.lineno && e.lineno < userStart) return failResult("Bad test definition: " + msg);
    return failResult(/SyntaxError/.test(msg) ? msg + " (check that every bracket and string is closed)" : "Runner error: " + msg);
  }

  function logEnd(id, res) {
    const results = res.results || [];
    dbg.log("run_end", {
      run: id, mode: "js-worker", ms: Math.round(res.ms || 0),
      error: res.error ? res.error.split("\n")[0] : null,
      timed_out: !!res.timed_out,
      passed: results.filter((r) => r.status === "pass").length,
      failed: results.filter((r) => r.status !== "pass").length,
      stdout_chars: (res.stdout || "").length,
    });
  }

  // Same contract as runner.run. Each run gets a new worker, so nothing leaks between runs
  // and a timeout only has to terminate it.
  function run(code, fn, tests, timeoutMs = RUN_TIMEOUT_MS, meta = {}) {
    const id = ++seq;
    dbg.log("run_queued", { run: id, lang: "javascript", purpose: meta.purpose || "run", exercise: meta.exercise || null, fn, tests: tests.length });
    const job = queue.then(() => new Promise((resolve) => {
      const t0 = performance.now();
      let timer = null;
      let worker = null;
      let url = null;
      const finish = (res) => {
        clearTimeout(timer);
        if (worker) worker.terminate();
        if (url) URL.revokeObjectURL(url);
        worker = null;
        stage = "idle";
        res.ms = performance.now() - t0;
        logEnd(id, res);
        resolve(res);
      };
      if (!supported) return finish(failResult(status.detail));
      const { source, userStart, userEnd } = jsWorkerSource(code, fn, tests);
      dbg.log("run_start", { run: id, mode: "js-worker", timeout_ms: timeoutMs, code });
      stage = "running JavaScript in a worker";
      try {
        url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
        worker = new Worker(url);
      } catch (e) {
        return finish(failResult("Could not start JavaScript: " + ((e && e.message) || e)));
      }
      timer = setTimeout(() => {
        dbg.log("run_timeout", { run: id, ms: timeoutMs });
        finish(Object.assign(failResult("TimeoutError: the code ran longer than " + timeoutMs / 1000 + " s (infinite loop?)"), { timed_out: true }));
      }, timeoutMs);
      worker.onmessage = (e) => finish(e.data);
      worker.onerror = (e) => { e.preventDefault(); finish(scriptError(e, userStart, userEnd)); };
    }));
    queue = job.catch(() => {});
    return job;
  }

  return {
    run,
    start() {},
    whenReady() { return supported ? Promise.resolve() : Promise.reject(new Error(status.detail)); },
    get stage() { return stage; },
    get status() { return status; },
    onStatus(fn) { fn(status); return () => {}; },
  };
})();
