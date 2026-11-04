const S = {
  caps: null,
  uid: null,
  blocked: null,       // reason string when the page cannot work
  plans: null,         // [{plan, progress}] or null while loading
  plan: null,
  progress: null,
  index: 0,
  lesson: null,        // index of the lesson on screen, or null while an exercise is
  lastRun: {},         // ex id -> harness result (session only)
  hints: {},           // ex id -> [{level, question, text, streaming, error}]
  confirm: null,       // "reset" | "solution" | null
  showSolution: {},    // ex id -> true
  running: false,
  helping: false,
  reviews: {},         // ex id -> {text, streaming, error} for the review being fetched (saved ones live in progress)
  gen: null,           // generation state
  chip: false,         // runtime chip on screen: lesson and exercise views only
};
let editor = null;
let saveTimer = null;
const viewEl = document.getElementById("view");
const crumbEl = document.getElementById("crumb");

function setCrumb(text) { crumbEl.textContent = text || ""; }

// The chip shows the open plan's runtime, on lesson and exercise screens only.
// show: true or false sets whether it is on screen; omitted, it keeps the current choice (status updates).
function renderRuntimeChip(show) {
  if (show !== undefined) S.chip = !!show && !!S.plan;
  const chip = document.getElementById("py-chip");
  chip.hidden = !S.chip;
  const L = langOf(S.plan);
  const st = L.runner.status;
  chip.className = "chip " + (st.state === "ready" ? "ok" : st.state === "failed" ? "bad" : "warn");
  chip.textContent = L.label + (st.state === "ready" ? " ready" : st.state === "failed" ? " unavailable" : " loading");
  chip.title = st.state === "failed" ? st.detail : st.state !== "ready" ? "" : L.id === "python" ? "Pyodide 0.26.4, " + (st.mode === "worker" ? "Web Worker" : "main thread") : "Runs in a Web Worker";
}

runner.onStatus(() => {
  renderRuntimeChip();
  if (S.plan && document.getElementById("actions")) renderActions();
  if (document.getElementById("new-plan")) updateLanguageGate();
});

document.getElementById("brand").addEventListener("click", () => goHome());
