import { FIELD_KEYS, languageName } from "./engine.js";

/** Persisted domain-schema version; bump when the cache blob shape changes. */
export const SCHEMA_VERSION = 2;
/** Stale cache entries older than this are treated as a miss. */
export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const SNIPPET_MAX = 160;

export function slimSourceSnippet(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SNIPPET_MAX);
}

function slimField(f, key) {
  return {
    key,
    value: f?.value || "",
    confidence: f?.confidence || "low",
    sourceUrl: f?.sourceUrl || "",
    sourceId: f?.sourceId || "",
    sourceSnippet: slimSourceSnippet(f?.sourceSnippet),
    dirty: Boolean(f?.dirty),
    verified: Boolean(f?.verified),
  };
}

/** Persistable schema: fields, execs, pages, language — no markdownByUrl. */
export function toCachePayload(record) {
  if (!record) return null;
  const fields = {};
  for (const key of FIELD_KEYS) {
    fields[key] = slimField(record.fields?.[key], key);
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    id: record.id,
    language: record.language || "en",
    languageName: record.languageName || languageName(record.language),
    fields,
    executives: (record.executives || []).map((e) => ({
      id: e.id,
      name: e.name || "",
      role: e.role || "",
      email: e.email || "",
      linkedin: e.linkedin || "",
      xing: e.xing || "",
      wechat: e.wechat || "",
      confidence: e.confidence || "low",
      sourceUrl: e.sourceUrl || "",
      sourceId: e.sourceId || "",
      sourceSnippet: slimSourceSnippet(e.sourceSnippet),
      dirty: Boolean(e.dirty),
      verified: Boolean(e.verified),
    })),
    pagesVisited: (record.pagesVisited || []).map((p) => ({
      url: p.url,
      title: p.title || "",
      role: p.role || "primary",
    })),
    extractedAt: record.extractedAt || new Date().toISOString(),
    cachedAt: new Date().toISOString(),
    complete: Boolean(record.complete),
  };
}

/** True when entry is current schema and within TTL. */
export function isFreshCacheEntry(entry, now = Date.now(), ttlMs = CACHE_TTL_MS) {
  if (!entry || typeof entry !== "object") return false;
  if (entry.schemaVersion !== SCHEMA_VERSION) return false;
  if (!entry.fields || typeof entry.fields !== "object") return false;
  const ts = Date.parse(entry.extractedAt || entry.cachedAt || "");
  if (!Number.isFinite(ts)) return false;
  if (now - ts > ttlMs) return false;
  return true;
}

/** Return a usable in-memory record or null (cache miss). */
export function readCacheRecord(entry, now = Date.now(), ttlMs = CACHE_TTL_MS) {
  if (!isFreshCacheEntry(entry, now, ttlMs)) return null;
  return {
    ...entry,
    markdownByUrl: {},
    cacheHit: false,
  };
}
