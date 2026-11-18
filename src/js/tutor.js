const TUTOR_ICONS = {
  bulb: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V17h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z"/></svg>',
  chat: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>',
};

// h() builds elements only, so the constant icon markup goes in through innerHTML.
function iconLabel(tag, attrs, icon, text) {
  const el = h(tag, attrs);
  el.innerHTML = TUTOR_ICONS[icon];
  el.append(text);
  return el;
}

// The plan's hint counts as one of hints_used; everything above it came from Claude.
function tutorHintsUsed(ex, st) {
  return Math.max(0, (st.hints_used || 0) - (ex.hint_md && st.hint_shown ? 1 : 0));
}

// Help comes in steps: the plan's free hint, then up to TUTOR_HINTS from Claude, then only the solution.
// "Show solution" stays hidden until the free hint is used, so the learner tries the hint first.
function renderTutor() {
  const el = document.getElementById("tutor");
  if (!el) return;
  const ex = S.plan.exercises[S.index];
  const st = exState(ex);
  const replies = S.hints[ex.id] || [];
  const hintShown = !!(ex.hint_md && st.hint_shown);
  // Plans without a hint start at the tutor step.
  const hintDone = !ex.hint_md || hintShown;
  const tutorLeft = Math.max(0, TUTOR_HINTS - tutorHintsUsed(ex, st));
  const solved = S.showSolution[ex.id] || st.status === "solution_shown";
  const keepQuestion = document.getElementById("ask") ? document.getElementById("ask").value : "";
  el.textContent = "";

  renderReview(el, ex, st);

  if (hintShown) {
    el.append(h("div", { class: "hint" }, iconLabel("span", { class: "who" }, "bulb", "Hint"), h("div", { class: "body" }, md(ex.hint_md))));
  }
  for (const reply of replies) {
    const body = h("div", { class: "body" });
    if (reply.error) body.append(h("span", { text: reply.error }));
    else body.append(reply.text ? md(reply.text) : h("span", { class: "muted", text: "Thinking…" }));
    el.append(h("div", { class: "hint tutor-reply" + (reply.streaming ? " streaming" : "") },
      iconLabel("span", { class: "who" }, "chat", "Tutor"),
      reply.question ? h("span", { class: "q", text: "You asked: " + reply.question }) : null,
      body,
    ));
  }

  if (solved) {
    el.append(h("div", { class: "stack", style: "gap: 8px" },
      h("span", { class: "eyebrow", text: "Reference solution" }),
      h("pre", { class: "term", text: ex.reference_solution }),
      h("div", { class: "row" }, h("button", { class: "btn secondary", type: "button", onclick: () => { editor.setValue(ex.reference_solution); editor.focus(); }, text: "Copy into editor" })),
    ));
    return;
  }

  if (!hintDone) {
    el.append(h("div", { class: "help-line" }, iconLabel("button", { class: "linkish help-link", type: "button", onclick: () => showStaticHint(ex, st) }, "bulb", "Stuck? Show the hint")));
    return;
  }

  // While a reply streams, its hint is not counted yet, so the field stays (disabled) until it lands.
  if (ai.available && tutorLeft > 0) {
    if (S.tutorOpen[ex.id] || replies.length) {
      const input = h("input", { type: "text", id: "ask", maxlength: "500", placeholder: "Optional: ask a specific question", autocomplete: "off", value: keepQuestion });
      const btn = h("button", { class: "btn secondary", type: "button", disabled: S.helping, text: S.helping ? "Thinking…" : "Ask" });
      const ask = () => doHelp(input.value.trim());
      btn.addEventListener("click", ask);
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); ask(); } });
      el.append(h("div", { class: "tutor-ask" }, input, btn));
      el.append(h("p", { class: "muted help-note tabnum", text: tutorLeft + " tutor hint" + (tutorLeft > 1 ? "s" : "") + " left. Leave the question empty for a nudge." }));
    } else {
      el.append(h("div", { class: "help-line" }, iconLabel("button", {
        class: "linkish help-link", type: "button",
        onclick: () => { S.tutorOpen[ex.id] = true; renderTutor(); const a = document.getElementById("ask"); if (a) a.focus(); },
      }, "chat", ex.hint_md ? "Still stuck? Ask the tutor" : "Stuck? Ask the tutor")));
    }
  } else if (!ai.available && tutorLeft > 0) {
    el.append(h("p", { class: "muted help-note", text: "The tutor needs Claude access, which is off for this page." }));
  }

  if (S.confirm === "solution") {
    el.append(h("div", { class: "confirm" },
      h("span", { text: "This marks the exercise as completed with the solution. Show it?" }),
      h("span", { class: "spacer" }),
      h("button", { class: "btn", type: "button", onclick: revealSolution, text: "Show solution" }),
      h("button", { class: "btn secondary", type: "button", onclick: () => { S.confirm = null; renderTutor(); }, text: "Cancel" }),
    ));
  } else {
    el.append(h("div", { class: "help-line" }, h("button", { class: "linkish quiet", type: "button", onclick: () => { S.confirm = "solution"; renderTutor(); }, text: "Show solution…" })));
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

// The plan's own hint comes first: it is free and instant.
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
  if (!ai.available || TUTOR_HINTS - tutorHintsUsed(ex, st) <= 0) return;
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
    const res = await ai.help({ lang: langOf(S.plan), exercise: ex, lesson: lessonOf(S.plan, ex), code: editor.getValue(), run: S.lastRun[ex.id], level, question, shownHint: !!st.hint_shown }, {
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
    const res = await ai.review({ lang: langOf(S.plan), exercise: ex, code, level: S.plan.level }, {
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
