function renderComplete() {
  if (saveTimer) saveProgressNow();
  editor = null;
  const plan = S.plan;
  const states = plan.exercises.map((ex) => exState(ex));
  const passed = states.filter((s) => s.status === "passed").length;
  const withSolution = states.filter((s) => s.status === "solution_shown").length;
  const hints = states.reduce((n, s) => n + (s.hints_used || 0), 0);
  setCrumb(plan.topic + " · complete");
  viewEl.textContent = "";
  viewEl.append(h("div", { class: "complete" },
    h("div", { class: "stack", style: "gap: 6px" },
      h("p", { class: "eyebrow", text: plan.level + " · plan complete" }),
      h("h1", { text: plan.topic }),
      plan.summary ? h("p", { class: "muted", text: plan.summary }) : null,
    ),
    h("div", { class: "stats" },
      h("div", { class: "stat" }, h("b", { text: String(passed) }), h("span", { text: "solved on your own" })),
      h("div", { class: "stat" }, h("b", { text: String(withSolution) }), h("span", { text: "completed with the solution" })),
      h("div", { class: "stat" }, h("b", { text: String(hints) }), h("span", { text: "hints used" })),
    ),
    h("section", { class: "panel" }, h("ol", { class: "recap" }, plan.exercises.map((ex, i) => {
      const s = states[i];
      return h("li", {},
        h("span", { class: "chip plain " + (s.status === "passed" ? "ok" : "warn"), text: s.status === "passed" ? "Solved" : "Solution" }),
        h("strong", { text: ex.title }),
        h("span", { class: "muted", text: ex.concept }),
        h("span", { class: "spacer" }),
        h("button", { class: "btn ghost", type: "button", onclick: () => openExercise(i), text: "Open" }),
      );
    }))),
    h("div", { class: "row" },
      h("button", { class: "btn", type: "button", onclick: () => goHome(), text: "Back to plans" }),
    ),
  ));
}
