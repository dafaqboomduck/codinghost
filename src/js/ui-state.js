const S = {
  caps: null,
  uid: null,
  blocked: null,       // reason string when the page cannot work
  plans: null,         // [{plan, progress}] or null while loading
  plan: null,
  progress: null,
  index: 0,
  lastRun: {},         // ex id -> harness result (session only)
  hints: {},           // ex id -> [{level, question, text, streaming, error}]
  confirm: null,       // "reset" | "solution" | null
  showSolution: {},    // ex id -> true
  running: false,
  helping: false,
  reviews: {},         // ex id -> {text, streaming, error} for the review being fetched (saved ones live in progress)
  gen: null,           // generation state
};
let editor = null;
let saveTimer = null;
const viewEl = document.getElementById("view");
const crumbEl = document.getElementById("crumb");

function setCrumb(text) { crumbEl.textContent = text || ""; }

runner.onStatus((st) => {
  const chip = document.getElementById("py-chip");
  chip.className = "chip " + (st.state === "ready" ? "ok" : st.state === "failed" ? "bad" : "warn");
  chip.textContent = st.state === "ready" ? "Python ready" : st.state === "failed" ? "Python unavailable" : "Python loading";
  chip.title = st.state === "failed" ? st.detail : st.state === "ready" ? "Pyodide 0.26.4, " + (st.mode === "worker" ? "Web Worker" : "main thread") : "";
  if (S.plan && document.getElementById("actions")) renderActions();
});

document.getElementById("brand").addEventListener("click", () => goHome());
