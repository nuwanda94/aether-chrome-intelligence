const STRIP_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "IFRAME",
  "SVG",
  "CANVAS",
  "VIDEO",
  "AUDIO",
  "LINK",
  "META",
]);

/** Keep enough text for map-reduce chunking (~20k words). Inference still splits at 8k tokens. */
const SERIALIZE_CHAR_CAP = 200_000;

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_RE =
  /(?:\+|00)[\d\s().-]{8,22}|\(\d{3}\)\s?\d{3}[-.\s]?\d{4}|\d{3}[-.\s]\d{3}[-.\s]\d{4}/;
const ROLE_HINTS =
  /\b(chief|ceo|cto|cfo|coo|chairman|chairwoman|president|founder|director|vp|vice president|head of|managing director|board|officer|vorstand|vorsitzende|geschäftsführer|代表取締役|取締役|執行役員|社長)\b/i;

function sanitizeClone(root) {
  const clone = root.cloneNode(true);
  const walker = document.createTreeWalker(clone, NodeFilter.SHOW_ELEMENT);
  const drop = [];
  while (walker.nextNode()) {
    const el = walker.currentNode;
    if (STRIP_TAGS.has(el.tagName)) {
      drop.push(el);
      continue;
    }
    if (el.tagName === "IMG") {
      const w = Number(el.getAttribute("width") || el.width || 0);
      const h = Number(el.getAttribute("height") || el.height || 0);
      if ((w && w <= 2) || (h && h <= 2)) drop.push(el);
    }
    el.removeAttribute("style");
    for (const attr of [...el.attributes]) {
      if (attr.name.startsWith("on")) el.removeAttribute(attr.name);
    }
  }
  drop.forEach((n) => n.remove());
  return clone;
}

function toMarkdown(node) {
  const blocks = [];
  const walk = (el) => {
    if (!el || el.nodeType !== 1) return;
    const tag = el.tagName;
    const text = el.innerText?.replace(/\s+/g, " ").trim();
    if (["H1", "H2", "H3", "H4"].includes(tag) && text) {
      const n = Number(tag[1]);
      blocks.push(`${"#".repeat(n)} ${text}`);
      return;
    }
    if (tag === "A" && el.href) {
      blocks.push(`[${text || el.href}](${el.href})`);
      return;
    }
    if (tag === "LI" && text) {
      blocks.push(`- ${text}`);
      return;
    }
    if (["P", "ADDRESS", "FIGCAPTION", "TD", "TH"].includes(tag) && text) {
      blocks.push(text);
      return;
    }
    for (const child of el.children) walk(child);
  };
  walk(node);
  return blocks.join("\n\n").slice(0, SERIALIZE_CHAR_CAP);
}

function collectLinks() {
  return [...document.querySelectorAll("a[href]")]
    .slice(0, 80)
    .map((a) => ({
      href: a.href,
      text: (a.innerText || a.getAttribute("aria-label") || "").trim().slice(0, 80),
    }))
    .filter((l) => l.href.startsWith("http") && l.text);
}

function norm(s) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function ownText(el) {
  return [...el.childNodes]
    .filter((n) => n.nodeType === 3)
    .map((n) => n.textContent)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function stampNode(el, kind, seq) {
  if (!el || el.nodeType !== 1) return null;
  const existing = el.getAttribute("data-aether-id");
  if (existing) return existing;
  const id = `aeth-${kind}-${seq.n++}`;
  el.setAttribute("data-aether-id", id);
  el.setAttribute("data-aether-kind", kind);
  return id;
}

/** Stamp live heading / email / phone / person nodes with stable data-aether-id. */
function stampSourceIds() {
  const seq = { n: 1 };
  const sources = [];

  const mark = (el, kind) => {
    const id = stampNode(el, kind, seq);
    if (!id) return;
    const text = (el.innerText || el.getAttribute("href") || "").replace(/\s+/g, " ").trim();
    if (text) sources.push({ id, kind, text: text.slice(0, 240) });
  };

  document.querySelectorAll("h1, h2, h3, h4").forEach((el) => mark(el, "heading"));

  document.querySelectorAll("a[href^='mailto:']").forEach((el) => mark(el, "email"));
  document.querySelectorAll("a[href^='tel:']").forEach((el) => mark(el, "phone"));

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  while (walker.nextNode()) {
    const el = walker.currentNode;
    if (el.hasAttribute("data-aether-id")) continue;
    if (STRIP_TAGS.has(el.tagName)) continue;
    const text = ownText(el) || "";
    if (EMAIL_RE.test(text)) {
      mark(el, "email");
      continue;
    }
    if (PHONE_RE.test(text) && text.length < 40) {
      mark(el, "phone");
      continue;
    }
    const blockText = (el.innerText || "").replace(/\s+/g, " ").trim();
    if (
      ["LI", "P", "ARTICLE", "FIGCAPTION", "TD"].includes(el.tagName) &&
      blockText &&
      blockText.length < 220 &&
      ROLE_HINTS.test(blockText)
    ) {
      mark(el, "person");
    }
  }

  return sources;
}

function findBySourceId(id) {
  if (!id) return null;
  try {
    return document.querySelector(`[data-aether-id="${CSS.escape(id)}"]`);
  } catch {
    return document.querySelector(`[data-aether-id="${id}"]`);
  }
}

function findBySnippet(snippet, kind) {
  const needle = norm(snippet).slice(0, 80);
  if (!needle) return null;
  const nodes = [...document.querySelectorAll("[data-aether-id]")];
  const ranked = [];
  for (const el of nodes) {
    const hay = norm(el.innerText || el.getAttribute("href") || "");
    if (!hay) continue;
    const kindOk = !kind || el.getAttribute("data-aether-kind") === kind;
    if (hay === needle) ranked.push({ el, score: kindOk ? 4 : 3 });
    else if (hay.includes(needle)) ranked.push({ el, score: kindOk ? 2 : 1 });
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked[0]?.el || null;
}

function highlight(sourceId, snippet, kind) {
  document.querySelectorAll("[data-aether-hit]").forEach((el) => {
    el.removeAttribute("data-aether-hit");
    el.style.outline = "";
    el.style.outlineOffset = "";
    el.style.background = "";
  });
  if (!sourceId && !snippet) return false;
  if (!document.querySelector("[data-aether-id]")) stampSourceIds();
  let el = findBySourceId(sourceId) || findBySnippet(snippet || sourceId, kind);
  if (!el) {
    // Fallback: search visible text nodes when stamps are missing (SPA re-render).
    const needle = norm(snippet || sourceId).slice(0, 60);
    if (needle) {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (norm(node.textContent).includes(needle)) {
          el = node.parentElement;
          break;
        }
      }
    }
  }
  if (!el) return false;
  el.setAttribute("data-aether-hit", "1");
  el.style.outline = "2px solid #2c5548";
  el.style.outlineOffset = "4px";
  el.style.background = "color-mix(in oklab, #2c5548 18%, transparent)";
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  return true;
}

function serialize() {
  const sources = stampSourceIds();
  const main =
    document.querySelector("main, article, [role=main], body") || document.body;
  const clean = sanitizeClone(main);
  const markdown = toMarkdown(clean);
  const lang =
    document.documentElement.lang ||
    document.querySelector("html")?.getAttribute("lang") ||
    navigator.language ||
    "en";
  return {
    url: location.href,
    title: document.title,
    lang,
    markdown,
    links: collectLinks(),
    sources,
  };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "AETHER_SERIALIZE") {
    sendResponse({ ok: true, doc: serialize() });
    return true;
  }
  if (msg?.type === "AETHER_HIGHLIGHT") {
    const found = highlight(msg.sourceId, msg.snippet, msg.kind);
    sendResponse({ ok: true, found: Boolean(found) });
    return true;
  }
  return false;
});
