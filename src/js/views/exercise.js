function openPlan(plan, progress) {
  S.plan = plan;
  S.progress = progress || newProgress(plan);
  const idx = Math.min(S.progress.current_index || 0, plan.exercises.length - 1);
  store.saveProfile({ last_plan_id: plan.id, updated_at: new Date().toISOString() }).catch(() => {});
  const li = lessonIndex(plan, S.progress.current_lesson);
  if (li >= 0 && canOpen(firstExerciseOf(plan, plan.lessons[li]))) openLesson(li);
  else openExercise(idx);
}

function canOpen(i) {
  const ex = S.plan.exercises[i];
  return ex && exState(ex).status !== "locked";
}

function openExercise(i) {
  if (!canOpen(i)) return;
  if (saveTimer) saveProgressNow();
  S.index = i;
  S.lesson = null;
  S.confirm = null;
  if (S.progress.current_index !== i || S.progress.current_lesson) { S.progress.current_index = i; S.progress.current_lesson = null; saveProgressSoon(); }
  const ex = S.plan.exercises[i];
  dbg.log("view", { view: "exercise", plan: S.plan.id, exercise: ex.id, status: exState(ex).status });
  setCrumb("");
  viewEl.textContent = "";

  const strip = h("nav", { class: "strip", id: "strip", "aria-label": "Exercises" });
  const visible = ex.tests.filter((t) => !t.hidden);
  const hiddenCount = ex.tests.length - visible.length;
  const doctest = h("pre", { class: "doctest" },
    visible.map((t, k) => [
      k ? "\n" : null,
      h("span", { class: "ps", text: ">>> " }), callText(ex.function_name, t.args_py), "\n", t.expected_py,
    ]),
  );

  // The lesson stays one click away instead of on screen: recalling it is the practice.
  const lesson = lessonOf(S.plan, ex);
  const task = h("section", { class: "panel task" },
    lesson ? h("div", {}, h("button", { class: "btn ghost back-link", type: "button", onclick: () => openLesson(lessonIndex(S.plan, lesson.id)), text: "← Lesson " + (lessonIndex(S.plan, lesson.id) + 1) + ": " + lesson.title })) : null,
    h("p", { class: "eyebrow", text: "Exercise " + (i + 1) + " of " + S.plan.exercises.length + " · " + ex.concept }),
    h("h2", { text: ex.title }),
    md(ex.prompt_md),
    h("div", { class: "stack", style: "gap: 6px" },
      h("h3", { text: "Examples" }),
      doctest,
      hiddenCount ? h("p", { class: "muted", style: "font-size: 13px", text: "Submit also runs " + hiddenCount + " hidden test" + (hiddenCount > 1 ? "s" : "") + "." }) : null,
    ),
  );

  const host = h("div", {});
  const work = h("section", { class: "work" },
    h("div", { class: "editor-box" }, h("div", { class: "editor-head" }, h("span", { text: "solution.py" }), h("span", { class: "spacer" }), h("span", { text: "Ctrl+Enter runs" })), host),
    h("div", { id: "actions", class: "stack", style: "gap: 10px" }),
    h("div", { id: "output", class: "out", "aria-live": "polite" }),
  );
  const side = h("div", { class: "side" }, task, h("div", { id: "tutor", class: "panel tutor" }));

  viewEl.append(strip, h("div", { id: "banner" }), h("div", { class: "ex-grid" }, side, work));

  const st = exState(ex);
  editor = CodeMirror(host, {
    value: st.code != null ? st.code : ex.starter_code,
    mode: "python",
    lineNumbers: true,
    indentUnit: 4,
    tabSize: 4,
    indentWithTabs: false,
    matchBrackets: true,
    autoCloseBrackets: true,
    styleActiveLine: true,
    viewportMargin: Infinity,
    extraKeys: {
      "Ctrl-Enter": () => doRun(false),
      "Cmd-Enter": () => doRun(false),
      "Shift-Ctrl-Enter": () => doRun(true),
      "Shift-Cmd-Enter": () => doRun(true),
      Tab: (cm) => (cm.somethingSelected() ? cm.indentSelection("add") : cm.replaceSelection("    ", "end")),
      "Shift-Tab": (cm) => cm.indentSelection("subtract"),
    },
  });
  editor.on("change", () => {
    clearErrorLine();
    exState(ex).code = editor.getValue();
    saveProgressSoon();
  });

  renderStrip();
  renderBanner();
  renderActions();
  renderOutput();
  renderTutor();
  window.scrollTo({ top: 0 });
}

// Course header: title and level on the left, the track and a done count on the right.
// It is the only place that shows course-wide progress; the task card names the lesson and exercise.
// Lesson markers and exercise dots share the dot language of the lesson pages.
// h() builds HTML elements only, so the icons go in as markup; the strings are constant.
const STRIP_ICONS = {
  book: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/></svg>',
  done: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>',
  locked: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
};

function renderStrip() {
  const strip = document.getElementById("strip");
  if (!strip) return;
  strip.textContent = "";
  const track = h("div", { class: "track" });
  let group = null;
  let prevLesson;
  S.plan.exercises.forEach((ex, i) => {
    const st = exState(ex);
    const lesson = lessonOf(S.plan, ex);
    // Plans without lessons get a single group of dots and no markers.
    if (!group || lesson !== prevLesson) {
      group = h("div", { class: "track-group" });
      track.append(group);
      if (lesson) group.append(lessonMarker(lesson));
    }
    prevLesson = lesson;
    const current = S.lesson == null && i === S.index;
    const state = current ? "current" : st.status === "passed" ? "passed" : st.status === "solution_shown" ? "solution" : st.status === "locked" ? "locked" : "open";
    const stateLabel = { current: "you are here", passed: "passed", solution: "completed with solution", locked: "locked", open: "open" }[state];
    if (lesson || group.childElementCount) group.append(h("span", { class: "seg" + (isDone(st) ? " done" : ""), "aria-hidden": "true" }));
    group.append(h("button", {
      class: "step " + state, type: "button", disabled: st.status === "locked",
      "aria-current": current ? "step" : null,
      "aria-label": "Exercise " + (i + 1) + ", " + ex.title + ", " + stateLabel,
      title: "Exercise " + (i + 1) + ": " + ex.title + " (" + stateLabel + ")",
      onclick: () => openExercise(i),
    }));
  });

  const done = countDone(S.plan, S.progress);
  const total = S.plan.exercises.length;
  strip.append(
    h("div", { class: "course-name" }, h("h1", { class: "course-title", text: S.plan.topic }), h("span", { class: "chip plain", text: S.plan.level })),
    h("div", { class: "course-progress" }, track,
      h("span", { class: "count tabnum", title: done + " of " + total + " done", "aria-label": done + " of " + total + " exercises done", text: done + "/" + total })),
  );
}

function lessonMarker(lesson) {
  const li = lessonIndex(S.plan, lesson.id);
  const mine = S.plan.exercises.filter((ex) => ex.lesson_id === lesson.id).map(exState);
  const locked = mine[0].status === "locked";
  const here = S.lesson === li || (S.lesson == null && S.plan.exercises[S.index].lesson_id === lesson.id);
  const state = mine.every(isDone) ? "done" : here ? "current" : locked ? "locked" : "open";
  const btn = h("button", {
    class: "step lesson " + state, type: "button", disabled: locked,
    "aria-current": S.lesson === li ? "step" : null,
    "aria-label": "Lesson " + (li + 1) + ", " + lesson.title + (locked ? ", locked" : ""),
    title: "Lesson " + (li + 1) + ": " + lesson.title,
    onclick: () => openLesson(li),
  });
  btn.innerHTML = STRIP_ICONS[state === "done" ? "done" : locked ? "locked" : "book"];
  return btn;
}

function planComplete() {
  return S.plan.exercises.every((ex) => isDone(exState(ex)));
}

function renderBanner() {
  const el = document.getElementById("banner");
  if (!el) return;
  el.textContent = "";
  if (planComplete()) {
    el.append(h("div", { class: "done-banner", style: "margin-bottom: 18px" },
      h("span", { text: "Plan complete." }),
      h("span", { class: "spacer" }),
      h("button", { class: "btn", type: "button", onclick: renderComplete, text: "See summary" }),
    ));
  }
}

function renderActions() {
  const el = document.getElementById("actions");
  if (!el) return;
  const ex = S.plan.exercises[S.index];
  const st = exState(ex);
  const pyReady = runner.status.state === "ready";
  const busy = S.running || !pyReady;
  el.textContent = "";
  const next = S.plan.exercises[S.index + 1];
  const row = h("div", { class: "actions" },
    h("button", { class: "btn secondary", type: "button", disabled: busy, onclick: () => doRun(false) }, "Run", h("span", { class: "kbd", text: "Ctrl+↵" })),
    h("button", { class: "btn", type: "button", disabled: busy, onclick: () => doRun(true) }, "Submit", h("span", { class: "kbd", text: "Ctrl+Shift+↵" })),
    isDone(st) && next ? nextButton(ex, next) : null,
    h("span", { class: "spacer" }),
    h("button", { class: "btn ghost", type: "button", onclick: () => { S.confirm = "reset"; renderActions(); }, text: "Reset code" }),
  );
  el.append(row);
  if (!pyReady) {
    el.append(h("div", { class: "notice " + (runner.status.state === "failed" ? "bad" : "warn"), text: runner.status.state === "failed" ? "Python could not load: " + runner.status.detail : "Loading Python… the first load takes a few seconds." }));
  }
  if (S.confirm === "reset") {
    el.append(h("div", { class: "confirm" },
      h("span", { text: "Replace your code with the starter code?" }),
      h("span", { class: "spacer" }),
      h("button", { class: "btn danger", type: "button", onclick: () => { editor.setValue(ex.starter_code); S.confirm = null; renderActions(); saveProgressNow(); }, text: "Reset" }),
      h("button", { class: "btn secondary", type: "button", onclick: () => { S.confirm = null; renderActions(); }, text: "Cancel" }),
    ));
  }
}

// Crossing into a new lesson opens that lesson first, not its first exercise.
function nextButton(ex, next) {
  const lesson = lessonOf(S.plan, next);
  if (lesson && next.lesson_id !== ex.lesson_id) {
    return h("button", { class: "btn secondary", type: "button", onclick: () => openLesson(lessonIndex(S.plan, lesson.id)), text: "Next lesson →" });
  }
  return h("button", { class: "btn secondary", type: "button", onclick: () => openExercise(S.index + 1), text: "Next exercise →" });
}

function clearErrorLine() {
  if (editor && editor._errLine != null) {
    editor.removeLineClass(editor._errLine, "background", "cm-errline");
    editor._errLine = null;
  }
}

function markErrorLine(line) {
  clearErrorLine();
  if (!editor || !line || line < 1 || line > editor.lineCount()) return;
  editor._errLine = line - 1;
  editor.addLineClass(line - 1, "background", "cm-errline");
}

async function doRun(isSubmit) {
  if (S.running || runner.status.state !== "ready" || !S.plan) return;
  const ex = S.plan.exercises[S.index];
  const exIndex = S.index;
  const code = editor.getValue();
  const tests = isSubmit ? ex.tests : ex.tests.filter((t) => !t.hidden);
  S.running = true;
  renderActions();
  const out = document.getElementById("output");
  out.textContent = "";
  out.append(h("div", { class: "out-summary muted", text: isSubmit ? "Running all tests…" : "Running…" }));
  let res;
  let watchdog = null;
  try {
    res = await Promise.race([
      runner.run(code, ex.function_name, tests, RUN_TIMEOUT_MS, { purpose: isSubmit ? "submit" : "run", exercise: ex.id }),
      new Promise((resolve) => {
        watchdog = setTimeout(() => {
          dbg.log("run_watchdog", { stage: runner.stage });
          resolve({ error: "The test runner did not answer (stuck while " + runner.stage + "). Reload the page and try again.", results: [], stdout: "", stderr: "" });
        }, RUN_TIMEOUT_MS + 20000);
      }),
    ]);
  } catch (e) {
    res = { error: "Python is not available: " + ((e && e.message) || e), results: [], stdout: "", stderr: "" };
  }
  clearTimeout(watchdog);
  S.running = false;
  try {
    showRunResult(res, isSubmit, ex, exIndex, code);
  } catch (e) {
    console.error("CodingHost: could not show the results", e);
    try { renderActions(); } catch (e2) { /* ignore */ }
    const out = document.getElementById("output");
    if (out) {
      out.textContent = "";
      out.append(h("pre", { class: "term err", text: "The page hit an error while showing the results: " + ((e && e.message) || e) }));
    }
  }
}

function showRunResult(res, isSubmit, ex, exIndex, code) {
  res.submit = isSubmit;
  S.lastRun[ex.id] = res;
  if (S.index !== exIndex || !S.plan) return;

  const st = exState(ex);
  st.code = code;
  if (isSubmit) {
    const allPass = !res.error && res.results.length === ex.tests.length && res.results.every((r) => r.status === "pass");
    res.allPass = allPass;
    if (allPass) {
      if (st.status !== "passed") { st.status = "passed"; st.passed_at = new Date().toISOString(); }
      unlockNext(exIndex);
    } else {
      st.attempts = (st.attempts || 0) + 1;
    }
  }
  saveProgressNow();
  markErrorLine(res.error_line || ((res.results || []).find((r) => r.line) || {}).line);
  renderStrip();
  renderBanner();
  renderActions();
  renderOutput();
  renderTutor();
}

function unlockNext(i) {
  const next = S.plan.exercises[i + 1];
  if (next && exState(next).status === "locked") exState(next).status = "open";
  S.progress.unlocked_index = Math.max(S.progress.unlocked_index || 0, Math.min(i + 1, S.plan.exercises.length - 1));
}

function renderOutput() {
  const el = document.getElementById("output");
  if (!el) return;
  const ex = S.plan.exercises[S.index];
  const res = S.lastRun[ex.id];
  const st = exState(ex);
  el.textContent = "";
  if (!res) {
    if (isDone(st)) el.append(h("div", { class: "notice ok", text: st.status === "passed" ? "You passed this exercise. Run it again any time." : "Completed with the solution shown." }));
    return;
  }
  const results = res.results || [];
  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.length - passed;
  const ms = res.ms != null ? Math.round(res.ms) + " ms" : "";
  let summary;
  if (res.timed_out) summary = h("span", { class: "chip bad plain", text: "Timed out" });
  else if (res.error) summary = h("span", { class: "chip bad plain", text: "Error" });
  else if (res.submit && res.allPass) summary = h("span", { class: "chip ok plain", text: "Passed" });
  else if (failed) summary = h("span", { class: "chip bad plain", text: "Failing" });
  else summary = h("span", { class: "chip ok plain", text: "Looks good" });
  const counts = results.length ? `${passed} passed${failed ? ", " + failed + " failed" : ""}` : "";
  el.append(h("div", { class: "out-summary" }, summary, h("span", { class: "tabnum", text: counts }), ms ? h("span", { class: "ms", text: "in " + ms }) : null));

  if (res.submit && res.allPass) {
    const next = S.plan.exercises[S.index + 1];
    const nextLesson = next && next.lesson_id !== ex.lesson_id ? lessonOf(S.plan, next) : null;
    const unlocked = nextLesson ? "Lesson " + (lessonIndex(S.plan, nextLesson.id) + 1) + " is unlocked." : "Exercise " + (S.index + 2) + " is unlocked.";
    el.append(h("div", { class: "notice ok", text: next ? "All " + results.length + " tests pass. " + unlocked : "All tests pass. That was the last exercise." }));
  } else if (!res.submit && !res.error && !failed && results.length) {
    el.append(h("p", { class: "muted", style: "font-size: 13px", text: "Visible tests pass. Submit runs the hidden tests too." }));
  }

  if (res.error) el.append(h("pre", { class: "term err", text: res.error }));

  if (results.length) {
    const list = h("div", { class: "tests" });
    for (const r of results) {
      const icon = r.status === "pass" ? "✓" : r.status === "fail" ? "✗" : "!";
      let call;
      let detail = null;
      if (r.hidden) {
        call = "Hidden test " + (r.index + 1);
        if (r.status !== "pass") detail = r.status === "error" ? (r.message || "").split("\n").pop() : "Returned a wrong value. Inputs are hidden.";
      } else {
        call = callText(ex.function_name, r.args);
        if (r.status === "pass") detail = "→ " + r.expected;
        else if (r.status === "fail") detail = "expected " + r.expected + "\n     got " + r.actual;
        else detail = r.message;
      }
      list.append(h("div", { class: "test " + r.status },
        h("span", { class: "icon", "aria-label": r.status, text: icon }),
        h("div", { style: "min-width: 0" }, h("div", { class: "call", text: call }), detail ? h("div", { class: "detail", text: detail }) : null),
      ));
    }
    el.append(list);
  }
  if (res.stdout) el.append(h("div", { class: "stack", style: "gap: 6px" }, h("span", { class: "eyebrow", text: "Printed output" }), h("pre", { class: "term", text: res.stdout })));
  if (res.stderr) el.append(h("pre", { class: "term err", text: res.stderr }));
}
