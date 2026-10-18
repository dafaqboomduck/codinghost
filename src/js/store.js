// store: everything in db, private under data/users/<uid>/

const store = (() => {
  let db = null;
  let base = null;
  const inflight = new Map(); // path -> { running: Promise, next: data|null }

  function init(dbNs, uid) {
    db = dbNs;
    base = "data/users/" + uid + "/profile";
  }

  // One write at a time per document. A write that arrives while one is running replaces
  // any queued write, so only the latest state is sent.
  function write(path, data) {
    const slot = inflight.get(path);
    if (slot) { slot.next = data; return slot.done; }
    const entry = { next: null, done: null };
    entry.done = (async () => {
      let current = data;
      try {
        while (current) {
          await db.doc(path).set(current);
          current = entry.next;
          entry.next = null;
        }
      } finally {
        inflight.delete(path);
      }
    })();
    inflight.set(path, entry);
    return entry.done;
  }

  // Saved documents can come back read-only (frozen), but the page edits plans and progress in place, so hand out plain copies.
  const thaw = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)));
  const plain = (snap) => (snap && snap.exists ? thaw(snap.data()) : null);

  return {
    init,
    async getProfile() { return plain(await db.doc(base).get()); },
    saveProfile(data) { return write(base, data); },
    async listPlans() {
      const [plans, progress] = await Promise.all([
        db.collection(base + "/plans").get(),
        db.collection(base + "/progress").get(),
      ]);
      const prog = new Map(progress.docs.map((d) => [d.id, thaw(d.data())]));
      return plans.docs
        .map((d) => ({ plan: thaw(d.data()), progress: prog.get(d.id) || null }))
        .filter((x) => x.plan && Array.isArray(x.plan.exercises))
        .sort((a, b) => String((b.progress && b.progress.updated_at) || b.plan.created_at).localeCompare(String((a.progress && a.progress.updated_at) || a.plan.created_at)));
    },
    async getPlan(id) { return plain(await db.doc(base + "/plans/" + id).get()); },
    savePlan(plan) { return write(base + "/plans/" + plan.id, plan); },
    async getProgress(id) { return plain(await db.doc(base + "/progress/" + id).get()); },
    saveProgress(id, progress) { return write(base + "/progress/" + id, progress); },
  };
})();

function dbErrorMessage(e) {
  const code = e && e.code;
  dbg.log("db_error", { code: code || null, message: (e && e.message) || String(e) });
  if (code === "quota_exceeded") return "Storage is full. Your latest change was not saved.";
  if (code === "not_granted" || code === "revoked") return "This page lost access to your saved data. Reload to allow it again.";
  if (code === "unavailable" || code === "resource_exhausted") return "Saving failed for a moment. Your next change will try again.";
  return "Saving failed: " + ((e && e.message) || String(e));
}
