async function startGeneration(topic, level, count) {
  dbg.log("view", { view: "generating", topic, level, count });
  const controller = new AbortController();
  let phase = "ai";
  S.gen = { topic, level, count, controller, steps: [{ label: "Claude writes " + count + " exercises", sub: "Waiting for Claude", state: "active" }], error: null };
  setCrumb("New plan: " + topic);
  renderGenerating();
  try {
    let chars = 0;
    const raw = await ai.generatePlan(topic, level, count, {
      signal: controller.signal,
      onText: ({ text }) => {
        chars = text.length;
        S.gen.steps[0].sub = "Writing… " + chars.toLocaleString() + " characters so far";
        renderGenerating();
      },
    });
    if (S.gen.controller !== controller) return;
    const n = raw && Array.isArray(raw.exercises) ? raw.exercises.length : 0;
    S.gen.steps[0] = { label: "Claude wrote " + n + " exercises", sub: (raw && raw.summary) || "", state: "done" };
    renderGenerating();
    await runner.whenReady().catch(() => { throw { code: "python", message: "Python could not load, so exercises cannot be checked. " + runner.status.detail }; });
    const exercises = await validatePlan(raw, level, (i, state, label, sub) => {
      S.gen.steps[i + 1] = { label: label, sub, state };
      renderGenerating();
    }, controller.signal);
    if (S.gen.controller !== controller) return;
    if (exercises.length < MIN_EXERCISES) {
      throw { code: "too_few", message: `Only ${exercises.length} of ${n} exercises passed the checks. That is too few for a plan.` };
    }
    const plan = {
      id: newId("p"),
      topic: String(raw.topic || topic).slice(0, 200),
      level,
      summary: String(raw.summary || ""),
      exercises,
      created_at: new Date().toISOString(),
    };
    const progress = newProgress(plan);
    phase = "save";
    await store.savePlan(plan);
    await store.saveProgress(plan.id, progress);
    store.saveProfile({ last_plan_id: plan.id, updated_at: new Date().toISOString() }).catch(() => {});
    S.gen = null;
    openPlan(plan, progress);
  } catch (e) {
    if (!S.gen || S.gen.controller !== controller) return;
    if (e && e.code === "cancelled") { goHome(); return; }
    if (e && (e.code === "too_few" || e.code === "python")) S.gen.error = e.message;
    else S.gen.error = phase === "save" ? dbErrorMessage(e) : aiErrorMessage(e);
    if (e && e.code === "not_granted") ai.init(null);
    renderGenerating();
  }
}

function renderGenerating() {
  const g = S.gen;
  if (!g) return;
  viewEl.textContent = "";
  const steps = h("ol", { class: "steps" }, g.steps.filter(Boolean).map((s) =>
    h("li", { class: s.state },
      h("span", { class: "mark", "aria-hidden": "true", text: s.state === "done" ? "✓" : s.state === "fail" ? "✗" : "…" }),
      h("div", {}, h("div", { text: s.label }), s.sub ? h("div", { class: "sub", text: s.sub }) : null),
    ),
  ));
  viewEl.append(h("div", { class: "gen" },
    h("div", { class: "stack", style: "gap: 6px" },
      h("p", { class: "eyebrow", text: g.level + " · " + g.count + " exercises" }),
      h("h1", { text: g.topic }),
    ),
    h("div", { class: "panel" }, steps),
    g.error
      ? h("div", { class: "stack" },
          h("div", { class: "notice bad", text: g.error }),
          h("div", { class: "row" },
            h("button", { class: "btn", type: "button", onclick: () => startGeneration(g.topic, g.level, g.count), disabled: !ai.available, text: "Try again" }),
            h("button", { class: "btn secondary", type: "button", onclick: () => goHome(), text: "Back to plans" }),
          ))
      : h("div", { class: "row" }, h("button", { class: "btn secondary", type: "button", onclick: () => { g.controller.abort(); goHome(); }, text: "Cancel" })),
  ));
}
