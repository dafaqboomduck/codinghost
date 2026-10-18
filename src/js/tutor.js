function renderTutor() {
  const el = document.getElementById("tutor");
  if (!el) return;
  const ex = S.plan.exercises[S.index];
  const st = exState(ex);
  const hints = S.hints[ex.id] || [];
  const level = Math.min((st.hints_used || 0) + 1, 3);
  const keepQuestion = document.getElementById("ask") ? document.getElementById("ask").value : "";
  el.textContent = "";
  el.append(h("div", { class: "row" }, h("h3", { text: "Tutor" }), h("span", { class: "spacer" }),
    ai.available ? h("span", { class: "muted tabnum", style: "font-size: 13px", text: "Hints used: " + (st.hints_used || 0) }) : null));

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
    const btn = h("button", { class: "btn secondary", type: "button", disabled: S.helping, text: S.helping ? "Thinking…" : hints.length ? "Next hint (" + level + " of 3)" : "Help me" });
    const ask = () => doHelp(input.value.trim());
    btn.addEventListener("click", ask);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); ask(); } });
    el.append(h("div", { class: "tutor-ask" }, input, btn));
  } else {
    el.append(h("p", { class: "muted", text: "The tutor needs Claude access, which is off for this page." }));
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

async function doHelp(question) {
  if (S.helping || !ai.available) return;
  const ex = S.plan.exercises[S.index];
  const st = exState(ex);
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
    const res = await ai.help({ exercise: ex, code: editor.getValue(), run: S.lastRun[ex.id], level, question }, {
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
