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
  setCrumb("");
  renderRuntimeChip(true);
  viewEl.textContent = "";

  const count = S.plan.exercises.filter((ex) => ex.lesson_id === lesson.id).length;
  // Read pages get a ✓: the ones before the furthest page reached this session, or all once an exercise is done.
  const seen = Math.max(S.lessonSeen[lesson.id] || 0, pi);
  S.lessonSeen[lesson.id] = seen;
  const allRead = S.plan.exercises.some((ex) => ex.lesson_id === lesson.id && isDone(exState(ex)));
  // Outline of named pages, so the learner sees what the lesson covers and can jump to any page.
  // A one-page lesson has nothing to jump between, so it lists no pages.
  const toc = h("nav", { class: "lesson-toc", "aria-label": "Lesson pages" },
    h("p", { class: "toc-kicker", text: "Lesson " + (li + 1) }),
    h("h2", { class: "lesson-name", text: lesson.title }),
    pages.length > 1 ? h("ol", { class: "toc-pages" }, pages.map((pg, k) => {
      const read = k !== pi && (allRead || k <= seen);
      return h("li", {}, h("button", {
        class: "toc-page" + (k === pi ? " on" : read ? " read" : ""), type: "button",
        "aria-current": k === pi ? "page" : null,
        onclick: () => openLesson(li, k),
      }, h("span", { class: "i", "aria-hidden": "true", text: read ? "✓" : String(k + 1) }), h("span", { class: "t", text: pg.title || "Page " + (k + 1) })));
    })) : null,
    h("button", { class: "toc-ex linkish", type: "button", onclick: () => openExercise(first) },
      h("span", { class: "i", "aria-hidden": "true", text: "→" }), count + " exercise" + (count > 1 ? "s" : "")),
  );

  viewEl.append(
    h("nav", { class: "strip", id: "strip", "aria-label": "Lessons and exercises" }),
    h("div", { id: "banner" }),
    h("div", { class: "lesson-view" },
      toc,
      h("article", { class: "lesson-main" },
        h("h3", { class: "page-title", text: p.title || lesson.title }),
        p.body_md ? md(p.body_md) : null,
        h("div", { class: "examples" }, p.examples.map((e) => h("figure", { class: "example" },
          h("pre", { class: "doctest" }, h("code", { text: e.code })),
          e.note ? h("figcaption", { text: e.note }) : null,
        ))),
        h("div", { class: "lesson-nav" },
          pi > 0 ? h("button", { class: "btn secondary", type: "button", onclick: () => openLesson(li, pi - 1), text: "← Back" }) : null,
          h("span", { class: "spacer" }),
          pages.length > 1 ? h("span", { class: "page-count tabnum", text: "Page " + (pi + 1) + " of " + pages.length }) : null,
          last
            ? h("button", { class: "btn", type: "button", onclick: () => openExercise(first), text: "Try it yourself →" })
            : h("button", { class: "btn", type: "button", onclick: () => openLesson(li, pi + 1), text: "Next →" }),
        ),
      ),
    ),
  );
  renderStrip();
  renderBanner();
  window.scrollTo({ top: 0 });
}
