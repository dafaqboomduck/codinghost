// caps: claude.ai capabilities (and the local dev shim)

async function resolveCaps() {
  if (DEV) return devCaps();
  if (!(window.claude && window.claude.use)) return { sample: null, db: null, user: null };
  const [sample, db, user] = await Promise.all([
    window.claude.use("sample").catch(() => null),
    window.claude.use("db").catch(() => null),
    window.claude.use("user").catch(() => null),
  ]);
  return { sample, db, user };
}

// Local-only stand-ins for sample, db and user. Active with ?dev when window.claude is absent.
function devCaps() {
  const KEY = "codinghost-dev-db";
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { return {}; } };
  const save = (all) => { try { localStorage.setItem(KEY, JSON.stringify(all)); } catch (e) { /* ignore */ } };
  // Frozen like the real db, so code that edits loaded data in place fails here too.
  const freeze = (v) => { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
  const snap = (path, data) => ({ id: path.split("/").pop(), exists: data !== undefined, data: () => (data === undefined ? undefined : freeze(JSON.parse(JSON.stringify(data)))) });
  const db = {
    doc(path) {
      return {
        path,
        async get() { return snap(path, load()[path]); },
        async set(data) { const all = load(); all[path] = JSON.parse(JSON.stringify(data)); save(all); },
        async update(data) { const all = load(); all[path] = Object.assign({}, all[path] || {}, JSON.parse(JSON.stringify(data))); save(all); },
        async delete() { const all = load(); delete all[path]; save(all); },
      };
    },
    collection(path) {
      return {
        path,
        async get() {
          const all = load();
          const docs = Object.keys(all)
            .filter((p) => p.startsWith(path + "/") && !p.slice(path.length + 1).includes("/"))
            .map((p) => snap(p, all[p]));
          return { docs, size: docs.length, empty: docs.length === 0 };
        },
      };
    },
  };
  let canned = null;
  const getCanned = async () => canned || (canned = await (await fetch("dev/sample-plan.json")).json());
  const sample = async (input, opts = {}) => {
    const text = String(input).includes("already passes every test")
      ? "Clear and correct. **One idea:** give each value a name that says what it holds, so the `return` line reads like the task."
      : "Look at what your loop does with each item. **Which variable** holds the answer, and do you return it at the end? Try printing it inside the loop with `print(...)` to see how it changes.";
    let acc = "";
    for (const word of text.split(" ")) {
      await new Promise((r) => setTimeout(r, 25));
      acc += (acc ? " " : "") + word;
      if (opts.onText) opts.onText({ text: acc, delta: word });
    }
    return { text: acc, truncated: false, modelTierApplied: "default" };
  };
  sample.json = async (input, opts = {}) => {
    const plan = await getCanned();
    await new Promise((r) => setTimeout(r, 400));
    if (String(input).includes("failed an automatic check")) {
      const id = (String(input).match(/"id":\s*"(ex\d+)"/) || [])[1];
      if (plan._dev_repairs && plan._dev_repairs[id]) return JSON.parse(JSON.stringify(plan._dev_repairs[id]));
      throw { code: "invalid_json", message: "Dev shim has no repair for " + id };
    }
    if (opts.onText) opts.onText({ text: JSON.stringify(plan), delta: "" });
    return JSON.parse(JSON.stringify(plan));
  };
  sample.limits = async () => ({ maxPromptBytes: 100000 });
  const user = { id: async () => "dev-user", me: async () => ({ id: "dev-user", name: "Dev" }) };
  return { sample, db, user };
}
