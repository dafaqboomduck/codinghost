async function startGeneration(topic, level, count, language) {
  const lang = LANGS[language] || LANGS.python;
  dbg.log("view", { view: "generating", topic, level, count, language: lang.id });
  renderRuntimeChip(false);
  const controller = new AbortController();
  let phase = "ai";
  S.gen = { topic, level, count, language: lang.id, controller, steps: [{ label: "Claude writes " + count + " exercises", sub: "Waiting for Claude", state: "active" }], error: null };
  setCrumb("New plan: " + topic);
  renderGenerating();
  try {
    // Without a working runtime no exercise can be checked, so do not spend a Claude call on the plan.
    if (langDown(lang)) throw { code: "runtime", message: lang.label + " could not load, so exercises cannot be checked. " + lang.runner.status.detail };
    let chars = 0;
    const raw = await ai.generatePlan(lang, topic, level, count, {
      signal: controller.signal,
      onText: ({ text }) => {
        chars = text.length;
        S.gen.steps[0].sub = "Writing… " + chars.toLocaleString() + " characters so far";
        renderGenerating();
      },
    });
    if (S.gen.controller !== controller) return;
    if (raw && raw.not_a_topic) throw notATopicError();
    if (raw && raw.unsupported_package) throw unsupportedPackageError(lang, raw);
    const n = raw && Array.isArray(raw.exercises) ? raw.exercises.length : 0;
    const nl = raw && Array.isArray(raw.lessons) ? raw.lessons.length : 0;
    S.gen.steps[0] = { label: "Claude wrote " + (nl ? nl + " lessons and " : "") + n + " exercises", sub: (raw && raw.summary) || "", state: "done" };
    renderGenerating();
    await lang.runner.whenReady().catch(() => { throw { code: "runtime", message: lang.label + " could not load, so exercises cannot be checked. " + lang.runner.status.detail }; });
    const { exercises, lessons } = await validatePlan(lang, raw, level, (i, state, label, sub) => {
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
      language: lang.id,
      summary: String(raw.summary || ""),
      lessons,
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
    if (e && (e.code === "unsupported" || e.code === "not_a_topic")) {
      S.gen.steps[0] = { label: "No plan written", sub: "", state: "fail" };
      S.gen.unsupported = e.code;
    }
    if (e && (e.code === "too_few" || e.code === "runtime" || e.code === "unsupported" || e.code === "not_a_topic")) S.gen.error = e.message;
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
      h("p", { class: "eyebrow", text: LANGS[g.language].label + " · " + g.level + " · " + g.count + " exercises" }),
      h("h1", { text: g.topic }),
    ),
    h("div", { class: "panel" }, steps),
    g.error
      ? h("div", { class: "stack" },
          h("div", { class: "notice bad", text: g.error }),
          h("div", { class: "row" },
            // Retrying the same topic would only be refused again.
            g.unsupported ? null : h("button", { class: "btn", type: "button", onclick: () => startGeneration(g.topic, g.level, g.count, g.language), disabled: !ai.available || langDown(LANGS[g.language]), text: "Try again" }),
            g.unsupported === "not_a_topic" ? h("button", { class: "btn", type: "button", onclick: () => editPrompt(g), text: "Edit prompt" }) : null,
            h("button", { class: "btn secondary", type: "button", onclick: () => goHome(), text: "Back to plans" }),
          ))
      : h("div", { class: "row" }, h("button", { class: "btn secondary", type: "button", onclick: () => { g.controller.abort(); goHome(); }, text: "Cancel" })),
  ));
}

function unsupportedPackageError(lang, raw) {
  const pkg = String(raw.unsupported_package).slice(0, 60);
  const suggestion = raw.suggestion ? " Try a " + (lang.id === "python" ? "standard library" : "core JavaScript") + " topic instead, for example: " + String(raw.suggestion).slice(0, 120) + "." : "";
  const why = lang.id === "python"
    ? "The " + pkg + " package is not available here. CodingHost runs Python in your browser with only the standard library"
    : pkg + " is not available here. CodingHost runs plain JavaScript in your browser, without libraries, the DOM or Node.js";
  return { code: "unsupported", message: why + ", so it cannot build a plan about " + pkg + "." + suggestion };
}

function notATopicError() {
  return { code: "not_a_topic", message: "I didn't understand that. I cannot create a lesson for you using the input you gave me. Please edit the prompt and try again." };
}

// goHome clears S.gen, so the form values travel through S.draft instead.
function editPrompt(g) {
  S.draft = { topic: g.topic, level: g.level, count: g.count, language: g.language };
  goHome();
}
