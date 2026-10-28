// A lesson gets its own screen before its exercises, so the learner reads it, then solves without it in view.
// It shows one page, one concept, at a time; the last page leads into the exercises.
function openLesson(li, page = 0) {
  const lesson = (S.plan.lessons || [])[li];
  if (!lesson) return;
  const first = firstExerciseOf(S.plan, lesson);
  if (!canOpen(first)) return;
  if (saveTimer) saveProgressNow();
  const pages = lessonPages(lesson);
  const pi = Math.max(0, Math.min(page, pages.length - 1));
  const p = pages[pi] || { title: "", body_md: "", examples: [] };
  const last = pi >= pages.length - 1;
  S.lesson = li;
  S.confirm = null;
  editor = null;
  if (S.progress.current_lesson !== lesson.id) { S.progress.current_lesson = lesson.id; saveProgressSoon(); }
  dbg.log("view", { view: "lesson", plan: S.plan.id, lesson: lesson.id, page: pi });
  setCrumb(S.plan.topic + " · Lesson " + (li + 1) + " / " + S.plan.lessons.length);
  viewEl.textContent = "";

  const count = S.plan.exercises.filter((ex) => ex.lesson_id === lesson.id).length;
  const dots = pages.length > 1 ? h("div", { class: "dots", role: "group", "aria-label": "Pages" }, pages.map((pg, k) => h("button", {
    class: "dot" + (k === pi ? " current" : ""), type: "button",
    "aria-label": "Page " + (k + 1) + (pg.title ? ": " + pg.title : ""), "aria-current": k === pi ? "page" : null,
    title: pg.title || "Page " + (k + 1),
    onclick: () => openLesson(li, k),
  }))) : null;

  viewEl.append(
    h("nav", { class: "strip", id: "strip", "aria-label": "Lessons and exercises" }),
    h("div", { id: "banner" }),
    h("article", { class: "panel lesson-view" },
      h("p", { class: "eyebrow", text: "Lesson " + (li + 1) + (pages.length > 1 ? " · Page " + (pi + 1) + " of " + pages.length : " · " + count + " exercise" + (count > 1 ? "s" : "")) }),
      h("h2", { text: lesson.title }),
      p.title ? h("h3", { class: "page-title", text: p.title }) : null,
      p.body_md ? md(p.body_md) : null,
      h("div", { class: "examples" }, p.examples.map((e) => h("figure", { class: "example" },
        h("pre", { class: "doctest" }, h("code", { text: e.code })),
        e.note ? h("figcaption", { text: e.note }) : null,
      ))),
      h("div", { class: "lesson-nav" },
        pi > 0 ? h("button", { class: "btn secondary", type: "button", onclick: () => openLesson(li, pi - 1), text: "← Back" }) : null,
        dots,
        h("span", { class: "spacer" }),
        last
          ? h("button", { class: "btn", type: "button", onclick: () => openExercise(first), text: "Try it yourself →" })
          : h("button", { class: "btn", type: "button", onclick: () => openLesson(li, pi + 1), text: "Next →" }),
      ),
    ),
  );
  renderStrip();
  renderBanner();
  window.scrollTo({ top: 0 });
}
