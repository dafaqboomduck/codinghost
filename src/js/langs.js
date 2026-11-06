// langs: what differs between Python and JavaScript courses. Prompts live in ai.js.

const LANGS = {
  python: {
    id: "python",
    label: "Python",
    file: "solution.py",
    mode: "python",
    indent: 4,
    prompt: ">>> ",
    ident: /^[A-Za-z_][A-Za-z0-9_]*$/,
    argsKey: "args_py",
    expectedKey: "expected_py",
    get runner() { return runner; },
    // "(2, 3)" -> add(2, 3); a one-item tuple "([1],)" loses its trailing comma.
    call(fn, args) {
      const a = String(args || "").trim();
      if (!a.startsWith("(")) return fn + "(" + a + ")";
      return fn + a.replace(/,\s*\)$/, ")");
    },
  },
  javascript: {
    id: "javascript",
    label: "JavaScript",
    file: "solution.js",
    mode: "javascript",
    indent: 2,
    prompt: "> ",
    ident: /^[A-Za-z_$][\w$]*$/,
    argsKey: "args_js",
    expectedKey: "expected_js",
    get runner() { return jsRunner; },
    // "[2, 3]" -> add(2, 3)
    call(fn, args) {
      const a = String(args || "").trim();
      return fn + "(" + (a.startsWith("[") && a.endsWith("]") ? a.slice(1, -1) : a) + ")";
    },
  },
};

// Plans saved before JavaScript existed have no "language" and are Python.
const langOf = (plan) => LANGS[(plan && plan.language) || "python"] || LANGS.python;
