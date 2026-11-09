// Unit tests for plan archiving in src/js/store.js, against an in-memory stand-in for the db capability.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const loadStore = () => new Function("dbg", readFileSync(path.join(root, "src/js/store.js"), "utf8") + "\nreturn { store, isArchived, splitArchived };")({ log() {} });

// Same shape as devCaps' db in src/js/caps.js, including the frozen snapshots the real db returns.
function memoryDb() {
  const all = {};
  const freeze = (v) => { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
  const snap = (p, data) => ({ id: p.split("/").pop(), exists: data !== undefined, data: () => freeze(structuredClone(data)) });
  return {
    all,
    doc: (p) => ({
      get: async () => snap(p, all[p]),
      set: async (data) => { all[p] = structuredClone(data); },
      delete: async () => { delete all[p]; },
    }),
    collection: (p) => ({
      get: async () => ({ docs: Object.keys(all).filter((k) => k.startsWith(p + "/") && !k.slice(p.length + 1).includes("/")).map((k) => snap(k, all[k])) }),
    }),
  };
}

const plan = (id, created_at) => ({ id, topic: "t " + id, created_at, exercises: [{ id: "ex1" }] });

async function setup() {
  const mod = loadStore();
  const db = memoryDb();
  mod.store.init(db, "u1");
  await mod.store.savePlan(plan("a", "2026-01-01T00:00:00Z"));
  await mod.store.savePlan(plan("b", "2026-01-02T00:00:00Z"));
  return { ...mod, db };
}

test("archiving sets archived_at on the plan and keeps its progress", async () => {
  const { store, isArchived, db } = await setup();
  await store.saveProgress("a", { plan_id: "a", exercises: {}, updated_at: "2026-01-03T00:00:00Z" });
  const saved = await store.setArchived("a", true);
  assert.ok(isArchived(saved));
  assert.ok(isArchived(await store.getPlan("a")));
  assert.ok(db.all["data/users/u1/profile/progress/a"]);
});

test("restoring removes archived_at", async () => {
  const { store, isArchived } = await setup();
  await store.setArchived("a", true);
  const saved = await store.setArchived("a", false);
  assert.equal(isArchived(saved), false);
  assert.equal("archived_at" in (await store.getPlan("a")), false);
});

test("archiving a missing plan returns null and writes nothing", async () => {
  const { store, db } = await setup();
  assert.equal(await store.setArchived("nope", true), null);
  assert.equal(db.all["data/users/u1/profile/plans/nope"], undefined);
});

test("splitArchived separates the lists and orders the archive newest first", async () => {
  const { store, splitArchived } = await setup();
  await store.savePlan(plan("c", "2026-01-03T00:00:00Z"));
  await store.setArchived("a", true);
  await new Promise((r) => setTimeout(r, 5));
  await store.setArchived("c", true);
  const { active, archived } = splitArchived(await store.listPlans());
  assert.deepEqual(active.map((x) => x.plan.id), ["b"]);
  assert.deepEqual(archived.map((x) => x.plan.id), ["c", "a"]);
});
