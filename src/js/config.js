const RUN_TIMEOUT_MS = 5000;
const LOAD_TIMEOUT_MS = 90000;
const SAVE_DEBOUNCE_MS = 2000;
const MIN_EXERCISES = 3;
const SOLUTION_AFTER = 3; // hints used or failed submits before "Show solution" appears
// The artifact sandbox blocks runtime fetches from CDNs, so Pyodide's core files are
// published next to this page (see scripts/vendor-pyodide.sh).
const PYODIDE_BASE = new URL("pyodide/", location.href).href;
const HARNESS = document.getElementById("py-harness").textContent;
const DEV = !(window.claude && window.claude.use) && new URLSearchParams(location.search).has("dev");
// ?dev&main skips the worker, to reproduce the main-thread fallback locally.
const FORCE_MAIN = DEV && new URLSearchParams(location.search).has("main");
