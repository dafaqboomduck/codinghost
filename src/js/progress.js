function newProgress(plan) {
  const exercises = {};
  plan.exercises.forEach((ex, i) => {
    exercises[ex.id] = { status: i === 0 ? "open" : "locked", code: ex.starter_code, attempts: 0, hints_used: 0, passed_at: null };
  });
  return { plan_id: plan.id, current_index: 0, unlocked_index: 0, exercises, updated_at: new Date().toISOString() };
}

function exState(ex) {
  const p = S.progress.exercises;
  if (!p[ex.id]) p[ex.id] = { status: "locked", code: ex.starter_code, attempts: 0, hints_used: 0, passed_at: null };
  return p[ex.id];
}

const isDone = (st) => st.status === "passed" || st.status === "solution_shown";

function countDone(plan, progress) {
  if (!progress) return 0;
  return plan.exercises.filter((ex) => progress.exercises[ex.id] && isDone(progress.exercises[ex.id])).length;
}

function saveProgressNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!S.plan || !S.progress) return;
  S.progress.updated_at = new Date().toISOString();
  store.saveProgress(S.plan.id, JSON.parse(JSON.stringify(S.progress))).catch((e) => toast(dbErrorMessage(e)));
}

function saveProgressSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveProgressNow, SAVE_DEBOUNCE_MS);
}
