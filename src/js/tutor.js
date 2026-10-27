function renderTutor() {
  const el = document.getElementById("tutor");
  if (!el) return;
  const ex = S.plan.exercises[S.index];
  const st = exState(ex);
  const hints = S.hints[ex.id] || [];
  const level = Math.min((st.hints_used || 0) + 1, 3);
  const staticShown = !!(ex.hint_md && st.hint_shown);
  const staticReady = !!(ex.hint_md && !st.hint_shown);
  const keepQuestion = document.getElementById("ask") ? document.getElementById("ask").value : "";
  el.textContent = "";
  el.append(h("div", { class: "row" }, h("h3", { text: "Tutor" }), h("span", { class: "spacer" }),
    ai.available || ex.hint_md ? h("span", { class: "muted tabnum", style: "font-size: 13px", text: "Hints used: " + (st.hints_used || 0) }) : null));

  renderReview(el, ex, st);

  if (staticShown) {
    el.append(h("div", { class: "hint" }, h("span", { class: "who", text: "Hint" }), h("div", { class: "body" }, md(ex.hint_md))));
  }

  for (const hint of hints) {
    const body = h("div", { class: "body" });
    if (hint.error) body.append(h("span", { text: hint.error }));
    else body.append(hint.text ? md(hint.text) : h("span", { class: "muted", text: "Thinking…" }));
    el.append(h("div", { class: "hint" + (hint.streaming ? " streaming" : "") },
      h("span", { class: "who", text: "Hint " + hint.level }),
      hint.question ? h("span", { class: "q", text: "You asked: " + hint.question }) : null,
      body,
    ));
  }

  if (ai.available) {
    const input = h("input", { type: "text", id: "ask", maxlength: "500", placeholder: "Optional: ask a specific question", autocomplete: "off", value: keepQuestion });
    const btn = h("button", { class: "btn secondary", type: "button", disabled: S.helping, text: S.helping ? "Thinking…" : hints.length || staticShown ? "Next hint (" + level + " of 3)" : "Help me" });
    const ask = () => doHelp(input.value.trim());
    btn.addEventListener("click", ask);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); ask(); } });
    el.append(h("div", { class: "tutor-ask" }, input, btn));
  } else {
    if (staticReady) el.append(h("div", { class: "row" }, h("button", { class: "btn secondary", type: "button", onclick: () => doHelp(""), text: "Show hint" })));
    el.append(h("p", { class: "muted", text: "More help from the tutor needs Claude access, which is off for this page." }));
  }

  const allowSolution = (st.hints_used || 0) >= SOLUTION_AFTER || (st.attempts || 0) >= SOLUTION_AFTER || st.status === "solution_shown";
  if (S.showSolution[ex.id] || st.status === "solution_shown") {
    el.append(h("div", { class: "stack", style: "gap: 8px" },
      h("span", { class: "eyebrow", text: "Reference solution" }),
      h("pre", { class: "term", text: ex.reference_solution }),
      h("div", { class: "row" }, h("button", { class: "btn secondary", type: "button", onclick: () => { editor.setValue(ex.reference_solution); editor.focus(); }, text: "Copy into editor" })),
    ));
  } else if (allowSolution) {
    if (S.confirm === "solution") {
      el.append(h("div", { class: "confirm" },
        h("span", { text: "This marks the exercise as completed with the solution. Show it?" }),
        h("span", { class: "spacer" }),
        h("button", { class: "btn", type: "button", onclick: revealSolution, text: "Show solution" }),
        h("button", { class: "btn secondary", type: "button", onclick: () => { S.confirm = null; renderTutor(); }, text: "Cancel" }),
      ));
    } else {
      el.append(h("div", { class: "row" }, h("button", { class: "btn ghost", type: "button", onclick: () => { S.confirm = "solution"; renderTutor(); }, text: "Show solution…" })));
    }
  }
}

function revealSolution() {
  const ex = S.plan.exercises[S.index];
  const st = exState(ex);
  S.confirm = null;
  S.showSolution[ex.id] = true;
  if (st.status !== "passed") st.status = "solution_shown";
  unlockNext(S.index);
  saveProgressNow();
  renderStrip();
  renderBanner();
  renderActions();
  renderOutput();
  renderTutor();
}

// The plan's own hint comes first: it is free and instant. A typed question skips it, since it does not answer anything.
function showStaticHint(ex, st) {
  dbg.log("help", { exercise: ex.id, level: 1, static: true });
  st.hint_shown = true;
  st.hints_used = Math.max(st.hints_used || 0, 1);
  saveProgressNow();
  renderTutor();
}

async function doHelp(question) {
  if (S.helping) return;
  const ex = S.plan.exercises[S.index];
  const st = exState(ex);
  if (!question && ex.hint_md && !st.hint_shown) return showStaticHint(ex, st);
  if (!ai.available) return;
  const level = Math.min((st.hints_used || 0) + 1, 3);
  dbg.log("help", { exercise: ex.id, level, question: !!question });
  const hint = { level, question, text: "", streaming: true, error: null };
  (S.hints[ex.id] = S.hints[ex.id] || []).push(hint);
  S.helping = true;
  const ask = document.getElementById("ask");
  if (ask) ask.value = "";
  renderTutor();
  let pendingFrame = false;
  try {
    const res = await ai.help({ exercise: ex, code: editor.getValue(), run: S.lastRun[ex.id], level, question, shownHint: !!st.hint_shown }, {
      onText: ({ text }) => {
        hint.text = text;
        if (!pendingFrame) {
          pendingFrame = true;
          requestAnimationFrame(() => { pendingFrame = false; if (S.plan && S.plan.exercises[S.index] === ex) renderTutor(); });
        }
      },
    });
    hint.text = res.text;
    st.hints_used = level;
    saveProgressNow();
  } catch (e) {
    hint.error = aiErrorMessage(e);
    if (e && e.text) hint.text = e.text;
    if (e && e.code === "not_granted") ai.init(null);
  }
  hint.streaming = false;
  S.helping = false;
  if (S.plan && S.plan.exercises[S.index] === ex) renderTutor();
}

// Trailing whitespace and blank lines should not count as new code worth another review.
const normCode = (code) => String(code || "").replace(/[ \t]+$/gm, "").trim();
const reviewKey = (ex) => S.plan.id + "/" + ex.id;

// Copying the reference solution back in passes too, but reviewing it teaches nothing.
function wantsReview(ex, st) {
  const code = normCode(st.code);
  return st.status === "passed" && code !== normCode(ex.reference_solution) && (!st.review || normCode(st.review.code) !== code);
}

function renderReview(el, ex, st) {
  if (st.status !== "passed") return;
  const live = S.reviews[reviewKey(ex)];
  const shown = live || st.review;
  if (shown) {
    const body = h("div", { class: "body" });
    if (shown.error) body.append(h("span", { text: shown.error }));
    else body.append(shown.text ? md(shown.text) : h("span", { class: "muted", text: "Reading your code…" }));
    el.append(h("div", { class: "hint review" + (shown.streaming ? " streaming" : "") },
      h("span", { class: "who", text: "Code review" }),
      body,
    ));
  }
  if (ai.available && !(live && live.streaming) && wantsReview(ex, st)) {
    el.append(h("div", { class: "row" }, h("button", { class: "btn secondary", type: "button", onclick: doReview, text: st.review ? "Review my new code" : "Review my code" })));
  }
}

async function doReview() {
  if (!ai.available || !S.plan) return;
  const ex = S.plan.exercises[S.index];
  const st = exState(ex);
  const key = reviewKey(ex);
  if (S.reviews[key] && S.reviews[key].streaming) return;
  const code = st.code;
  const live = (S.reviews[key] = { text: "", streaming: true, error: null });
  dbg.log("review", { exercise: ex.id });
  const rerender = () => { if (S.plan && S.plan.exercises[S.index] === ex) renderTutor(); };
  rerender();
  let pendingFrame = false;
  try {
    const res = await ai.review({ exercise: ex, code, level: S.plan.level }, {
      onText: ({ text }) => {
        live.text = text;
        if (!pendingFrame) {
          pendingFrame = true;
          requestAnimationFrame(() => { pendingFrame = false; rerender(); });
        }
      },
    });
    st.review = { code, text: res.text, at: new Date().toISOString() };
    delete S.reviews[key];
    saveProgressNow();
  } catch (e) {
    live.error = aiErrorMessage(e);
    live.streaming = false;
    if (e && e.code === "not_granted") ai.init(null);
  }
  rerender();
}
