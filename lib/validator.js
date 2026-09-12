/**
 * Entity validation and noise rejection for extracted data.
 */

export const BANNED_NAME_TOKENS = new Set([
  "products", "product", "solutions", "solutions overview", "platform",
  "services", "pricing", "resources", "careers", "we are hiring", "jobs",
  "company", "about", "about us", "leadership", "executive team", "contact",
  "contact us", "blog", "press", "media", "privacy", "terms", "cookie policy",
  "security", "compliance", "login", "portal", "dashboard", "learn more",
  "get started", "read more", "whitepapers", "case studies", "faqs", "help center",
  "customer stories", "integrations", "documentation", "api", "overview", "enterprise"
]);

export const RECRUITING_PHRASES_RE = /\b(we're hiring|open positions?|apply now|view openings?|join (?:us|the team)|salary|full-time|part-time|remote)\b/i;

export const EXECUTIVE_TITLE_RE =
  /(?:\b(?:chief|ceo|cto|cfo|coo|cro|cmo|cpo|president|founder|co-founder|director|vp|vice president|head of|managing director|partner|general manager|principal|board member|officer)\b|vorstand|geschäftsführer(?:in)?|geschäftsführung|vorsitzende[rn]?|代表取締役|取締役|執行役員|社長|会長)/iu;

import { validateCompanyPayload } from "./schema.js";

export { validateCompanyPayload };

export function looksLikePersonName(rawName) {
  if (!rawName || typeof rawName !== "string") return false;
  const clean = rawName.replace(/[#*_`]/g, "").replace(/\s+/g, " ").trim();
  if (clean.length < 2 || clean.length > 50) return false;
  const lower = clean.toLowerCase();
  if (BANNED_NAME_TOKENS.has(lower)) return false;
  for (const banned of BANNED_NAME_TOKENS) {
    if (lower === banned || lower.startsWith(`${banned} `)) return false;
  }
  if (RECRUITING_PHRASES_RE.test(clean)) return false;
  const tokens = clean.split(/\s+/);
  if (tokens.length < 1 || tokens.length > 5) return false;
  return /^[\p{L}\p{M}.'’\-]+(?:\s+[\p{L}\p{M}.'’\-]+)*$/u.test(clean);
}

/**
 * Sanitizes executive entries, rejecting navigation elements, recruiting ads, or invalid names.
 * @param {object} entry 
 * @returns {object|null}
 */
export function sanitizeExecutive(entry) {
  if (!entry || typeof entry !== "object") return null;

  const rawName = String(entry.name || "")
    .replace(/[#*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const rawRole = String(entry.role || "")
    .replace(/[#*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (rawName.length < 2 || rawName.length > 50) return null;
  if (rawRole.length < 2 || rawRole.length > 90) return null;

  const lowerName = rawName.toLowerCase();
  if (BANNED_NAME_TOKENS.has(lowerName)) return null;
  for (const banned of BANNED_NAME_TOKENS) {
    if (lowerName === banned || lowerName.startsWith(`${banned} `)) return null;
  }

  if (RECRUITING_PHRASES_RE.test(rawName) || RECRUITING_PHRASES_RE.test(rawRole)) {
    return null;
  }

  const tokens = rawName.split(/\s+/);
  if (tokens.length < 1 || tokens.length > 5) return null;
  if (!/^[\p{L}\p{M}.'’\-]+(?:\s+[\p{L}\p{M}.'’\-]+)*$/u.test(rawName)) {
    return null;
  }

  if (!EXECUTIVE_TITLE_RE.test(rawRole)) {
    return null;
  }

  return {
    ...entry,
    name: rawName,
    role: rawRole,
    confidence: entry.confidence || "high",
  };
}

/**
 * Validates and sanitizes a complete record.
 * @param {object} record 
 * @returns {object}
 */
export function validateRecord(record) {
  if (!record || typeof record !== "object") return record;
  const result = { ...record };

  if (Array.isArray(result.executives)) {
    const seen = new Set();
    result.executives = result.executives
      .map(sanitizeExecutive)
      .filter(Boolean)
      .filter((e) => {
        const key = e.name.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  return result;
}
