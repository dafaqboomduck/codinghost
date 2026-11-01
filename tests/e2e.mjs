// End-to-end check of the built app/codinghost.html in dev mode (?dev): fake sample/db/user, real Pyodide.
// Usage: npm run e2e  (set CHROMIUM_PATH to use a specific browser binary; SHOTS=dir saves screenshots)
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "app");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".wasm": "application/wasm", ".txt": "text/plain", ".zip": "application/zip" };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const file = path.join(root, decodeURIComponent(url.pathname === "/" ? "/codinghost.html" : url.pathname));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}/codinghost.html?dev`;

async function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const dir = path.join(os.homedir(), ".cache/ms-playwright");
  if (!existsSync(dir)) return undefined;
  for (const d of (await readdir(dir)).filter((d) => d.startsWith("chromium-")).sort().reverse()) {
    const p = path.join(dir, d, "chrome-linux64/chrome");
    if (existsSync(p)) return p;
  }
  return undefined;
}

const browser = await chromium.launch({ executablePath: await findChromium() });
const errors = [];
const shots = process.env.SHOTS;
let failed = false;

async function step(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    console.log(`ok   ${name} (${Date.now() - t0} ms)`);
  } catch (e) {
    failed = true;
    console.log(`FAIL ${name}: ${e.message}`);
    throw e;
  }
}

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|fonts\.g|status of 404/.test(m.text())) errors.push("console: " + m.text()); });
  const setCode = (code) => page.evaluate((c) => document.querySelector(".CodeMirror").CodeMirror.setValue(c), code);
  // Strip dots have no visible text, so steps are found by their labels.
  const exStep = (n) => page.locator(`.strip .step[aria-label^="Exercise ${n},"]`);
  const getCode = () => page.evaluate(() => document.querySelector(".CodeMirror").CodeMirror.getValue());

  await page.goto(base);
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await step("home renders with empty state", async () => {
    await page.getByText("No plans yet").waitFor();
    if (shots) await page.screenshot({ path: path.join(shots, "home.png"), fullPage: true });
  });

  await step("python loads in a worker", async () => {
    await page.locator("#py-chip", { hasText: "Python ready" }).waitFor({ timeout: 60000 });
    assert.match(await page.getAttribute("#py-chip", "title"), /Web Worker/);
  });

  await step("topic needing a third-party package is refused without a plan", async () => {
    await page.fill("#topic", "numpy arrays");
    await page.click("text=Generate plan");
    await page.locator(".notice.bad", { hasText: "numpy package is not available" }).waitFor({ timeout: 10000 });
    assert.equal(await page.locator("button", { hasText: "Try again" }).count(), 0);
    await page.click("text=Back to plans");
    await page.getByText("No plans yet").waitFor();
  });

  await step("generate plan; broken ex6 is repaired, leaky ex2 rewritten, all 6 kept", async () => {
    await page.fill("#topic", "Python lists");
    await page.click("text=Generate plan");
    await page.locator(".strip .step").first().waitFor({ timeout: 60000 });
    assert.equal(await page.locator(".strip .step:not(.lesson)").count(), 6);
    assert.equal(await page.locator(".strip .step.lesson").count(), 3);
    assert.equal(await page.locator(".strip .step:not(.lesson):disabled").count(), 5);
    assert.equal(await page.locator(".strip .step.lesson:disabled").count(), 2);
  });

  await step("a new plan opens on lesson 1, one page per concept; the leaky example is dropped", async () => {
    await page.locator(".lesson-view h2", { hasText: "Reading a list" }).waitFor();
    assert.equal(await page.locator(".lesson-view .dot").count(), 3);
    assert.equal(await page.locator(".lesson-view .page-title").innerText(), "Indexes: items[0], items[-1]");
    assert.equal(await page.locator(".lesson-view .example").count(), 1);
    assert.equal(await page.locator("text=Try it yourself").count(), 0, "only the last page leads to the exercises");
    await page.click("text=Next →");
    await page.locator(".lesson-view .page-title", { hasText: "for loops" }).waitFor();
    await page.click("text=← Back");
    await page.locator(".lesson-view .page-title", { hasText: "Indexes" }).waitFor();
    await page.click(".lesson-view .dot >> nth=2");
    await page.locator(".lesson-view .page-title", { hasText: "The % operator" }).waitFor();
    assert.equal(await page.locator(".lesson-view .example").count(), 2);
    assert.equal(await page.locator(".lesson-view", { hasText: "first_and_last" }).count(), 0);
    if (shots) await page.screenshot({ path: path.join(shots, "lesson.png"), fullPage: true });
  });

  await step("try it yourself opens exercise 1, which links back to the lesson", async () => {
    await page.click("text=Try it yourself");
    assert.equal(await page.locator(".doctest").innerText(), ">>> first_and_last([4, 7, 9])\n[4, 9]\n>>> first_and_last(['a', 'b'])\n['a', 'b']");
    assert.equal(await page.locator(".task .example").count(), 0, "lesson is not on the exercise screen");
    assert.equal(await page.locator(".strip .count").innerText(), "0/6");
    assert.equal(await page.locator(".task .eyebrow").innerText(), "EXERCISE 1 OF 6 · LIST INDEXING");
    assert.equal(await page.locator("#crumb").innerText(), "", "the course header names the course, not the top bar");
    assert.doesNotMatch(await page.locator(".task > .md").innerText(), /for example/i, "the Examples box already shows the calls");
    await page.click("text=← Lesson 1: Reading a list");
    await page.locator(".lesson-view .page-title", { hasText: "Indexes" }).waitFor();
    await page.click(".lesson-view .dot >> nth=-1");
    await page.click("text=Try it yourself");
    await page.locator(".doctest").waitFor();
  });

  await step("editor pairs quotes after a string prefix and does not double a closing quote", async () => {
    const starter = await getCode();
    const type = async (text) => {
      await setCode("");
      await page.locator(".CodeMirror").click();
      await page.keyboard.type(text);
      return getCode();
    };
    assert.equal(await type('x = r"'), 'x = r""');
    assert.equal(await type("x = f'"), "x = f''");
    assert.equal(await type('re.findall(r"\\d{2}[A-B]{4}", text)'), 're.findall(r"\\d{2}[A-B]{4}", text)');
    assert.equal(await type("don't"), "don't");
    assert.equal(await type('"it\'s"'), '"it\'s"');
    await setCode(starter);
  });

  await step("run with starter code shows failing visible tests", async () => {
    await page.click("button:has-text('Run')");
    await page.locator(".out-summary", { hasText: "failed" }).waitFor();
    assert.equal(await page.locator(".test.fail").count(), 2);
  });

  await step("wrong answer on submit counts an attempt, hidden inputs stay hidden", async () => {
    await setCode("def first_and_last(items):\n    return [items[0], 0]\n");
    await page.click("button:has-text('Submit')");
    await page.locator(".chip", { hasText: "Failing" }).waitFor();
    assert.ok(await page.getByText("Hidden test 3").isVisible());
    assert.ok(await page.getByText("Inputs are hidden").isVisible());
  });

  await step("correct submit passes and unlocks exercise 2", async () => {
    await setCode("def first_and_last(items):\n    return [items[0], items[len(items) - 1]]\n");
    await page.click("button:has-text('Submit')");
    await page.locator(".chip", { hasText: "Passed" }).waitFor();
    assert.equal(await page.locator(".strip .step:not(.lesson):disabled").count(), 4);
    assert.equal(await page.locator(".hint.review").count(), 0, "review waits for a click");
    await page.click("button:has-text('Review my code')");
    await page.locator(".hint.review:not(.streaming)", { hasText: "One idea" }).waitFor({ timeout: 10000 });
    assert.equal(await page.locator("button", { hasText: /^Review my/ }).count(), 0);
    if (shots) await page.screenshot({ path: path.join(shots, "exercise-pass.png"), fullPage: true });
  });

  await step("syntax error shows traceback and marks the line", async () => {
    await page.click("text=Next exercise");
    assert.doesNotMatch(await page.locator(".task > .md").innerText(), /n % 2/, "leaky task was rewritten");
    await setCode("def count_evens(numbers)\n    return 0\n");
    await page.click("button:has-text('Run')");
    await page.locator(".term.err", { hasText: "SyntaxError" }).waitFor();
    assert.equal(await page.locator(".cm-errline").count(), 1);
  });

  await step("infinite loop times out after 5 s and the runner recovers", async () => {
    await setCode("def count_evens(numbers):\n    while True:\n        pass\n");
    const t0 = Date.now();
    await page.click("button:has-text('Run')");
    await page.locator(".chip", { hasText: "Timed out" }).waitFor({ timeout: 15000 });
    const took = Date.now() - t0;
    assert.ok(took >= 4500 && took < 9000, "timeout took " + took + " ms");
    await page.locator("#py-chip", { hasText: "Python ready" }).waitFor({ timeout: 60000 });
    await setCode("def count_evens(numbers):\n    return sum(1 for n in numbers if n % 2 == 0)\n");
    await page.click("button:has-text('Run')");
    await page.locator(".chip", { hasText: "Looks good" }).waitFor();
  });

  await step("run after load is fast", async () => {
    const t0 = Date.now();
    await page.click("button:has-text('Run')");
    await page.locator(".out-summary .ms").waitFor();
    assert.ok(Date.now() - t0 < 1000, "run took " + (Date.now() - t0) + " ms");
  });

  await step("help shows the plan's hint first, then streams one from Claude", async () => {
    await page.click("button:has-text('Help me')");
    await page.locator(".hint .body", { hasText: "remainder" }).waitFor();
    await page.getByText("Hints used: 1").waitFor();
    await page.click("button:has-text('Next hint (2 of 3)')");
    await page.locator(".hint:not(.streaming)", { hasText: "Which variable" }).waitFor({ timeout: 10000 });
    await page.getByText("Hints used: 2").waitFor();
  });

  await step("reload resumes the plan, exercise and code", async () => {
    await page.waitForTimeout(2500); // let the debounced save land
    await page.reload();
    await page.locator("button", { hasText: "Continue" }).click();
    await page.locator('.strip [aria-current="step"][aria-label^="Exercise 2,"]').waitFor();
    assert.match(await getCode(), /sum\(1 for n in numbers/);
  });

  await step("code review is saved with progress", async () => {
    await exStep(1).click();
    await page.locator(".hint.review", { hasText: "One idea" }).waitFor();
    await setCode("def first_and_last(items):\n    first = items[0]\n    return [first, items[-1]]\n");
    await page.click("button:has-text('Submit')");
    await page.click("button:has-text('Review my new code')");
    await page.locator(".hint.review.streaming").waitFor({ timeout: 5000 });
    await page.locator(".hint.review:not(.streaming)").waitFor({ timeout: 10000 });
    await exStep(2).click();
  });

  await step("debug log is saved to debug/<uid> and keeps the previous session", async () => {
    const doc = await page.evaluate(() => JSON.parse(localStorage.getItem("codinghost-dev-db"))["debug/dev-user"]);
    assert.ok(doc && doc.current && doc.previous, "current and previous sessions");
    const kinds = new Set(doc.previous.entries.map((e) => e.kind));
    for (const k of ["run_start", "run_end", "run_timeout", "worker_restart", "python_status"]) assert.ok(kinds.has(k), "previous has " + k);
    await page.click("#debug-toggle");
    await page.locator("#debug-meta", { hasText: "Saved to debug/dev-user" }).waitFor({ timeout: 8000 });
    await page.click("#debug-toggle");
  });

  await step("show solution after 3 failed submits, then the plan completes", async () => {
    for (let n = 2; n <= 5; n++) {
      await exStep(n).click();
      // 3 failing submits make "Show solution" available
      await setCode("def nope():\n    pass\n");
      for (let k = 0; k < 3; k++) {
        await page.click("button:has-text('Submit')");
        await page.locator(".out-summary .ms").waitFor();
      }
      await page.click("text=Show solution…");
      await page.click(".confirm >> text=Show solution");
      await page.locator(".eyebrow", { hasText: "Reference solution" }).waitFor();
      // ex2 ends lesson 1, so moving on opens lesson 2 first
      if (n === 2) {
        await page.click("text=Next lesson →");
        await page.locator(".lesson-view h2", { hasText: "Slices" }).waitFor();
        await page.locator('.strip .step.lesson[aria-current="step"][aria-label^="Lesson 2,"]').waitFor();
      }
    }
    await exStep(6).click();
    await setCode("def running_total(numbers):\n    out, total = [], 0\n    for n in numbers:\n        total += n\n        out.append(total)\n    return out\n");
    await page.click("button:has-text('Submit')");
    await page.locator(".chip", { hasText: "Passed" }).waitFor();
    await page.getByText("Plan complete.").waitFor();
    await page.click("text=See summary");
    await page.getByText("solved on your own").waitFor();
    if (shots) await page.screenshot({ path: path.join(shots, "complete.png"), fullPage: true });
  });

  await step("deleting a plan asks first, then removes it and its progress", async () => {
    await page.click("text=Back to plans");
    await page.locator(".plan-item").first().waitFor();
    assert.equal(await page.locator(".plan-item .chip", { hasText: "legacy" }).count(), 0, "new plan marked legacy");
    await page.click(".plan-item >> button[aria-label^='Delete plan']");
    await page.click(".confirm >> text=Cancel");
    assert.equal(await page.locator(".plan-item").count(), 1);
    await page.click(".plan-item >> button[aria-label^='Delete plan']");
    if (shots) await page.screenshot({ path: path.join(shots, "home-delete.png"), fullPage: true });
    await page.click(".confirm >> button.danger");
    await page.getByText("No plans yet").waitFor();
    const keys = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("codinghost-dev-db"))));
    assert.ok(!keys.some((k) => /\/(plans|progress)\//.test(k)), "left behind: " + keys.join(", "));
    await page.reload();
    await page.getByText("No plans yet").waitFor();
  });

  await step("plans made before lessons are marked legacy", async () => {
    await page.evaluate(() => {
      const all = JSON.parse(localStorage.getItem("codinghost-dev-db"));
      const ex = { id: "ex1", title: "Old", concept: "Old", prompt_md: "Old task", function_name: "f", starter_code: "def f():\n    pass\n", reference_solution: "def f():\n    return 1\n", tests: [] };
      all["data/users/dev-user/profile/plans/pold"] = { id: "pold", topic: "Old plan", level: "beginner", summary: "", exercises: [ex], created_at: "2026-10-01T00:00:00Z" };
      localStorage.setItem("codinghost-dev-db", JSON.stringify(all));
    });
    await page.reload();
    await page.locator(".plan-item", { hasText: "Old plan" }).locator(".chip", { hasText: "legacy" }).waitFor();
    await page.click(".plan-item >> text=Start");
    await page.locator(".task h2", { hasText: "Old" }).waitFor();
    assert.equal(await page.locator(".strip .step.lesson").count(), 0);
    assert.equal(await page.locator(".back-link").count(), 0);
  });

  await step("lessons saved before pages existed read as a single page", async () => {
    await page.evaluate(() => {
      const all = JSON.parse(localStorage.getItem("codinghost-dev-db"));
      const ex = { id: "ex1", lesson_id: "l1", title: "Flat", concept: "Flat", prompt_md: "Flat task", hint_md: "Hint", function_name: "f", starter_code: "def f():\n    pass\n", reference_solution: "def f():\n    return 1\n", tests: [] };
      const lesson = { id: "l1", title: "Flat lesson", intro_md: "One intro for everything.", examples: [{ code: "print(1)  # 1", note: "a note" }, { code: "print(2)  # 2", note: "" }] };
      all["data/users/dev-user/profile/plans/pflat"] = { id: "pflat", topic: "Flat plan", level: "beginner", summary: "", lessons: [lesson], exercises: [ex], created_at: "2026-10-02T00:00:00Z" };
      localStorage.setItem("codinghost-dev-db", JSON.stringify(all));
    });
    await page.click("#brand");
    await page.click(".plan-item:has-text('Flat plan') >> text=Start");
    await page.locator(".lesson-view h2", { hasText: "Flat lesson" }).waitFor();
    assert.equal(await page.locator(".lesson-view .dot").count(), 0);
    assert.equal(await page.locator(".lesson-view .example").count(), 2);
    await page.getByText("One intro for everything.").waitFor();
    await page.click("text=Try it yourself");
    await page.locator(".task h2", { hasText: "Flat" }).waitFor();
  });

  await step("phone width has no horizontal scroll", async () => {
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark" });
    const p = await phone.newPage();
    p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    await p.goto(base);
    await p.getByText("No plans yet").waitFor();
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "home overflows");
    if (shots) await p.screenshot({ path: path.join(shots, "phone-home-dark.png"), fullPage: true });
    await p.fill("#topic", "Python lists");
    await p.click("text=Generate plan");
    await p.locator(".strip .step").first().waitFor({ timeout: 60000 });
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "lesson overflows");
    if (shots) await p.screenshot({ path: path.join(shots, "phone-lesson-dark.png"), fullPage: true });
    await p.click(".lesson-view .dot >> nth=-1");
    await p.click("text=Try it yourself");
    await p.locator(".doctest").waitFor();
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "exercise overflows");
    if (shots) await p.screenshot({ path: path.join(shots, "phone-exercise-dark.png"), fullPage: true });
    await phone.close();
  });

  await step("without claude.ai and without ?dev the page explains itself", async () => {
    const p = await ctx.newPage();
    await p.goto(base.replace("?dev", ""));
    await p.getByText("Open this page in claude.ai").first().waitFor();
    await p.close();
  });

  await step("no page errors", async () => {
    assert.deepEqual(errors, []);
  });
} catch (e) {
  failed = true;
} finally {
  await browser.close();
  server.close();
}
if (failed) {
  if (errors.length) console.log(errors.join("\n"));
  process.exit(1);
}
console.log("all e2e steps passed");
