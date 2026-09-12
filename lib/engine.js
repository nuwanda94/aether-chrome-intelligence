const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE =
  /(?:\+|00)[\d\s().-]{8,22}|\(\d{3}\)\s?\d{3}[-.\s]?\d{4}|\d{3}[-.\s]\d{3}[-.\s]\d{4}/g;
const LINKEDIN_RE =
  /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/(?:in|company)\/[A-Za-z0-9_-]+/gi;
const XING_RE =
  /(?:https?:\/\/)?(?:www\.)?xing\.com\/(?:profile|pages)\/[A-Za-z0-9._-]+/gi;
const WECHAT_RE = /(?:wechat|微信)[:\s]+([A-Za-z0-9_-]{4,20})/gi;
const ROLE_HINTS =
  /\b(chief|ceo|cto|cfo|coo|chairman|chairwoman|president|founder|director|vp|vice president|head of|managing director|board|officer|vorstand|vorsitzende[rn]?|geschäftsführer(?:in)?|代表取締役|取締役|執行役員|社長)\b/i;

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
    .replace(/&amp;/g, "&")
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
    addresses: [],
    phone_numbers: [],
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

const EXEC_KEYS = ["name", "role", "email", "linkedin", "xing", "wechat"];

/** Accept only known string fields and executives that have a name. */
export function validateCompanyPayload(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, payload: null };
  }
  const payload = {};
  for (const key of FIELD_KEYS) {
    if (!(key in raw)) continue;
    if (typeof raw[key] !== "string") return { ok: false, payload: null };
    payload[key] = raw[key];
  }
  if ("language" in raw) {
    if (typeof raw.language !== "string") return { ok: false, payload: null };
    payload.language = raw.language;
  }
  if ("executives" in raw) {
    if (!Array.isArray(raw.executives)) return { ok: false, payload: null };
    const executives = [];
    for (const e of raw.executives) {
      if (!e || typeof e !== "object" || Array.isArray(e)) {
        return { ok: false, payload: null };
      }
      if (!e.name || typeof e.name !== "string" || !e.name.trim()) continue;
      const row = { name: e.name.trim() };
      for (const k of EXEC_KEYS) {
        if (k === "name") continue;
        if (k in e) {
          if (typeof e[k] !== "string") return { ok: false, payload: null };
          row[k] = e[k];
        }
      }
      executives.push(row);
    }
    payload.executives = executives;
  }
  return { ok: true, payload };
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

  // Synthesize concise, professional description of core products/services
  const descCandidates = doc.markdown
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 50 && !l.startsWith("#") && !l.startsWith("-") && !l.startsWith("Address:") && !l.startsWith("Contact:"));
  const desc = descCandidates.find((l) => !/cookie|copyright|rights reserved|privacy/i.test(l));
  if (desc) {
    const cleanDesc = desc
      .replace(/^(Welcome to\s+|At\s+[^,]+,\s*)/i, "")
      .trim();
    rec.fields.description.value = cleanDesc.slice(0, 320);
    rec.fields.description.confidence = "medium";
  }

  // Multi-value Addresses extraction: capture all listed business addresses, HQ, and regional offices
  const allAddresses = [];
  const addAddress = (a) => {
    if (!a) return;
    const clean = a.replace(/^[*\-•#\s]+/, "").replace(/\s+/g, " ").trim();
    if (clean.length <= 5) return;
    const lower = clean.toLowerCase();

    // Check if an existing address already contains this one or vice versa
    const existingIdx = allAddresses.findIndex((ex) => {
      const exLower = ex.toLowerCase();
      return exLower.includes(lower) || lower.includes(exLower);
    });

    if (existingIdx >= 0) {
      // Keep the longer, more complete address line
      if (clean.length > allAddresses[existingIdx].length) {
        allAddresses[existingIdx] = clean;
      }
      return;
    }

    allAddresses.push(clean);
  };

  const labeledAddrRe = /(?:(?:Primary\s+|Global\s+|Regional\s+|European\s+|Headquarters\s+|HQ\s+|Corporate\s+)?(?:Address|Headquarters|HQ|Office|Location|Standort|Anschrift|本社|支社)(?:\s+(?:Address|Location|Office|Standort))?[:\s]+)([^\n\r]+)/gi;
  let lm;
  while ((lm = labeledAddrRe.exec(doc.markdown))) {
    const line = lm[1].trim();
    if (!line.includes("@") && !line.startsWith("http")) {
      addAddress(line);
    }
  }

  const postalMatches = doc.markdown.match(/(?:〒\s*\d{3}-?\d{4}[^\n\r]+|\d{4,5}\s+[A-ZÄÖÜ][a-zäöüß]+[^\n\r]+|\b\d{1,5}\s+[A-Za-z0-9\s.,-]+(?:Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Drive|Dr|Way|Lane|Ln|Square|Sq|Plaza|Friedrichstraße|Straße|str\.)[A-Za-z0-9\s.,\d-]*\b)/gi) || [];
  for (const pm of postalMatches) {
    if (!pm.includes("@") && !pm.startsWith("http")) {
      addAddress(pm);
    }
  }

  if (!allAddresses.length) {
    const fallbackAddr = doc.markdown.match(
      /(?:〒\s*\d{3}-?\d{4}[^\n]+|\d{3,5}\s+[A-ZÄÖÜ][a-zäöüß]+[^\n]+|Address:\s*(.+)|Headquarters[:\s]+(.+))/i,
    );
    if (fallbackAddr) {
      addAddress((fallbackAddr[1] || fallbackAddr[2] || fallbackAddr[0]).trim());
    }
  }

  rec.addresses = allAddresses;
  if (allAddresses.length) {
    rec.fields.address.value = allAddresses[0];
    rec.fields.address.confidence = "medium";
  }

  const email = firstMatch(doc.markdown, EMAIL_RE);
  if (email) {
    rec.fields.email.value = email.toLowerCase();
    rec.fields.email.confidence = "high";
  }

  // Multi-value Phone numbers extraction: extract all unique phone numbers
  const allPhones = [];
  const seenPhones = new Set();
  const phoneMatches = doc.markdown.match(PHONE_RE) || [];
  for (const p of phoneMatches) {
    const cleanP = p.trim();
    if (cleanP.length >= 7 && !seenPhones.has(cleanP)) {
      seenPhones.add(cleanP);
      allPhones.push(cleanP);
    }
  }
  rec.phone_numbers = allPhones;
  if (allPhones.length) {
    rec.fields.phone.value = allPhones[0];
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

function looksLikePersonName(s) {
  const t = String(s || "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!t || t.length < 2 || t.length > 80) return false;
  if (/@|https?:|www\.|#/.test(t)) return false;
  const tokens = t.split(" ");
  if (tokens.length < 1 || tokens.length > 5) return false;
  if (/^(address|contact|email|phone|impressum|leadership|team|about)$/i.test(t)) {
    return false;
  }
  return /^[\p{L}\p{M}.·'’\-]+(?:\s+[\p{L}\p{M}.·'’\-]+)*$/u.test(t);
}

function normalizeRole(role) {
  return String(role || "")
    .replace(/\*\*/g, "")
    .replace(/\s+[—–-]\s+\S+@\S+\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tokensCount(s) {
  return String(s || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function extractExecs(doc) {
  const out = [];
  const seen = new Set();
  const push = (rawName, rawRole, rawEmail) => {
    const name = String(rawName || "")
      .replace(/\*\*/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const role = normalizeRole(rawRole);
    const email = String(rawEmail || "").trim();
    if (!looksLikePersonName(name) || !role || role.length > 120) return;
    if (ROLE_HINTS.test(name) && tokensCount(name) === 1) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      id: crypto.randomUUID(),
      name,
      role,
      email,
      linkedin: "",
      xing: "",
      wechat: "",
      confidence: ROLE_HINTS.test(role) ? "high" : "medium",
      sourceUrl: doc.url,
      dirty: false,
      verified: false,
    });
  };

  const md = String(doc.markdown || "");

  const boldRe =
    /^[-*]\s+\*\*(.+?)\*\*\s+[—–-]\s+(.+?)(?:\s+[—–-]\s+(\S+@\S+))?$/gm;
  let m;
  while ((m = boldRe.exec(md))) push(m[1], m[2], m[3]);

  const dashRe =
    /^(?:[-*]\s+)?([\p{L}\p{M}.·'’\-\s]{2,80}?)\s+[—–-]\s+([^\n@]+?)(?:\s+[—–-]\s+(\S+@\S+))?\s*$/gmu;
  while ((m = dashRe.exec(md))) {
    if (m[0].includes("**")) continue;
    push(m[1], m[2], m[3]);
  }

  const commaRe =
    /^(?:[-*]\s+)?([\p{L}\p{M}.·'’\-\s]{2,80}),\s+([^\n,@]{2,80})$/gmu;
  while ((m = commaRe.exec(md))) {
    const role = m[2].trim();
    if (ROLE_HINTS.test(role)) push(m[1], role, "");
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

const TRAP_RE =
  /\/(?:blog|news|articles?|posts?|tag|tags|category|categories|privacy(?:-policy)?|terms(?:-of-service|-of-use|-and-conditions)?|cookies?(?:-policy)?|legal(?!\/impressum)|imprint|disclaimer|sitemap|rss|feed|login|signin|sign-in|signup|sign-up|register|auth|cart|checkout|shop|store|product-category|events|webinars?|podcast|whitepapers?|case-studies|faq|help|support|status)\b/i;

const TRAP_TEXT_RE =
  /\b(privacy\s+policy|terms\s+of\s+service|terms\s+of\s+use|cookie\s+policy|cookie\s+settings|legal\s+notice|all\s+rights\s+reserved|site\s*map|user\s+agreement|help\s+center|support\s+portal|log\s*in|sign\s*in|sign\s*up|my\s+account|shopping\s+cart|checkout|subscribe|rss\s+feed|read\s+our\s+blog|latest\s+news|white\s*papers?|case\s+studies)\b/i;

const TAXONOMY = [
  {
    label: "leadership",
    weight: 0.96,
    re: /\b(leadership|team|executives?|board|management|directors|vorstand|leitung|役員|リーダー|経営|people)\b|(\/(?:team|leadership|executives|board|management|directors|vorstand)\b)/i,
  },
  {
    label: "locations",
    weight: 0.90,
    re: /\b(locations?|offices?|branches|headquarters|standorte|standort|拠点|支社|本社)\b|(\/(?:locations?|offices?|branches|standort(?:e)?)\b)/i,
  },
  {
    label: "company",
    weight: 0.88,
    re: /\b(company|corporate|firm|unternehmen|会社概要|企業情報)\b|(\/(?:company|corporate|firm|unternehmensprofil)\b)/i,
  },
  {
    label: "about",
    weight: 0.82,
    re: /\b(about|about\s+us|über\s+uns|ueber-uns|who\s+we\s+are|profile)\b|(\/(?:about(?:-us)?|ueber-uns|profile)\b)/i,
  },
  {
    label: "contact",
    weight: 0.76,
    re: /\b(contact|contact\s+us|impressum|kontakt|お問い合わせ)\b|(\/(?:contact(?:-us)?|impressum|kontakt)\b)/i,
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
    const hay = `${link.text || ""} ${link.href || ""}`;

    // Trap avoidance: generic footer boilerplate, marketing blogs, auth, cart
    if (TRAP_RE.test(abs) || TRAP_TEXT_RE.test(hay)) {
      scored.push({
        href: abs,
        text: link.text,
        score: 0.01,
        reason: "trap · ignored",
      });
      continue;
    }

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
    addresses: [...(base.addresses || [])],
    phone_numbers: [...(base.phone_numbers || [])],
    executives: [...base.executives],
    pagesVisited: [...base.pagesVisited],
    markdownByUrl: { ...base.markdownByUrl, ...patch.markdownByUrl },
  };
  const conflicts = [];
  for (const page of patch.pagesVisited || []) {
    if (!merged.pagesVisited.some((p) => p.url === page.url)) {
      merged.pagesVisited.push({ ...page, role: "heal" });
    }
  }

  // Merge multi-value addresses without duplicates
  for (const a of patch.addresses || []) {
    if (!a || a.trim().length <= 5) continue;
    const clean = a.trim();
    const lower = clean.toLowerCase();
    const existingIdx = merged.addresses.findIndex((ex) => {
      const exLower = ex.toLowerCase();
      return exLower.includes(lower) || lower.includes(exLower);
    });
    if (existingIdx >= 0) {
      if (clean.length > merged.addresses[existingIdx].length) {
        merged.addresses[existingIdx] = clean;
      }
    } else {
      merged.addresses.push(clean);
    }
  }

  // Merge multi-value phone numbers without duplicates
  for (const p of patch.phone_numbers || []) {
    if (!p) continue;
    const clean = p.trim();
    const digits = clean.replace(/\D/g, "");
    const existingIdx = merged.phone_numbers.findIndex((ex) => {
      const exDigits = ex.replace(/\D/g, "");
      return exDigits === digits || (digits.length >= 7 && exDigits.endsWith(digits)) || (exDigits.length >= 7 && digits.endsWith(exDigits));
    });
    if (existingIdx >= 0) {
      if (clean.length > merged.phone_numbers[existingIdx].length) {
        merged.phone_numbers[existingIdx] = clean;
      }
    } else {
      merged.phone_numbers.push(clean);
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

  if (!merged.fields.address.value && merged.addresses.length) {
    merged.fields.address.value = merged.addresses[0];
  }
  if (!merged.fields.phone.value && merged.phone_numbers.length) {
    merged.fields.phone.value = merged.phone_numbers[0];
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

export function toTargetSchema(rec, pii = false) {
  const val = (key) =>
    pii ? maskValue(key, rec?.fields?.[key]?.value || "") : rec?.fields?.[key]?.value || "";

  let addresses = Array.isArray(rec?.addresses) && rec.addresses.length
    ? rec.addresses.map((a) => (typeof a === "string" ? a.trim() : String(a || ""))).filter(Boolean)
    : [];
  if (!addresses.length && rec?.fields?.address?.value) {
    addresses = [rec.fields.address.value.trim()];
  }

  let phoneNumbers = Array.isArray(rec?.phone_numbers) && rec.phone_numbers.length
    ? rec.phone_numbers.map((p) => (pii ? maskValue("phone", p) : String(p || "").trim())).filter(Boolean)
    : [];
  if (!phoneNumbers.length && rec?.fields?.phone?.value) {
    phoneNumbers = [pii ? maskValue("phone", rec.fields.phone.value) : rec.fields.phone.value.trim()];
  }

  const executives = (rec?.executives || []).map((e) => ({
    name: e.name || "",
    role: e.role || "",
  }));

  return {
    company_name: val("company_name"),
    industry: val("industry"),
    description: val("description"),
    addresses,
    phone_numbers: phoneNumbers,
    email: val("email"),
    website: val("website"),
    executives,
  };
}

export function recordToTargetJson(rec, pii = false) {
  return JSON.stringify(toTargetSchema(rec, pii), null, 2);
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
      addresses: (rec.addresses && rec.addresses.length) ? rec.addresses : (val("address") ? [val("address")] : []),
      email: val("email"),
      phone: val("phone"),
      phone_numbers: (rec.phone_numbers && rec.phone_numbers.length)
        ? rec.phone_numbers.map((p) => (pii ? maskValue("phone", p) : p))
        : (val("phone") ? [val("phone")] : []),
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

export const SCHEMA_PROMPT = `You are an advanced web crawling and data extraction agent. Your objective is to navigate website structures intelligently, follow the correct internal paths (such as "About Us", "Contact", "Locations", or "Leadership"), and extract comprehensive, multi-value data points into a clean JSON structure.

### 1. Navigation & Crawl Strategy (Path Robustness)
- **Prioritize High-Value Pages:** Actively look for and prioritize internal content containing paths like /contact, /about, /locations, /team, or /company if the landing page lacks complete details.
- **Avoid Traps:** Ignore generic footer boilerplate, irrelevant marketing blogs, or navigation links that do not contribute to core company data.

### 2. Multi-Value Extraction Rules
- **Phone Numbers:** If a company lists multiple phone numbers (e.g., toll-free, regional offices, support lines), extract all unique numbers into an array rather than stopping at the first match.
- **Addresses:** Capture all listed business addresses, headquarters, and regional office locations rather than only capturing the primary footer address.

### 3. Synthesis & Description Generation
- **Product/Service Description:** Read the core content of the website (hero sections, product pages, solutions overview) and write a professional, objective description summarizing what products or services the company provides.
- **Tone:** Keep descriptions concise, factual, and business-focused (avoiding fluff or marketing hype).

### 4. Target Output Schema
Return the extracted data strictly adhering to this JSON format:
{
  "company_name": "string",
  "industry": "string",
  "description": "Synthesized, professional description of the company's core products and services based on website content.",
  "addresses": [
    "Primary or Headquarter Address",
    "Secondary / Regional Address (if available)"
  ],
  "phone_numbers": [
    "Primary Phone",
    "Secondary / Toll-Free Phone"
  ],
  "email": "string",
  "website": "string",
  "executives": [
    {
      "name": "Full Human Name",
      "role": "Corporate Job Title"
    }
  ]
}

### Critical Constraints for the \`executives\` Field:
1. **NO UI/Navigation Elements:** Under no circumstances should website navigation links, menu items, or footer elements (e.g., "Products", "Solutions", "About", "Careers", "Blog", "FAQ", "Contact Us", "Customers") be extracted as people.
2. **NO Product Features or Services:** Bullet points describing software features, payment methods, or metrics must never be placed in the \`executives\` list.
3. **Valid Person Names Only:** The \`name\` field must contain a recognizable human name. If no real person is mentioned, return an empty array \`[]\`.
4. **Valid Leadership Roles:** The \`role\` field must reflect a corporate title or leadership function (e.g., "Chief Executive Officer", "Founder", "VP of Engineering", "Head of Product").

Preserve Unicode. Empty string or [] if unknown.`;

