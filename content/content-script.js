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
  return blocks.join("\n\n").slice(0, 24_000);
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

function highlight(id) {
  document.querySelectorAll("[data-aether-hit]").forEach((el) => {
    el.removeAttribute("data-aether-hit");
    el.style.outline = "";
  });
  if (!id) return;
  let el = document.getElementById(id);
  if (!el) {
    const cx = document.evaluate(
      `//*[contains(normalize-space(text()), ${JSON.stringify(id.slice(0, 40))})]`,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null,
    ).singleNodeValue;
    el = cx;
  }
  if (!el) return;
  el.setAttribute("data-aether-hit", "1");
  el.style.outline = "2px solid #2c5548";
  el.style.outlineOffset = "4px";
  el.scrollIntoView({ behavior: "smooth", block: "center" });
}

function serialize() {
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
  };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "AETHER_SERIALIZE") {
    sendResponse({ ok: true, doc: serialize() });
    return true;
  }
  if (msg?.type === "AETHER_HIGHLIGHT") {
    highlight(msg.sourceId || msg.snippet);
    sendResponse({ ok: true });
    return true;
  }
  return false;
});
