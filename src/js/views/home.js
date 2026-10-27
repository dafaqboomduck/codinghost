async function goHome() {
  if (saveTimer) saveProgressNow();
  if (S.gen && S.gen.controller) S.gen.controller.abort();
  S.plan = null;
  S.progress = null;
  S.gen = null;
  S.confirm = null;
  S.lesson = null;
  editor = null;
  setCrumb("");
  dbg.log("view", { view: "home" });
  renderHome();
  if (S.blocked || !S.caps) return;
  try {
    S.plans = await store.listPlans();
  } catch (e) {
    S.plans = [];
    toast("Could not load your plans. " + dbErrorMessage(e));
  }
  if (!S.plan && !S.gen) renderHome();
}

function renderHome() {
  viewEl.textContent = "";
  const head = h("div", { class: "home-head" },
    h("p", { class: "eyebrow", text: "Python practice, written by Claude" }),
    h("h1", { text: "Pick a topic. Solve it one function at a time." }),
    h("p", { class: "muted", text: "Claude writes a short plan of exercises for your level. Each one comes with tests that run in your browser, and a tutor who gives hints instead of answers." }),
  );
  viewEl.append(head);

  if (S.blocked) {
    viewEl.append(h("div", { class: "panel stack", style: "max-width: 640px" },
      h("h2", { text: S.blocked.title }),
      h("p", { text: S.blocked.body }),
    ));
    return;
  }

  const grid = h("div", { class: "home-grid" }, renderNewPlanForm(), renderPlanList());
  viewEl.append(grid);
}

function renderNewPlanForm() {
  const canGenerate = ai.available;
  const level = h("div", { class: "seg", role: "radiogroup", "aria-label": "Level" },
    ["beginner", "intermediate", "advanced"].map((lv, i) =>
      h("label", {}, h("input", { type: "radio", name: "level", id: "level-" + lv, value: lv, checked: i === 0 }), h("span", { text: lv[0].toUpperCase() + lv.slice(1) })),
    ),
  );
  const count = h("select", { id: "count" }, [5, 6, 7, 8].map((n) => h("option", { value: String(n), selected: n === 6, text: n + " exercises" })));
  const topic = h("input", { type: "text", id: "topic", maxlength: "200", placeholder: "e.g. Python lists and loops", autocomplete: "off", required: true });
  const submit = h("button", { class: "btn", type: "submit", disabled: !canGenerate || !S.caps, text: "Generate plan" });
  const form = h("form", { class: "panel stack", id: "new-plan" },
    h("h2", { text: "New plan" }),
    h("label", { class: "field", for: "topic" }, "Topic", topic),
    h("div", { class: "field" }, h("span", { text: "Level" }), level),
    h("label", { class: "field", for: "count" }, "Length", count),
    h("div", { class: "row" }, submit),
    h("p", { class: "muted", style: "font-size: 13px" }, "Before you see an exercise, its reference solution is run against its tests. Broken exercises are fixed or dropped."),
    !canGenerate && S.caps ? h("div", { class: "notice warn", text: "Claude access is off for this page, so new plans cannot be written. You can still continue your saved plans." }) : null,
  );
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const t = topic.value.trim();
    if (!t) { topic.focus(); return; }
    const lv = form.querySelector('input[name="level"]:checked').value;
    startGeneration(t, lv, Number(count.value));
  });
  return form;
}

function renderPlanList() {
  const panel = h("section", { class: "panel stack plan-list" }, h("h2", { text: "Your plans" }));
  if (!S.caps || S.plans === null) {
    panel.append(h("div", { class: "empty" }, h("span", { text: S.caps ? "Loading your plans…" : "Connecting to claude.ai…" })));
    return panel;
  }
  if (!S.plans.length) {
    panel.append(h("div", { class: "empty" },
      h("strong", { text: "No plans yet" }),
      h("span", { text: "Write a topic in the form and generate a plan. It appears here with your progress, so you can stop and continue later." }),
    ));
    return panel;
  }
  const list = h("div", { class: "plans" });
  for (const { plan, progress } of S.plans) {
    const total = plan.exercises.length;
    const done = countDone(plan, progress);
    const pct = total ? Math.round((done / total) * 100) : 0;
    const when = (progress && progress.updated_at) || plan.created_at;
    list.append(h("div", { class: "plan-item" },
      h("div", { class: "stack", style: "gap: 6px; min-width: 0" },
        h("span", { class: "title", text: plan.topic }),
        h("div", { class: "meta" },
          h("span", { class: "chip plain", text: plan.level }),
          h("span", { class: "meter", "aria-hidden": "true" }, h("i", { style: "width: " + pct + "%" })),
          h("span", { class: "tabnum", text: done + " / " + total + " done" }),
          when ? h("span", { text: new Date(when).toLocaleDateString(undefined, { day: "numeric", month: "short" }) }) : null,
        ),
      ),
      h("div", { class: "row", style: "gap: 4px" },
        h("button", { class: "btn secondary", type: "button", onclick: () => openPlan(plan, progress), text: done === total ? "Review" : done ? "Continue" : "Start" }),
        trashButton("Delete plan " + plan.topic, () => { S.confirm = "delete:" + plan.id; renderHome(); }),
      ),
      S.confirm === "delete:" + plan.id ? h("div", { class: "confirm", style: "grid-column: 1 / -1" },
        h("span", { text: "Delete this plan and its progress? This cannot be undone." }),
        h("span", { class: "spacer" }),
        h("button", { class: "btn danger", type: "button", onclick: () => deletePlan(plan.id), text: "Delete" }),
        h("button", { class: "btn secondary", type: "button", onclick: () => { S.confirm = null; renderHome(); }, text: "Cancel" }),
      ) : null,
    ));
  }
  panel.append(list);
  return panel;
}

async function deletePlan(id) {
  S.confirm = null;
  dbg.log("delete_plan", { plan: id });
  try {
    await store.deletePlan(id);
    S.plans = S.plans.filter((x) => x.plan.id !== id);
  } catch (e) {
    toast("Could not delete the plan. " + dbErrorMessage(e));
  }
  if (!S.plan && !S.gen) renderHome();
}

// h() builds HTML elements only, so the SVG icon goes in as markup. The string is constant, never user text.
const TRASH_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';
function trashButton(label, onclick) {
  const btn = h("button", { class: "btn ghost icon-btn", type: "button", "aria-label": label, title: label, onclick });
  btn.innerHTML = TRASH_SVG;
  return btn;
}
