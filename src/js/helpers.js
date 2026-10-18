function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Small Markdown renderer. Everything is escaped first; only the tags added here reach the DOM.
function mdInline(text) {
  return text.split(/(`[^`\n]+`)/g).map((part) => {
    if (part.length > 1 && part.startsWith("`") && part.endsWith("`")) return "<code>" + esc(part.slice(1, -1)) + "</code>";
    return esc(part)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, "$1<em>$2</em>");
  }).join("");
}
function md(src) {
  const lines = String(src || "").replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let para = [];
  let list = null;
  const flushPara = () => { if (para.length) { out.push("<p>" + mdInline(para.join(" ")) + "</p>"); para = []; } };
  const flushList = () => { if (list) { out.push("<" + list.tag + ">" + list.items.map((i) => "<li>" + mdInline(i) + "</li>").join("") + "</" + list.tag + ">"); list = null; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      flushPara(); flushList();
      const code = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
      out.push("<pre><code>" + esc(code.join("\n")) + "</code></pre>");
      continue;
    }
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (heading) { flushPara(); flushList(); out.push("<h4>" + mdInline(heading[1]) + "</h4>"); }
    else if (bullet || numbered) {
      flushPara();
      const tag = bullet ? "ul" : "ol";
      if (list && list.tag !== tag) flushList();
      if (!list) list = { tag, items: [] };
      list.items.push((bullet || numbered)[1]);
    } else if (!line.trim()) { flushPara(); flushList(); }
    else { flushList(); para.push(line.trim()); }
  }
  flushPara(); flushList();
  const box = h("div", { class: "md" });
  box.innerHTML = out.join("");
  return box;
}

let toastTimer = null;
function toast(message) {
  if (typeof dbg !== "undefined") dbg.log("toast", { message });
  const el = document.getElementById("toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 5000);
}

function newId(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function callText(fn, argsPy) {
  const a = String(argsPy || "").trim();
  if (!a.startsWith("(")) return fn + "(" + a + ")";
  return fn + a.replace(/,\s*\)$/, ")");
}
