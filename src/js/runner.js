// runner: Pyodide in a Web Worker, main-thread fallback

// Artifacts do not serve .zip, so the stdlib ships as base64 text and loads through stdLibURL.
// This function is also copied into the worker source with toString().
async function stdlibBlobURL(base) {
  const res = await fetch(base + "python_stdlib.zip.b64.txt");
  if (!res.ok) throw new Error("Python standard library could not be loaded (HTTP " + res.status + ")");
  const bin = atob((await res.text()).trim());
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
}

const WORKER_SRC = stdlibBlobURL.toString() + `
  let runFn = null;
  self.onmessage = async (e) => {
    const m = e.data;
    if (m.type === "init") {
      try {
        importScripts(m.base + "pyodide.js");
        const py = await loadPyodide({ indexURL: m.base, stdLibURL: await stdlibBlobURL(m.base) });
        py.runPython(m.harness);
        runFn = py.globals.get("codinghost_run");
        postMessage({ type: "ready" });
      } catch (err) {
        postMessage({ type: "init_error", error: String((err && err.message) || err) });
      }
    } else if (m.type === "run") {
      let json;
      try {
        json = runFn(m.code, m.fn, JSON.stringify(m.tests), 0);
      } catch (err) {
        json = JSON.stringify({ stdout: "", stderr: "", error: "Runner error: " + String((err && err.message) || err), results: [] });
      }
      postMessage({ type: "result", id: m.id, json });
    }
  };`;

const runner = (() => {
  let mode = null;
  let worker = null;
  let mainRun = null;
  let ready = null;
  let queue = Promise.resolve();
  let seq = 0;
  const pending = new Map();
  const listeners = new Set();
  let status = { state: "loading", detail: "" };
  let workerURL = null;

  function setStatus(state, detail) {
    status = { state, detail: detail || "", mode };
    dbg.log("python_status", { state, detail: detail || "", mode, since_load_ms: Math.round(performance.now()) });
    listeners.forEach((fn) => {
      try { fn(status); } catch (e) { console.error("CodingHost: status listener failed", e); }
    });
  }

  function spawnWorker() {
    workerURL = workerURL || URL.createObjectURL(new Blob([WORKER_SRC], { type: "text/javascript" }));
    return new Promise((resolve, reject) => {
      const w = new Worker(workerURL);
      const timer = setTimeout(() => { w.terminate(); reject(new Error("Python took too long to load.")); }, LOAD_TIMEOUT_MS);
      w.onmessage = (e) => {
        if (e.data.type === "ready") { clearTimeout(timer); resolve(w); }
        else if (e.data.type === "init_error") { clearTimeout(timer); w.terminate(); reject(new Error(e.data.error)); }
      };
      w.onerror = (e) => { clearTimeout(timer); w.terminate(); reject(new Error(e.message || "The Python worker failed to start.")); };
      w.postMessage({ type: "init", base: PYODIDE_BASE, harness: HARNESS });
    });
  }

  async function startWorker() {
    const w = await spawnWorker();
    w.onmessage = (e) => {
      if (e.data.type !== "result") return;
      const done = pending.get(e.data.id);
      if (done) { pending.delete(e.data.id); done(JSON.parse(e.data.json)); }
    };
    // Without this, a crash after load leaves the run waiting for its timeout.
    w.onerror = (e) => {
      dbg.log("worker_crash", { message: e.message || "unknown", pending: pending.size });
      const msg = "Runner error: the Python worker crashed (" + (e.message || "unknown") + ")";
      for (const done of pending.values()) done({ stdout: "", stderr: "", results: [], error: msg, crashed: true });
      pending.clear();
      restartWorker();
    };
    worker = w;
    mode = "worker";
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error("Could not load " + src));
      document.head.append(s);
    });
  }

  async function startMain() {
    if (typeof window.loadPyodide !== "function") await loadScript(PYODIDE_BASE + "pyodide.js");
    const py = await window.loadPyodide({ indexURL: PYODIDE_BASE, stdLibURL: await stdlibBlobURL(PYODIDE_BASE) });
    py.runPython(HARNESS);
    mainRun = py.globals.get("codinghost_run");
    mode = "main";
  }

  function start() {
    setStatus("loading");
    ready = (async () => {
      try {
        if (FORCE_MAIN) throw new Error("worker skipped (?main)");
        await startWorker();
      } catch (workerErr) {
        dbg.log("worker_failed", { error: workerErr.message });
        console.warn("CodingHost: worker runner failed, using the main thread.", workerErr);
        try {
          await startMain();
        } catch (mainErr) {
          dbg.log("main_thread_failed", { error: mainErr.message, stack: mainErr.stack });
          setStatus("failed", mainErr.message);
          throw mainErr;
        }
      }
      setStatus("ready");
    })();
    ready.catch(() => {});
    return ready;
  }

  function restartWorker() {
    dbg.log("worker_restart", {});
    if (worker) worker.terminate();
    worker = null;
    pending.clear();
    ready = startWorker().then(() => setStatus("ready"), (e) => { setStatus("failed", e.message); throw e; });
    ready.catch(() => {});
    setStatus("loading");
  }

  const timeoutResult = (ms) => ({
    stdout: "", stderr: "", results: [], error_line: null, timed_out: true, ms,
    error: "TimeoutError: the code ran longer than " + ms / 1000 + " s (infinite loop?)",
  });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const failResult = (msg, ms) => ({ stdout: "", stderr: "", results: [], error_line: null, timed_out: false, ms, error: msg });
  let stage = "idle";

  function logEnd(id, res) {
    const results = res.results || [];
    dbg.log("run_end", {
      run: id, mode, ms: Math.round(res.ms || 0),
      error: res.error ? res.error.split("\n").slice(-1)[0] : null,
      timed_out: !!res.timed_out,
      passed: results.filter((r) => r.status === "pass").length,
      failed: results.filter((r) => r.status !== "pass").length,
      stdout_chars: (res.stdout || "").length,
    });
  }

  // One run at a time. Resolves with the harness result, never rejects unless Python failed to load.
  // Every wait below is capped, so a run that went wrong ends with a message instead of hanging.
  // meta ({purpose, exercise}) only labels the debug log.
  function run(code, fn, tests, timeoutMs = RUN_TIMEOUT_MS, meta = {}) {
    const id = ++seq;
    const queuedAt = performance.now();
    dbg.log("run_queued", { run: id, purpose: meta.purpose || "run", exercise: meta.exercise || null, fn, tests: tests.length, python: status.state });
    const prev = queue;
    const job = (async () => {
      stage = "waiting for an earlier run to finish";
      await Promise.race([prev, sleep(timeoutMs + 3000)]);
      stage = "waiting for Python to load";
      await Promise.race([ready, sleep(LOAD_TIMEOUT_MS).then(() => { throw new Error("Python did not finish loading."); })]);
      const t0 = performance.now();
      dbg.log("run_start", { run: id, mode, waited_ms: Math.round(t0 - queuedAt), timeout_ms: timeoutMs, code });
      if (mode === "main") {
        stage = "running tests on the main thread";
        await dbg.flushNow(1500);
        await sleep(20); // let the UI paint "Running" first
        let res;
        try {
          res = JSON.parse(mainRun(code, fn, JSON.stringify(tests), timeoutMs / 1000));
        } catch (e) {
          // A Pyodide fatal error (e.g. stack overflow) lands here; Pyodide is unusable after it.
          dbg.log("run_throw", { run: id, error: (e && (e.stack || e.message)) || String(e) });
          res = failResult("Runner error: " + ((e && e.message) || e));
        }
        res.ms = performance.now() - t0;
        logEnd(id, res);
        return res;
      }
      stage = "waiting for the Python worker to answer";
      return new Promise((resolve) => {
        let timer = null;
        const finish = (res) => {
          clearTimeout(timer);
          pending.delete(id);
          res.ms = performance.now() - t0;
          logEnd(id, res);
          resolve(res);
        };
        timer = setTimeout(() => {
          dbg.log("run_timeout", { run: id, ms: timeoutMs });
          finish(timeoutResult(timeoutMs)); // settle first, then restart, so a restart problem cannot leave the run hanging
          try { restartWorker(); } catch (e) { console.error("CodingHost: worker restart failed", e); setStatus("failed", (e && e.message) || String(e)); }
        }, timeoutMs);
        pending.set(id, finish);
        try {
          worker.postMessage({ type: "run", id, code, fn, tests });
        } catch (e) {
          finish(failResult("Could not send the tests to Python: " + ((e && e.message) || e)));
        }
      });
    })();
    queue = job.catch(() => {});
    return job;
  }

  return {
    start,
    run,
    whenReady() { return ready; },
    get stage() { return stage; },
    get status() { return status; },
    onStatus(fn) { listeners.add(fn); fn(status); return () => listeners.delete(fn); },
  };
})();
