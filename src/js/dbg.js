// dbg: debug log, saved to db at debug/<uid> so Claude in chat can read it

const dbg = (() => {
  const SID = newId("s");
  const STARTED = new Date().toISOString();
  const MAX_ENTRIES = 300;
  const MAX_DOC_CHARS = 200000; // db documents cap at 256 KiB
  const entries = [];
  const listeners = new Set();
  let db = null;
  let path = null;
  let previous = null;
  let dirty = false;
  let writing = null;
  let lastTick = Date.now();
  let lastStallLog = 0;
  let savedAt = null;
  let saveError = null;

  const env = {
    ua: navigator.userAgent,
    origin: location.origin,
    dev: DEV,
    cores: navigator.hardwareConcurrency || null,
    memory_gb: navigator.deviceMemory || null,
    viewport: innerWidth + "x" + innerHeight,
  };

  function clip(value, n) {
    const s = typeof value === "string" ? value : JSON.stringify(value);
    return s && s.length > n ? s.slice(0, n) + "…[" + s.length + " chars]" : s;
  }

  function log(kind, data) {
    const entry = Object.assign({ t: new Date().toISOString(), kind }, data || {});
    for (const k of Object.keys(entry)) if (typeof entry[k] === "string") entry[k] = clip(entry[k], 2000);
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
    dirty = true;
    listeners.forEach((fn) => fn(entry));
  }

  function snapshot() {
    const current = { session_id: SID, started_at: STARTED, last_beat: new Date(lastTick).toISOString(), env, entries: entries.slice() };
    const doc = { current, previous, updated_at: new Date().toISOString() };
    while (JSON.stringify(doc).length > MAX_DOC_CHARS) {
      if (previous && previous.entries && previous.entries.length > 20) previous.entries.splice(0, 20);
      else if (current.entries.length > 20) current.entries.splice(0, 20);
      else break;
    }
    return doc;
  }

  // One write at a time; a log entry during a write is picked up by the next one.
  async function flush() {
    if (!db) return;
    while (writing) await writing;
    if (!dirty) return;
    dirty = false;
    writing = db.doc(path).set(snapshot())
      .then(() => { savedAt = new Date(); saveError = null; })
      .catch((e) => { dirty = true; saveError = (e && (e.code || e.message)) || String(e); console.info("CodingHost debug log not saved:", saveError); })
      .finally(() => { writing = null; });
    return writing;
  }

  // Before code runs on the main thread the page may freeze, so the run_start entry
  // must reach db first. Capped so a slow db never delays a run by more than limitMs.
  function flushNow(limitMs) {
    return Promise.race([flush(), new Promise((r) => setTimeout(r, limitMs))]);
  }

  // The previous session's log survives this load, because a frozen tab is usually reloaded.
  async function attach(dbNs, uid) {
    db = dbNs;
    path = "debug/" + uid;
    try {
      const snap = await db.doc(path).get();
      // Copy: saved documents come back read-only, and snapshot() trims previous.entries in place.
      const old = snap.exists ? JSON.parse(JSON.stringify(snap.data())) : null;
      if (old && old.current) {
        previous = old.current;
        previous.entries = (previous.entries || []).slice(-150);
      }
    } catch (e) {
      log("debug_read_failed", { error: (e && (e.code || e.message)) || String(e) });
    }
    log("debug_attached", { path, previous_session: previous ? previous.session_id : null });
    await flush();
    setInterval(() => { if (dirty) flush(); }, 3000);
  }

  // A late timer tick means the main thread was blocked (Python on the main thread, or a JS loop).
  setInterval(() => {
    const now = Date.now();
    const gap = now - lastTick;
    lastTick = now;
    if (gap > 2500 && now - lastStallLog > 1000) {
      lastStallLog = now;
      log("main_thread_stall", { blocked_ms: gap - 1000, hidden: document.hidden });
    }
  }, 1000);

  addEventListener("error", (e) => log("window_error", { message: e.message, source: e.filename, line: e.lineno, col: e.colno, stack: e.error && e.error.stack }));
  addEventListener("unhandledrejection", (e) => log("unhandled_rejection", { reason: (e.reason && (e.reason.stack || e.reason.message || e.reason.code)) || String(e.reason) }));
  document.addEventListener("securitypolicyviolation", (e) => log("csp_violation", { directive: e.effectiveDirective, blocked: e.blockedURI }));
  document.addEventListener("visibilitychange", () => log("visibility", { hidden: document.hidden }));
  for (const level of ["warn", "error"]) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      log("console_" + level, { message: args.map((a) => (a instanceof Error ? a.stack || a.message : typeof a === "string" ? a : clip(a, 500))).join(" ") });
      original(...args);
    };
  }

  return {
    log,
    attach,
    flushNow,
    sessionId: SID,
    get path() { return path; },
    get savedAt() { return savedAt; },
    get saveError() { return saveError; },
    export() { return snapshot(); },
    get entries() { return entries; },
    onEntry(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
})();
