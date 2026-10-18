(function debugPanel() {
  const toggle = document.getElementById("debug-toggle");
  const panel = document.getElementById("debug-panel");
  const lines = document.getElementById("debug-lines");
  const meta = document.getElementById("debug-meta");
  let pending = false;

  function line(e) {
    const time = e.t.slice(11, 23);
    const rest = Object.entries(e)
      .filter(([k]) => k !== "t" && k !== "kind")
      .map(([k, v]) => k + "=" + (typeof v === "string" ? JSON.stringify(v.length > 120 ? v.slice(0, 120) + "…" : v) : JSON.stringify(v)))
      .join(" ");
    return time + "  " + e.kind + (rest ? "  " + rest : "");
  }

  function render() {
    pending = false;
    if (panel.hidden) return;
    const st = runner.status;
    const saved = dbg.path
      ? (dbg.saveError ? "Not saved: " + dbg.saveError : dbg.savedAt ? "Saved to " + dbg.path + " at " + dbg.savedAt.toLocaleTimeString() : "Saving to " + dbg.path + "…")
      : "Not saved yet (waiting for sign-in).";
    meta.textContent = "Session " + dbg.sessionId + " · Python " + st.state + (st.mode ? " (" + st.mode + ")" : "") + " · " + dbg.entries.length + " entries. " + saved + " Claude in chat can read this log.";
    lines.textContent = dbg.entries.slice(-120).map(line).join("\n");
    lines.scrollTop = lines.scrollHeight;
  }

  function setOpen(open) {
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.textContent = open ? "Hide debug log" : "Debug log";
    render();
  }

  toggle.addEventListener("click", () => setOpen(panel.hidden));
  dbg.onEntry(() => { if (!pending && !panel.hidden) { pending = true; requestAnimationFrame(render); } });
  setInterval(() => { if (!panel.hidden) render(); }, 3000);
  document.getElementById("debug-copy").addEventListener("click", async (ev) => {
    const text = JSON.stringify(dbg.export(), null, 2);
    try {
      await navigator.clipboard.writeText(text);
      ev.target.textContent = "Copied";
    } catch (e) {
      lines.textContent = text;
      const range = document.createRange();
      range.selectNodeContents(lines);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      ev.target.textContent = "Selected, press Ctrl+C";
    }
    setTimeout(() => { ev.target.textContent = "Copy log"; }, 2500);
  });
  if (location.hash === "#debug") setOpen(true);
})();
