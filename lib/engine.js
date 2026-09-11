const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE =
  /(?:\+|00)[\d\s().-]{8,22}|\(\d{3}\)\s?\d{3}[-.\s]?\d{4}|\d{3}[-.\s]\d{3}[-.\s]\d{4}/g;
const LINKEDIN_RE =
  /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/(?:in|company)\/[A-Za-z0-9_-]+/gi;
const XING_RE =
  /(?:https?:\/\/)?(?:www\.)?xing\.com\/(?:profile|pages)\/[A-Za-z0-9._-]+/gi;
const WECHAT_RE = /(?:wechat|微信)[:\s]+([A-Za-z0-9_-]{4,20})/gi;
const ROLE_HINTS =
  /\b(chief|ceo|cto|cfo|coo|chairman|chairwoman|president|founder|director|vp|vice president|head of|managing director|board|officer|vorstand|vorsitzende|geschäftsführer|代表取締役|取締役|執行役員|社長)\b/i;

export const FIELD_KEYS = [
  "company_name",
  "legal_name",
  "industry",
  "description",
  "address",
  "email",
  "phone",
  "website",
  "linkedin",
  "xing",
  "wechat",
];

export const FIELD_LABELS = {
  company_name: "Company",
  legal_name: "Legal name",
  industry: "Industry",
  description: "Profile",
  address: "Address",
  email: "Email",
  phone: "Phone",
  website: "Website",
  linkedin: "LinkedIn",
  xing: "Xing",
  wechat: "WeChat",
};

const LANG_NAMES = {
  en: "English",
  de: "Deutsch",
  ja: "日本語",
  es: "Español",
  fr: "Français",
  zh: "中文",
  ko: "한국어",
};

/** ~4 chars per token; Prompt API context budget for a single pass. */
export const TOKEN_LIMIT = 8000;
export const CHARS_PER_TOKEN = 4;

export function estimateTokens(text) {
  return Math.ceil(String(text || "").length / CHARS_PER_TOKEN);
}

function splitOversized(text, maxTokens) {
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  if (text.length <= maxChars) return [text];
  const paras = text.split(/\n{2,}/);
  const out = [];
  let buf = "";
  for (const p of paras) {
    if ((buf + "\n\n" + p).length > maxChars && buf) {
      out.push(buf.trim());
      buf = p;
    } else {
      buf = buf ? `${buf}\n\n${p}` : p;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  const flat = [];
  for (const chunk of out) {
    if (chunk.length <= maxChars) {
      flat.push(chunk);
      continue;
    }
    for (let i = 0; i < chunk.length; i += maxChars) {
      flat.push(chunk.slice(i, i + maxChars));
    }
  }
  return flat;
}

/** Split markdown on h1–h3 when the page exceeds TOKEN_LIMIT. Small pages stay one chunk. */
export function chunkMarkdown(markdown, maxTokens = TOKEN_LIMIT) {
  const text = String(markdown || "").trim();
  if (!text) return [];
  if (estimateTokens(text) <= maxTokens) return [text];
  const sections = text.split(/(?=^#{1,3}\s)/m).map((s) => s.trim()).filter(Boolean);
  const parts = sections.length ? sections : [text];
  const chunks = [];
  let buf = "";
  for (const part of parts) {
    const next = buf ? `${buf}\n\n${part}` : part;
    if (estimateTokens(next) > maxTokens && buf) {
      chunks.push(...splitOversized(buf, maxTokens));
      buf = part;
    } else {
      buf = next;
    }
  }
  if (buf.trim()) chunks.push(...splitOversized(buf.trim(), maxTokens));
  return chunks.filter(Boolean);
}

export function languageName(code) {
  const base = (code || "en").toLowerCase().split("-")[0];
  return LANG_NAMES[base] || code || "English";
}

export function detectLanguage(langAttr, text) {
  if (langAttr && langAttr !== "und") return langAttr.split("-")[0];
  if (/[\u3040-\u30ff\u4e00-\u9faf]/.test(text)) return "ja";
  if (/[äöüßÄÖÜ]/.test(text) || /\b(und|für|gesellschaft|straße)\b/i.test(text))
    return "de";
  return "en";
}

export function sanitizeHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<canvas[\s\S]*?<\/canvas>/gi, "")
    .replace(/ on[a-z]+="[^"]*"/gi, "")
    .replace(/ style="[^"]*"/gi, "")
    .replace(/<img[^>]*(width=["']1["']|height=["']1["'])[^>]*>/gi, "")
    .replace(/<link[^>]*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
}

export function htmlToMarkdown(html) {
  return sanitizeHtml(html)
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "# $1\n\n")
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "## $1\n\n")
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "### $1\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n")
    .replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")
    .replace(/<(?:p|div|section|article|header|footer|address)[^>]*>/gi, "\n")
    .replace(/<\/(?:p|div|section|article|header|footer|address)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function emptyField(key, sourceUrl) {
  return {
    key,
    value: "",
    confidence: "low",
    sourceUrl,
    dirty: false,
    verified: false,
  };
}

export function emptyRecord(sourceUrl, lang = "en") {
  const fields = {};
  for (const key of FIELD_KEYS) fields[key] = emptyField(key, sourceUrl);
  return {
    id: crypto.randomUUID(),
    language: lang,
    languageName: languageName(lang),
    fields,
    executives: [],
    pagesVisited: [],
    markdownByUrl: {},
    extractedAt: new Date().toISOString(),
    complete: false,
    cacheHit: false,
  };
}

function firstMatch(text, re) {
  re.lastIndex = 0;
  const m = text.match(re);
  return m?.[0]?.trim() || "";
}

function conf(value, structured) {
  if (!value) return "low";
  if (structured && value.length > 3) return "high";
  if (value.length > 8) return "medium";
  return "low";
}

function normText(s) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Best-match source id from content-script stamps (data-aether-id). */
export function matchSourceId(sources, value, kinds = []) {
  if (!Array.isArray(sources) || !sources.length || !value) return "";
  const needle = normText(value);
  if (!needle) return "";
  let bestId = "";
  let bestScore = 0;
  for (const s of sources) {
    if (kinds.length && !kinds.includes(s.kind)) continue;
    const hay = normText(s.text);
    if (!hay) continue;
    let score = 0;
    if (hay === needle) score = 4;
    else if (hay.includes(needle) || needle.includes(hay)) score = 2;
    else {
      const prefix = needle.slice(0, Math.min(48, needle.length));
      if (prefix.length >= 4 && hay.includes(prefix)) score = 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestId = s.id || "";
    }
  }
  return bestId;
}

function attachSourceIds(rec, sources) {
  if (!Array.isArray(sources) || !sources.length) return rec;
  const mapField = (key, kinds) => {
    const f = rec.fields[key];
    if (!f?.value) return;
    const id = matchSourceId(sources, f.value, kinds);
    if (id) {
      f.sourceId = id;
      if (!f.sourceSnippet) f.sourceSnippet = f.value;
    }
  };
  mapField("company_name", ["heading"]);
  mapField("legal_name", ["heading"]);
  mapField("email", ["email"]);
  mapField("phone", ["phone"]);
  mapField("address", ["heading"]);
  for (const e of rec.executives || []) {
    if (!e?.name) continue;
    const id =
      matchSourceId(sources, e.name, ["person"]) ||
      matchSourceId(sources, `${e.name} ${e.role || ""}`.trim(), ["person"]);
    if (id) e.sourceId = id;
  }
  return rec;
}

export function extractFromMarkdown(doc) {
  const rec = emptyRecord(doc.url, detectLanguage(doc.lang, doc.markdown));
  rec.markdownByUrl[doc.url] = doc.markdown;
  rec.pagesVisited = [{ url: doc.url, title: doc.title, role: "primary" }];

  const h1 = doc.markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const company = h1 || doc.title.split(/[|–—-]/)[0]?.trim() || "";
  rec.fields.company_name = {
    ...emptyField("company_name", doc.url),
    value: company,
    confidence: conf(company, !!h1),
    sourceSnippet: company,
  };
  if (/gmbh|ag\b|inc\.|llc|ltd|株式会社/i.test(company)) {
    rec.fields.legal_name = { ...rec.fields.company_name, key: "legal_name" };
  }

  const desc = doc.markdown
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 80 && !l.startsWith("#") && !l.startsWith("-"));
  if (desc) {
    rec.fields.description.value = desc.slice(0, 280);
    rec.fields.description.confidence = "medium";
  }

  const addr = doc.markdown.match(
    /(?:〒\s*\d{3}-?\d{4}[^\n]+|\d{3,5}\s+[A-ZÄÖÜ][a-zäöüß]+[^\n]+|Address:\s*(.+)|Headquarters[:\s]+(.+))/i,
  );
  if (addr) {
    rec.fields.address.value = (addr[1] || addr[2] || addr[0]).trim();
    rec.fields.address.confidence = "medium";
  }

  const email = firstMatch(doc.markdown, EMAIL_RE);
  if (email) {
    rec.fields.email.value = email.toLowerCase();
    rec.fields.email.confidence = "high";
  }
  const phone = firstMatch(doc.markdown, PHONE_RE);
  if (phone) {
    rec.fields.phone.value = phone.trim();
    rec.fields.phone.confidence = "medium";
  }
  try {
    rec.fields.website.value = new URL(doc.url).origin;
    rec.fields.website.confidence = "high";
  } catch {
    rec.fields.website.value = doc.url;
  }
  const linkedin = firstMatch(doc.markdown, LINKEDIN_RE);
  if (linkedin) rec.fields.linkedin.value = linkedin.startsWith("http") ? linkedin : `https://${linkedin}`;
  const xing = firstMatch(doc.markdown, XING_RE);
  if (xing) rec.fields.xing.value = xing.startsWith("http") ? xing : `https://${xing}`;
  WECHAT_RE.lastIndex = 0;
  const wechat = WECHAT_RE.exec(doc.markdown);
  if (wechat?.[1]) rec.fields.wechat.value = wechat[1];

  rec.executives = extractExecs(doc);
  attachSourceIds(rec, doc.sources);
  rec.complete = isComplete(rec);
  rec.extractedAt = new Date().toISOString();
  return rec;
}

function extractExecs(doc) {
  const out = [];
  const lineRe =
    /^[-*]\s+\*\*(.+?)\*\*\s+[—–-]\s+(.+?)(?:\s+[—–-]\s+(\S+@\S+))?$/gm;
  let m;
  while ((m = lineRe.exec(doc.markdown))) {
    out.push({
      id: crypto.randomUUID(),
      name: m[1].trim(),
      role: m[2].trim(),
      email: m[3]?.trim() || "",
      linkedin: "",
      xing: "",
      wechat: "",
      confidence: ROLE_HINTS.test(m[2]) ? "high" : "medium",
      sourceUrl: doc.url,
      dirty: false,
      verified: false,
    });
  }
  return out;
}

export function isComplete(rec) {
  return Boolean(
    rec.fields.company_name.value &&
      rec.fields.address.value &&
      rec.fields.email.value &&
      rec.executives.length > 0,
  );
}

export function missingFields(rec) {
  const m = [];
  if (!rec.fields.company_name.value) m.push("company_name");
  if (!rec.fields.address.value) m.push("address");
  if (!rec.fields.email.value) m.push("email");
  if (!rec.executives.length) m.push("executives");
  return m;
}

const TAXONOMY = [
  {
    label: "leadership",
    weight: 0.96,
    re: /leadership|team|executives?|board|management|directors|vorstand|leitung|役員|リーダー|経営|people/i,
  },
  {
    label: "about",
    weight: 0.82,
    re: /about|company|über uns|ueber-uns|会社概要|企業情報|who we are|profile|firm/i,
  },
  {
    label: "contact",
    weight: 0.74,
    re: /contact|impressum|legal|お問い合わせ|kontakt|offices?|locations?/i,
  },
];

export function scoreLinks(links, origin) {
  const seen = new Set();
  const scored = [];
  for (const link of links) {
    let abs = link.href;
    try {
      abs = new URL(link.href, origin).toString();
    } catch {
      continue;
    }
    if (seen.has(abs)) continue;
    seen.add(abs);
    const hay = `${link.text} ${link.href}`;
    let best = { href: abs, text: link.text, score: 0.05, reason: "unclassified" };
    for (const tax of TAXONOMY) {
      if (tax.re.test(hay)) {
        best = {
          href: abs,
          text: link.text,
          score: tax.weight,
          reason: `zero-shot · ${tax.label}`,
        };
        break;
      }
    }
    scored.push(best);
  }
  return scored.sort((a, b) => b.score - a.score);
}

export function mergeRecords(base, patch) {
  const merged = {
    ...base,
    executives: [...base.executives],
    pagesVisited: [...base.pagesVisited],
    markdownByUrl: { ...base.markdownByUrl, ...patch.markdownByUrl },
  };
  const conflicts = [];
  for (const page of patch.pagesVisited) {
    if (!merged.pagesVisited.some((p) => p.url === page.url)) {
      merged.pagesVisited.push({ ...page, role: "heal" });
    }
  }
  const rank = { low: 0, medium: 1, high: 2 };
  for (const key of FIELD_KEYS) {
    const current = merged.fields[key];
    const incoming = patch.fields[key];
    if (!incoming?.value) continue;
    if (!current.value) {
      merged.fields[key] = { ...incoming, dirty: false, verified: current.verified };
      continue;
    }
    if (current.value === incoming.value) continue;
    if (current.dirty || current.verified) {
      conflicts.push({
        key,
        label: FIELD_LABELS[key],
        current: current.value,
        incoming: incoming.value,
        sourceUrl: incoming.sourceUrl,
      });
      continue;
    }
    if (rank[incoming.confidence] > rank[current.confidence]) {
      merged.fields[key] = { ...incoming, dirty: false, verified: false };
    }
  }
  for (const exec of patch.executives) {
    const existing = merged.executives.find(
      (e) => e.name.toLowerCase() === exec.name.toLowerCase(),
    );
    if (!existing) merged.executives.push(exec);
  }
  merged.complete = isComplete(merged);
  merged.extractedAt = new Date().toISOString();
  return { merged, conflicts };
}

export function maskValue(key, value) {
  if (!value) return value;
  if (key === "email") {
    const [u, d] = value.split("@");
    return d ? `${(u || "").slice(0, 1)}•••@${d}` : "•••";
  }
  if (key === "phone") return value.replace(/\d/g, "•");
  return value;
}

function maskTextPii(text) {
  return String(text || "")
    .replace(EMAIL_RE, (m) => maskValue("email", m))
    .replace(PHONE_RE, (m) => maskValue("phone", m));
}

/** Clone a record with emails/phones redacted for chrome.storage.local. */
export function maskRecordForCache(rec) {
  if (!rec) return rec;
  const fields = {};
  for (const key of FIELD_KEYS) {
    const f = rec.fields?.[key] ? { ...rec.fields[key] } : emptyField(key, "");
    if (key === "email" || key === "phone") {
      f.value = maskValue(key, f.value);
    }
    if (f.sourceSnippet) f.sourceSnippet = maskTextPii(f.sourceSnippet);
    fields[key] = f;
  }
  const markdownByUrl = {};
  for (const [url, md] of Object.entries(rec.markdownByUrl || {})) {
    markdownByUrl[url] = maskTextPii(md);
  }
  return {
    ...rec,
    fields,
    executives: (rec.executives || []).map((e) => ({
      ...e,
      email: e.email ? maskValue("email", e.email) : e.email,
    })),
    markdownByUrl,
  };
}

function csvCell(value) {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Executives as CSV with name,role,email. Emails masked when pii is true. */
export function executivesToCsv(rec, pii = false) {
  const header = "name,role,email";
  const rows = (rec?.executives || []).map((e) => {
    const email = pii && e.email ? maskValue("email", e.email) : e.email || "";
    return [csvCell(e.name || ""), csvCell(e.role || ""), csvCell(email)].join(",");
  });
  return [header, ...rows].join("\n") + "\n";
}

export function recordToJson(rec, pii) {
  const val = (key) =>
    pii ? maskValue(key, rec.fields[key].value) : rec.fields[key].value;
  return JSON.stringify(
    {
      company_name: val("company_name"),
      legal_name: val("legal_name"),
      industry: val("industry"),
      description: val("description"),
      address: val("address"),
      email: val("email"),
      phone: val("phone"),
      website: val("website"),
      social: {
        linkedin: val("linkedin"),
        xing: val("xing"),
        wechat: val("wechat"),
      },
      executives: rec.executives.map((e) => ({
        name: e.name,
        role: e.role,
        email: pii && e.email ? maskValue("email", e.email) : e.email,
        linkedin: e.linkedin,
        xing: e.xing,
        wechat: e.wechat,
      })),
      language: rec.language,
      pages_visited: rec.pagesVisited.map((p) => p.url),
      extracted_at: rec.extractedAt,
    },
    null,
    2,
  );
}

export function hashUrl(url) {
  let h = 2166136261;
  for (let i = 0; i < url.length; i++) {
    h ^= url.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

export const SCHEMA_PROMPT = `You extract company intelligence from page Markdown.
Return ONLY JSON:
{
  "company_name": string,
  "legal_name": string,
  "industry": string,
  "description": string,
  "address": string,
  "email": string,
  "phone": string,
  "website": string,
  "linkedin": string,
  "xing": string,
  "wechat": string,
  "language": string,
  "executives": [{"name": string, "role": string, "email": string, "linkedin": string, "xing": string, "wechat": string}]
}
Preserve Unicode. Empty string if unknown.`;
