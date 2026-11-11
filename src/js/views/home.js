async function goHome() {
  if (saveTimer) saveProgressNow();
  if (S.gen && S.gen.controller) S.gen.controller.abort();
  S.plan = null;
  S.progress = null;
  S.gen = null;
  S.confirm = null;
  S.menu = null;
  S.undo = null;
  S.lesson = null;
  // Keyed by exercise id, which every plan reuses (ex1, ex2...), so they belong to one plan visit.
  S.lastRun = {};
  S.hints = {};
  S.showSolution = {};
  editor = null;
  setCrumb("");
  renderRuntimeChip(false);
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
    h("p", { class: "eyebrow", text: "Coding practice, written by Claude" }),
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

// What the topic placeholder and the scope note say for each language.
const FORM_TEXT = {
  python: { placeholder: "e.g. Python lists and loops", note: "Plans use only Python's core packages (the standard library). Topics that need numpy, pandas, requests and similar packages are not supported." },
  javascript: { placeholder: "e.g. JavaScript arrays and loops", note: "Plans use only core JavaScript. Topics that need the DOM, Node.js or libraries such as React, Express or lodash are not supported." },
};

const langDown = (L) => L.runner.status.state === "failed";

function renderNewPlanForm() {
  const canGenerate = ai.available;
  const draft = S.draft || {};
  const firstUp = (Object.values(LANGS).find((L) => !langDown(L)) || LANGS.python).id;
  const pick = draft.language && !langDown(LANGS[draft.language]) ? draft.language : firstUp;
  const language = h("div", { class: "seg", role: "radiogroup", "aria-label": "Language" },
    Object.values(LANGS).map((L) =>
      h("label", {}, h("input", { type: "radio", name: "language", id: "language-" + L.id, value: L.id, checked: L.id === pick, disabled: langDown(L) }), h("span", { text: L.label })),
    ),
  );
  const level = h("div", { class: "seg", role: "radiogroup", "aria-label": "Level" },
    ["beginner", "intermediate", "advanced"].map((lv, i) =>
      h("label", {}, h("input", { type: "radio", name: "level", id: "level-" + lv, value: lv, checked: draft.level ? lv === draft.level : i === 0 }), h("span", { text: lv[0].toUpperCase() + lv.slice(1) })),
    ),
  );
  const count = h("select", { id: "count" }, [5, 6, 7, 8].map((n) => h("option", { value: String(n), selected: n === (draft.count || 6), text: n + " exercises" })));
  const topic = h("input", { type: "text", id: "topic", maxlength: "200", placeholder: FORM_TEXT[pick].placeholder, autocomplete: "off", required: true, value: draft.topic || "" });
  const note = h("p", { class: "muted", style: "font-size: 13px", text: FORM_TEXT[pick].note });
  const submit = h("button", { class: "btn", id: "gen-submit", type: "submit", disabled: !canGenerate || !S.caps, text: "Generate plan" });
  const form = h("form", { class: "panel stack", id: "new-plan" },
    h("h2", { text: "New plan" }),
    h("div", { class: "field" }, h("span", { text: "Language" }), language),
    h("label", { class: "field", for: "topic" }, "Topic", topic),
    h("div", { class: "field" }, h("span", { text: "Level" }), level),
    h("label", { class: "field", for: "count" }, "Length", count),
    h("div", { class: "row" }, submit),
    note,
    h("p", { class: "muted", style: "font-size: 13px" }, "Before you see an exercise, its reference solution is run against its tests. Broken exercises are fixed or dropped."),
    !canGenerate && S.caps ? h("div", { class: "notice warn", text: "Claude access is off for this page, so new plans cannot be written. You can still continue your saved plans." }) : null,
    h("div", { class: "notice bad", id: "lang-down", hidden: true }),
  );
  language.addEventListener("change", () => {
    const t = FORM_TEXT[form.querySelector('input[name="language"]:checked').value];
    topic.placeholder = t.placeholder;
    note.textContent = t.note;
    updateLanguageGate();
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const t = topic.value.trim();
    if (!t) { topic.focus(); return; }
    const lv = form.querySelector('input[name="level"]:checked').value;
    if (langDown(LANGS[form.querySelector('input[name="language"]:checked').value])) return;
    S.draft = null;
    startGeneration(t, lv, Number(count.value), form.querySelector('input[name="language"]:checked').value);
  });
  queueMicrotask(updateLanguageGate);
  return form;
}

// A runtime can fail after the form is on screen (Python loads in the background),
// so the form is patched in place, keeping what the learner typed.
function updateLanguageGate() {
  const form = document.getElementById("new-plan");
  if (!form) return;
  for (const L of Object.values(LANGS)) {
    const input = document.getElementById("language-" + L.id);
    if (input) input.disabled = langDown(L);
  }
  const checked = form.querySelector('input[name="language"]:checked');
  const L = LANGS[checked ? checked.value : "python"];
  const down = langDown(L);
  document.getElementById("gen-submit").disabled = !ai.available || !S.caps || down;
  const note = document.getElementById("lang-down");
  note.hidden = !down;
  note.textContent = down ? L.label + " could not load in this browser, so plans in " + L.label + " cannot be written. " + (Object.values(LANGS).some((o) => !langDown(o)) ? "Pick another language, or reload the page to try again." : "Reload the page to try again.") : "";
}

function renderPlanList() {
  const head = h("div", { class: "row" }, h("h2", { text: "Your plans" }));
  const panel = h("section", { class: "panel stack plan-list" }, head);
  if (!S.caps || S.plans === null) {
    panel.append(h("div", { class: "empty" }, h("span", { text: S.caps ? "Loading your plans…" : "Connecting to claude.ai…" })));
    return panel;
  }
  const { active, archived } = splitArchived(S.plans);
  // The tab switch only exists while something is archived; restoring the last one drops back to Active.
  if (!archived.length) S.showArchived = false;
  if (archived.length) {
    const tab = (on, text, archivedTab) => h("button", { type: "button", role: "tab", class: on ? "on" : "", "aria-selected": String(on),
      onclick: () => { S.showArchived = archivedTab; S.menu = null; S.confirm = null; renderHome(); }, text });
    head.append(h("span", { class: "spacer" }), h("div", { class: "seg tabs", role: "tablist", "aria-label": "Plan list" },
      tab(!S.showArchived, "Active", false),
      tab(S.showArchived, "Archived · " + archived.length, true),
    ));
  }
  if (S.undo) {
    panel.append(h("div", { class: "notice row undo", role: "status" },
      h("span", { text: "Archived “" + S.undo.topic + "”." }),
      h("span", { class: "spacer" }),
      h("button", { class: "linkish", type: "button", onclick: () => setArchived(S.undo.id, false), text: "Undo" }),
    ));
  }
  const rows = S.showArchived ? archived : active;
  if (rows.length) panel.append(h("div", { class: "plans" }, rows.map(planRow)));
  else if (archived.length) panel.append(h("div", { class: "empty" }, h("span", { text: "All your plans are archived. Generate a new one, or open the Archived tab to pick one up again." })));
  else panel.append(h("div", { class: "empty" },
    h("strong", { text: "No plans yet" }),
    h("span", { text: "Write a topic in the form and generate a plan. It appears here with your progress, so you can stop and continue later." }),
  ));
  return panel;
}

function planRow({ plan, progress }) {
  const total = plan.exercises.length;
  const done = countDone(plan, progress);
  const pct = total ? Math.round((done / total) * 100) : 0;
  const archived = isArchived(plan);
  const when = archived ? plan.archived_at : (progress && progress.updated_at) || plan.created_at;
  const date = (iso) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return h("div", { class: "plan-item" + (archived ? " is-archived" : "") },
    h("div", { class: "stack", style: "gap: 6px; min-width: 0" },
      h("span", { class: "title", text: plan.topic }),
      h("div", { class: "meta" },
        h("span", { class: "chip plain", text: langOf(plan).label }),
        h("span", { class: "chip plain", text: plan.level }),
        isLegacy(plan) ? h("span", { class: "chip plain warn", title: "Made before lessons. Generate a new plan to get them.", text: "legacy" }) : null,
        h("span", { class: "meter", "aria-hidden": "true" }, h("i", { style: "width: " + pct + "%" })),
        h("span", { class: "tabnum", text: done + " / " + total + " done" }),
        when ? h("span", { text: (archived ? "Archived " : "") + date(when) }) : null,
      ),
    ),
    h("div", { class: "row", style: "gap: 4px" },
      h("button", { class: "btn secondary", type: "button", onclick: () => openPlan(plan, progress), text: done === total ? "Review" : done ? "Continue" : "Start" }),
      planMenu(plan, archived),
    ),
    S.confirm === "delete:" + plan.id ? h("div", { class: "confirm", style: "grid-column: 1 / -1" },
      h("span", { text: "Delete this plan and its progress? This cannot be undone." }),
      h("span", { class: "spacer" }),
      h("button", { class: "btn danger", type: "button", onclick: () => deletePlan(plan.id), text: "Delete" }),
      h("button", { class: "btn secondary", type: "button", onclick: () => { S.confirm = null; renderHome(); }, text: "Cancel" }),
    ) : null,
  );
}

function planMenu(plan, archived) {
  const open = S.menu === plan.id;
  const label = "More actions for " + plan.topic;
  const toggle = h("button", { class: "btn ghost icon-btn", type: "button", "aria-label": label, title: label, "aria-haspopup": "menu", "aria-expanded": String(open), "data-plan": plan.id,
    onclick: (e) => { e.stopPropagation(); S.menu = open ? null : plan.id; renderHome(); } });
  toggle.innerHTML = ICONS.dots;
  const item = (icon, text, onclick, cls) => {
    const btn = h("button", { class: cls || "", type: "button", role: "menuitem", onclick: () => { S.menu = null; onclick(); } });
    btn.innerHTML = icon;
    btn.append(text);
    return btn;
  };
  const menu = open ? h("div", { class: "menu", role: "menu" },
    archived ? item(ICONS.restore, "Restore", () => setArchived(plan.id, false)) : item(ICONS.box, "Archive", () => setArchived(plan.id, true)),
    item(ICONS.trash, "Delete…", () => { S.confirm = "delete:" + plan.id; renderHome(); }, "bad"),
  ) : null;
  if (menu) queueMicrotask(() => menu.querySelector("button").focus());
  return h("span", { class: "menu-wrap" }, toggle, menu);
}

// One listener for the whole page: the menu is rebuilt on every renderHome, so per-menu listeners would pile up.
function closeMenu(e) {
  if (!S.menu) return;
  if (e.type === "keydown" && e.key !== "Escape") return;
  if (e.type === "click" && e.target.closest(".menu")) return;
  const id = S.menu;
  S.menu = null;
  if (S.plan || S.gen) return;
  renderHome();
  // Escape hands focus back to the toggle, which renderHome just rebuilt.
  if (e.type === "keydown") { const btn = document.querySelector('.menu-wrap > button[data-plan="' + CSS.escape(id) + '"]'); if (btn) btn.focus(); }
}
document.addEventListener("click", closeMenu);
document.addEventListener("keydown", closeMenu);

async function setArchived(id, archived) {
  S.confirm = null;
  dbg.log(archived ? "archive_plan" : "restore_plan", { plan: id });
  try {
    const saved = await store.setArchived(id, archived);
    if (!saved) S.plans = S.plans.filter((x) => x.plan.id !== id);
    else S.plans = S.plans.map((x) => (x.plan.id === id ? { plan: saved, progress: x.progress } : x));
    S.undo = archived && saved ? { id, topic: saved.topic } : null;
  } catch (e) {
    toast("Could not " + (archived ? "archive" : "restore") + " the plan. " + dbErrorMessage(e));
  }
  if (!S.plan && !S.gen) renderHome();
}

async function deletePlan(id) {
  S.confirm = null;
  if (S.undo && S.undo.id === id) S.undo = null;
  dbg.log("delete_plan", { plan: id });
  try {
    await store.deletePlan(id);
    S.plans = S.plans.filter((x) => x.plan.id !== id);
  } catch (e) {
    toast("Could not delete the plan. " + dbErrorMessage(e));
  }
  if (!S.plan && !S.gen) renderHome();
}

// h() builds HTML elements only, so the SVG icons go in as markup. The strings are constant, never user text.
const svgIcon = (paths) => '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + "</svg>";
const ICONS = {
  trash: svgIcon('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>'),
  box: svgIcon('<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/><path d="M10 12h4"/>'),
  restore: svgIcon('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>'),
  dots: svgIcon('<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>'),
};

// Plans saved before lesson screens existed have no "lessons", including those with the older per-exercise lesson_md.
const isLegacy = (plan) => !(plan.lessons && plan.lessons.length);
