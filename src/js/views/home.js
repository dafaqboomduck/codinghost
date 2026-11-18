async function goHome() {
  if (saveTimer) saveProgressNow();
  if (S.gen && S.gen.controller) S.gen.controller.abort();
  S.plan = null;
  S.progress = null;
  S.gen = null;
  S.confirm = null;
  S.menu = null;
  S.undo = null;
  S.composer = false;
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
  if (S.blocked) {
    viewEl.append(h("div", { class: "panel stack", style: "max-width: 640px" },
      h("h2", { text: S.blocked.title }),
      h("p", { text: S.blocked.body }),
    ));
    return;
  }
  const loaded = !!S.caps && S.plans !== null;
  const open = composerOpen();
  const openComposer = () => { S.composer = true; renderHome(); document.getElementById("topic").focus(); };
  const home = h("section", { class: "home" },
    h("div", { class: "home-head" },
      h("h1", { text: "Your plans" }),
      loaded && !open ? h("button", { class: "linkish new-plan-btn", type: "button", onclick: openComposer, text: "+ New plan" }) : null,
    ),
    loaded && open ? renderNewPlanForm() : null,
    renderPlanList(),
    // Phones get the same action as a floating pill at the bottom right, within thumb reach.
    loaded && !open ? fabButton(openComposer) : null,
  );
  viewEl.append(home);
}

function fabButton(onclick) {
  const btn = h("button", { class: "fab-new", type: "button", onclick });
  btn.innerHTML = ICONS.plus;
  btn.append("New plan");
  return btn;
}

// Open when asked for, when a refused prompt comes back for editing, and for a learner with no plans yet.
const composerOpen = () => S.composer || !!S.draft || (S.plans !== null && !S.plans.length);

// What the topic placeholder and the scope note say for each language.
const FORM_TEXT = {
  python: { placeholder: "Topic, e.g. Python lists and loops", note: "Python standard library only. Topics that need numpy, pandas, requests and similar packages are not supported." },
  javascript: { placeholder: "Topic, e.g. JavaScript arrays and loops", note: "Core JavaScript only. Topics that need the DOM, Node.js or libraries such as React, Express or lodash are not supported." },
};
const LEVELS = ["beginner", "intermediate", "advanced"];
const cap = (s) => s[0].toUpperCase() + s.slice(1);

const langDown = (L) => L.runner.status.state === "failed";

/**
 * One labeled option box. The native select sits invisibly on top of the label,
 * so phones get their own picker and the box can still show a short value.
 * id: the select's id. label: the box's caption. options: [{value, text, disabled}].
 */
function optionCell(id, label, options, value) {
  const shown = h("span", { class: "v" });
  const select = h("select", { id, "aria-label": label },
    options.map((o) => h("option", { value: o.value, selected: o.value === value, disabled: o.disabled, text: o.text })));
  const sync = () => { shown.textContent = select.options[select.selectedIndex].text; };
  select.addEventListener("change", sync);
  sync();
  return h("label", { class: "cell" }, h("span", { class: "lbl", text: label }), shown, select);
}

function renderNewPlanForm() {
  const canGenerate = ai.available;
  const draft = S.draft || {};
  const firstUp = (Object.values(LANGS).find((L) => !langDown(L)) || LANGS.python).id;
  const pick = draft.language && !langDown(LANGS[draft.language]) ? draft.language : firstUp;
  const closable = S.plans && S.plans.length > 0;
  const topic = h("input", { type: "text", id: "topic", class: "topic", maxlength: "200", placeholder: FORM_TEXT[pick].placeholder, autocomplete: "off", required: true, value: draft.topic || "", "aria-label": "Topic" });
  const language = optionCell("language", "Language", Object.values(LANGS).map((L) => ({ value: L.id, text: L.label, disabled: langDown(L) })), pick);
  const level = optionCell("level", "Level", LEVELS.map((lv) => ({ value: lv, text: cap(lv) })), draft.level || "beginner");
  const count = optionCell("count", "Length", [5, 6, 7, 8].map((n) => ({ value: String(n), text: n + " exercises" })), String(draft.count || 6));
  const note = h("p", { class: "composer-note", text: FORM_TEXT[pick].note });
  const close = () => { S.composer = false; S.draft = null; renderHome(); };
  const xBtn = h("button", { class: "btn ghost icon-btn", type: "button", "aria-label": "Close new plan", title: "Close", onclick: close });
  xBtn.innerHTML = ICONS.close;
  const form = h("form", { class: "composer", id: "new-plan" },
    h("div", { class: "composer-head" }, h("h2", { text: "New plan" }), closable ? xBtn : null),
    topic,
    h("div", { class: "cells" }, language, level, count),
    h("button", { class: "btn wide", id: "gen-submit", type: "submit", disabled: !canGenerate || !S.caps, text: "Generate plan" }),
    note,
    !canGenerate && S.caps ? h("div", { class: "notice warn", text: "Claude access is off for this page, so new plans cannot be written. You can still continue your saved plans." }) : null,
    h("div", { class: "notice bad", id: "lang-down", hidden: true }),
  );
  const langSel = language.querySelector("select");
  langSel.addEventListener("change", () => {
    const t = FORM_TEXT[langSel.value];
    topic.placeholder = t.placeholder;
    note.textContent = t.note;
    updateLanguageGate();
  });
  form.addEventListener("keydown", (e) => { if (e.key === "Escape" && closable) close(); });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const t = topic.value.trim();
    if (!t) { topic.focus(); return; }
    if (langDown(LANGS[langSel.value])) return;
    S.draft = null;
    S.composer = false;
    startGeneration(t, form.querySelector("#level").value, Number(form.querySelector("#count").value), langSel.value);
  });
  queueMicrotask(updateLanguageGate);
  return form;
}

// A runtime can fail after the form is on screen (Python loads in the background),
// so the form is patched in place, keeping what the learner typed.
function updateLanguageGate() {
  const form = document.getElementById("new-plan");
  if (!form) return;
  const select = document.getElementById("language");
  for (const opt of select.options) opt.disabled = langDown(LANGS[opt.value]);
  const L = LANGS[select.value];
  const down = langDown(L);
  document.getElementById("gen-submit").disabled = !ai.available || !S.caps || down;
  const note = document.getElementById("lang-down");
  note.hidden = !down;
  note.textContent = down ? L.label + " could not load in this browser, so plans in " + L.label + " cannot be written. " + (Object.values(LANGS).some((o) => !langDown(o)) ? "Pick another language, or reload the page to try again." : "Reload the page to try again.") : "";
}

function renderPlanList() {
  const panel = h("section", { class: "plan-list" });
  if (!S.caps || S.plans === null) {
    panel.append(h("p", { class: "plans-empty", text: S.caps ? "Loading your plans…" : "Connecting to claude.ai…" }));
    return panel;
  }
  const { active, archived } = splitArchived(S.plans);
  // The tab switch only exists while something is archived; restoring the last one drops back to Active.
  if (!archived.length) S.showArchived = false;
  if (S.undo) {
    panel.append(h("div", { class: "notice row undo", role: "status" },
      h("span", { text: "Archived “" + S.undo.topic + "”." }),
      h("span", { class: "spacer" }),
      h("button", { class: "linkish", type: "button", onclick: () => setArchived(S.undo.id, false), text: "Undo" }),
    ));
  }
  if (archived.length) {
    const tab = (on, text, archivedTab) => h("button", { type: "button", role: "tab", class: "tab" + (on ? " on" : ""), "aria-selected": String(on),
      onclick: () => { S.showArchived = archivedTab; S.menu = null; S.confirm = null; renderHome(); }, text });
    panel.append(h("div", { class: "plan-tabs", role: "tablist", "aria-label": "Plan list" },
      tab(!S.showArchived, "Active " + active.length, false),
      tab(S.showArchived, "Archived " + archived.length, true),
    ));
  }
  const rows = S.showArchived ? archived : active;
  if (rows.length) panel.append(h("div", { class: "plans" }, rows.map(planRow)));
  else if (archived.length) panel.append(h("p", { class: "plans-empty", text: "All your plans are archived. Start a new one, or open the Archived tab to pick one up again." }));
  else panel.append(h("p", { class: "plans-empty" }, h("strong", { text: "No plans yet. " }), "Name a topic and Claude writes a short set of exercises for your level, each with tests that run in your browser and a tutor who gives hints instead of answers."));
  return panel;
}

function planRow({ plan, progress }) {
  const total = plan.exercises.length;
  const done = countDone(plan, progress);
  const pct = total ? Math.round((done / total) * 100) : 0;
  const archived = isArchived(plan);
  const when = archived ? plan.archived_at : (progress && progress.updated_at) || plan.created_at;
  const action = done === total ? "Review" : done ? "Continue" : "Start";
  return h("div", { class: "plan-item" + (archived ? " is-archived" : "") },
    // The title button stretches over the whole row (CSS ::after), so the row opens the plan and the ⋯ menu sits above it.
    h("button", { class: "t", type: "button", title: action + " " + plan.topic, onclick: () => openPlan(plan, progress), text: plan.topic }),
    h("span", { class: "m" },
      isLegacy(plan) ? h("span", { class: "chip plain warn", title: "Made before lessons. Generate a new plan to get them.", text: "legacy" }) : null,
      h("span", { class: "tabnum", text: done + "/" + total }),
      " · ",
      h("span", { class: "lang", text: langOf(plan).label }),
      when ? h("span", { class: "when", text: " · " + (archived ? "archived " : "") + new Date(when).toLocaleDateString(undefined, { day: "numeric", month: "short" }) }) : null,
    ),
    planMenu(plan, archived),
    h("div", { class: "bar", "aria-hidden": "true" }, h("i", { style: "width: " + pct + "%" })),
    S.confirm === "delete:" + plan.id ? h("div", { class: "confirm" },
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
  plus: svgIcon('<path d="M12 5v14"/><path d="M5 12h14"/>'),
  close: svgIcon('<path d="M6 6l12 12"/><path d="M18 6L6 18"/>'),
  dots: svgIcon('<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>'),
};

// Plans saved before lesson screens existed have no "lessons", including those with the older per-exercise lesson_md.
const isLegacy = (plan) => !(plan.lessons && plan.lessons.length);
