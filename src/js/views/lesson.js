// A lesson gets its own screen before its exercises, so the learner reads it, then solves without it in view.
function openLesson(li) {
  const lesson = (S.plan.lessons || [])[li];
  if (!lesson) return;
  const first = firstExerciseOf(S.plan, lesson);
  if (!canOpen(first)) return;
  if (saveTimer) saveProgressNow();
  S.lesson = li;
  S.confirm = null;
  editor = null;
  if (S.progress.current_lesson !== lesson.id) { S.progress.current_lesson = lesson.id; saveProgressSoon(); }
  dbg.log("view", { view: "lesson", plan: S.plan.id, lesson: lesson.id });
  setCrumb(S.plan.topic + " · Lesson " + (li + 1) + " / " + S.plan.lessons.length);
  viewEl.textContent = "";

  const count = S.plan.exercises.filter((ex) => ex.lesson_id === lesson.id).length;
  viewEl.append(
    h("nav", { class: "strip", id: "strip", "aria-label": "Lessons and exercises" }),
    h("div", { id: "banner" }),
    h("article", { class: "panel lesson-view" },
      h("p", { class: "eyebrow", text: "Lesson " + (li + 1) + " · " + count + " exercise" + (count > 1 ? "s" : "") }),
      h("h2", { text: lesson.title }),
      lesson.intro_md ? md(lesson.intro_md) : null,
      h("div", { class: "examples" }, lesson.examples.map((e) => h("figure", { class: "example" },
        h("pre", { class: "doctest" }, h("code", { text: e.code })),
        e.note ? h("figcaption", { text: e.note }) : null,
      ))),
      h("div", { class: "row" }, h("button", { class: "btn", type: "button", onclick: () => openExercise(first), text: "Try it yourself →" })),
    ),
  );
  renderStrip();
  renderBanner();
  window.scrollTo({ top: 0 });
}
