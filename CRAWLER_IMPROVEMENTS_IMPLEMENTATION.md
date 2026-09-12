# Crawler Architecture & Implementation Guide

This document provides the actionable step-by-step implementation plan and complete module code required to upgrade the web crawler's frontier scoring, multi-value entity aggregation, personnel noise filtering, and fault-tolerant state recovery.

---

## Architecture Overview

```
                          ┌─────────────────────────────┐
                          │     Target Web Address      │
                          └──────────────┬──────────────┘
                                         │
                                         ▼
                     ┌───────────────────────────────────────┐
                     │ 1. Canonicalizer & Trap Filter        │
                     │    - Strip query tracking params      │
                     │    - Cycle & extension detection      │
                     └───────────────────┬───────────────────┘
                                         │
                                         ▼
                     ┌───────────────────────────────────────┐
                     │ 2. Dynamic Deficit Frontier           │
                     │    - Recalculates link priority based │
                     │      on missing schema attributes     │
                     └───────────────────┬───────────────────┘
                                         │
                     ┌───────────────────┴───────────────────┐
                     ▼                                       ▼
          [Page Fetch with Exponential Backoff]     [Service Worker Checkpoint]
                     │
                     ▼
       ┌───────────────────────────────────────────────────────────┐
       │ 3. Extraction & Multi-Value Aggregation                   │
       │    - Phone numbers normalized by trailing footprint       │
       │    - Addresses deduplicated via Jaccard token overlap     │
       │    - Departmental email classification                    │
       └─────────────────────────────┬─────────────────────────────┘
                                     │
                                     ▼
       ┌───────────────────────────────────────────────────────────┐
       │ 4. Validation & Noise Reduction Filter                    │
       │    - Strips UI labels, menu items & hiring announcements  │
       │    - Verifies human name syntax and leadership roles       │
       └─────────────────────────────┬─────────────────────────────┘
                                     │
                                     ▼
                     ┌───────────────────────────────┐
                     │   Verified Corporate Entity   │
                     └───────────────────────────────┘
```

---

## Implementation Plan: Phase by Phase

### Phase 1: URL Canonization & Deficit Frontier
* **Files to add/modify:**
  * Create `lib/frontier.js`
  * Integrate into `lib/engine.js` (`scoreLinks`, `expandFrontier`)
* **Key Capabilities:**
  * Reject non-HTML web assets (`.pdf`, `.zip`, `.png`, `.xlsx`, etc.).
  * Detect cyclic path loops (`/category/item/category/item`).
  * Eliminate tracking queries (`utm_*`, `gclid`, `fbclid`, session tokens).
  * Dynamically boost subpaths targeting missing attributes instead of using static weights.

### Phase 2: Multi-Value Entity Aggregation
* **Files to add/modify:**
  * Create `lib/aggregation.js`
  * Update `lib/schema.js` (`COMPANY_SCHEMA`, `mergeRecords`)
* **Key Capabilities:**
  * Convert scalar `email` and `phone` into structured collections (`emails: [{ email, department }]`, `phone_numbers: []`, `addresses: []`).
  * Deduplicate phone numbers by their numeric footprint (trailing 9 digits) while retaining international dialing codes.
  * Tokenize physical addresses and apply Jaccard similarity to prevent dropping distinct regional office branches.

### Phase 3: Entity Sanitization & Noise Elimination
* **Files to add/modify:**
  * Create `lib/validator.js`
  * Update markdown extraction in `lib/engine.js` and prompt constraints in `lib/schema.js`
* **Key Capabilities:**
  * Filter false positive personnel like navigation buttons ("Products", "Solutions Overview", "Enterprise"), generic descriptions, and job postings ("We're hiring VP of Eng").
  * Ensure extracted personnel have valid corporate titles and pass human name syntax validation.

### Phase 4: State Machine Resilience & Error Recovery
* **Files to add/modify:**
  * Create `lib/crawler-state.js`
  * Update `lib/harness.js` and `background/service-worker.js`
* **Key Capabilities:**
  * Store crawl state checkpoints in `chrome.storage.local`.
  * Exponential backoff with random jitter for network retries and HTTP 429 rate-limiting.
  * Resume in-progress crawl jobs after service worker sleep cycles.

---

## Source Code Specifications

### 1. `lib/frontier.js`

```javascript
/**
 * Frontier management: URL canonization, trap filtering, and dynamic link scoring.
 */

const ASSET_EXTENSIONS = new Set([
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "zip", "tar", "gz", "7z", "dmg", "iso",
  "png", "jpg", "jpeg", "gif", "svg", "webp", "ico",
  "mp3", "mp4", "wav", "avi", "mov", "webm",
  "css", "js", "json", "xml", "rss"
]);

const PATH_TRAP_RE = /(?:login|signin|signup|register|auth|cart|checkout|wishlist|subscribe|feed|search|wp-admin|wp-content)\b/i;

const TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "gclid", "fbclid", "msclkid", "mc_cid", "mc_eid", "ref", "source"
]);

/**
 * Normalizes URL and filters traps or binary assets.
 * @param {string} rawUrl 
 * @param {string} baseUrl 
 * @returns {string|null}
 */
export function canonicalizeUrl(rawUrl, baseUrl) {
  try {
    const url = new URL(rawUrl, baseUrl);
    if (!["http:", "https:"].includes(url.protocol)) return null;

    const pathname = url.pathname.toLowerCase();
    const ext = pathname.split(".").pop();
    if (ASSET_EXTENSIONS.has(ext)) return null;

    if (PATH_TRAP_RE.test(pathname)) return null;

    // Detect cyclic path loops (e.g., /shop/item/shop/item)
    const segments = pathname.split("/").filter(Boolean);
    const uniqueSegments = new Set(segments);
    if (segments.length > 3 && uniqueSegments.size < segments.length / 1.5) {
      return null;
    }

    // Strip tracking queries
    for (const param of Array.from(url.searchParams.keys())) {
      if (TRACKING_PARAMS.has(param.toLowerCase())) {
        url.searchParams.delete(param);
      }
    }

    url.hash = ""; // eliminate anchors
    const clean = url.origin + url.pathname + (url.search ? url.search : "");
    return clean.replace(/\/+$/, ""); // normalize trailing slash
  } catch {
    return null;
  }
}

const INTENT_TAXONOMY = {
  executives: {
    boost: 0.45,
    re: /\b(leadership|team|executives?|board|management|directors?|founders?|vorstand|leitung|officers?|people)\b/i,
  },
  addresses: {
    boost: 0.40,
    re: /\b(locations?|offices?|branches|headquarters|standort[e]?|find-us|directions?|kontakt|anfahrt)\b/i,
  },
  emails: {
    boost: 0.35,
    re: /\b(contact|contact-us|impressum|kontakt|support|get-in-touch)\b/i,
  },
  phone_numbers: {
    boost: 0.35,
    re: /\b(contact|call-us|hotline|support|offices?)\b/i,
  },
  description: {
    boost: 0.30,
    re: /\b(about|about-us|company|overview|story|who-we-are|profile)\b/i,
  }
};

/**
 * Calculates priority score using missing fields as dynamic deficit weights.
 * @param {{ href: string, text: string }} link 
 * @param {string[]} missingKeys 
 * @param {string} baseOrigin 
 * @returns {number} Score between 0.01 and 0.99
 */
export function scoreFrontierLink(link, missingKeys = [], baseOrigin = "") {
  const normUrl = canonicalizeUrl(link.href, baseOrigin);
  if (!normUrl) return 0;

  let score = 0.20; // baseline discovered link score
  const relativePath = normUrl.replace(baseOrigin, "");
  const haystack = `${link.text || ""} ${relativePath}`.toLowerCase();

  // Depth penalty (shallow paths are generally higher quality overview pages)
  const depth = new URL(normUrl).pathname.split("/").filter(Boolean).length;
  score -= Math.min(0.20, depth * 0.04);

  // Dynamic Deficit Weighting:
  for (const key of missingKeys) {
    const matcher = INTENT_TAXONOMY[key];
    if (matcher && matcher.re.test(haystack)) {
      score += matcher.boost;
    }
  }

  // Anchor text informativeness
  if (link.text && link.text.length > 2 && !/^(click|here|more|link|read|view)$/i.test(link.text)) {
    score += 0.05;
  }

  return Math.min(0.99, Math.max(0.01, Number(score.toFixed(3))));
}
```

---

### 2. `lib/aggregation.js`

```javascript
/**
 * Multi-value aggregation and deduplication utilities.
 */

export function normalizePhone(raw) {
  if (!raw) return null;
  const digitsOnly = String(raw).replace(/\D/g, "");
  if (digitsOnly.length < 7 || digitsOnly.length > 15) return null;

  const prefix = String(raw).trim().startsWith("+") ? "+" : "";
  return {
    raw: String(raw).trim(),
    clean: `${prefix}${digitsOnly}`,
    footprint: digitsOnly.slice(-9),
  };
}

export function deduplicatePhones(existing = [], incoming = []) {
  const map = new Map();
  const list = [...(existing || []), ...(incoming || [])];

  for (const item of list) {
    const parsed = normalizePhone(item);
    if (!parsed) continue;

    if (!map.has(parsed.footprint) || item.startsWith("+")) {
      map.set(parsed.footprint, parsed.raw);
    }
  }
  return Array.from(map.values());
}

function tokenizeAddress(addr) {
  return new Set(
    String(addr)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((tok) => tok.length > 1)
  );
}

function addressSimilarity(tokensA, tokensB) {
  const intersection = new Set([...tokensA].filter((x) => tokensB.has(x)));
  const union = new Set([...tokensA, ...tokensB]);
  if (union.size === 0) return 0;
  return intersection.size / union.size;
}

export function deduplicateAddresses(existing = [], incoming = []) {
  const result = [...(existing || [])];

  for (const candidate of (incoming || [])) {
    if (!candidate || candidate.trim().length < 8) continue;
    const clean = candidate.trim().replace(/\s+/g, " ");
    const candTokens = tokenizeAddress(clean);

    let matchIdx = -1;
    for (let i = 0; i < result.length; i++) {
      const existingTokens = tokenizeAddress(result[i]);
      if (addressSimilarity(candTokens, existingTokens) > 0.75) {
        matchIdx = i;
        break;
      }
    }

    if (matchIdx >= 0) {
      if (clean.length > result[matchIdx].length) {
        result[matchIdx] = clean;
      }
    } else {
      result.push(clean);
    }
  }

  return result;
}

export function aggregateEmails(existing = [], incoming = []) {
  const map = new Map();
  const list = [...(existing || []), ...(incoming || [])];

  for (const item of list) {
    const email = (typeof item === "string" ? item : item?.email || "").toLowerCase().trim();
    if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email)) continue;
    if (/noreply|no-reply|donotreply|example|domain/i.test(email)) continue;

    const [user] = email.split("@");
    let department = "general";
    if (/support|help|service|care/i.test(user)) department = "support";
    else if (/sales|deals|commercial|pricing/i.test(user)) department = "sales";
    else if (/press|media|pr|news/i.test(user)) department = "press";
    else if (/career|jobs|hr|talent|recruit/i.test(user)) department = "careers";
    else if (/legal|privacy|compliance/i.test(user)) department = "legal";

    if (!map.has(email)) {
      map.set(email, { email, department });
    }
  }

  return Array.from(map.values());
}
```

---

### 3. `lib/validator.js`

```javascript
/**
 * Entity validation and noise rejection for extracted data.
 */

const BANNED_NAME_TOKENS = new Set([
  "products", "product", "solutions", "solutions overview", "platform",
  "services", "pricing", "resources", "careers", "we are hiring", "jobs",
  "company", "about", "about us", "leadership", "executive team", "contact",
  "contact us", "blog", "press", "media", "privacy", "terms", "cookie policy",
  "security", "compliance", "login", "portal", "dashboard", "learn more",
  "get started", "read more", "whitepapers", "case studies", "faqs", "help center",
  "customer stories", "integrations", "documentation", "api", "overview"
]);

const RECRUITING_PHRASES_RE = /\b(we're hiring|open positions?|apply now|view openings?|join (?:us|the team)|salary|full-time|part-time|remote)\b/i;

const EXECUTIVE_TITLE_RE = /\b(chief|ceo|cto|cfo|coo|cro|cmo|cpo|president|founder|co-founder|director|vp|vice president|head of|managing director|partner|general manager|principal|board member|vorstand|geschäftsführer)\b/i;

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
    name: rawName,
    role: rawRole,
    confidence: "high"
  };
}

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
```

---

### 4. `lib/crawler-state.js`

```javascript
/**
 * Fault-tolerant crawler state management with storage checkpointing and backoff.
 */

export class CrawlerState {
  constructor({ maxPages = 4, maxRetries = 3, initialDelayMs = 1000, storageKey = "crawler_active_state" } = {}) {
    this.maxPages = maxPages;
    this.maxRetries = maxRetries;
    this.initialDelayMs = initialDelayMs;
    this.storageKey = storageKey;
    this.state = {
      visited: [],
      frontier: [],
      record: null,
      startedAt: Date.now(),
      status: "idle"
    };
  }

  async persist() {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      await chrome.storage.local.set({ [this.storageKey]: this.state });
    }
  }

  async restore() {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const stored = await chrome.storage.local.get(this.storageKey);
      if (stored && stored[this.storageKey]) {
        this.state = stored[this.storageKey];
        return true;
      }
    }
    return false;
  }

  async clear() {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      await chrome.storage.local.remove(this.storageKey);
    }
  }

  async executeWithRetry(actionFn, url, attempt = 1) {
    try {
      return await actionFn(url);
    } catch (err) {
      if (attempt >= this.maxRetries) throw err;
      const jitter = Math.floor(Math.random() * 300);
      const delay = this.initialDelayMs * Math.pow(2, attempt - 1) + jitter;
      await new Promise((resolve) => setTimeout(resolve, delay));
      return this.executeWithRetry(actionFn, url, attempt + 1);
    }
  }
}
```

---

## Integration Checklist & Modifications

| Target File | Modification Details |
| :--- | :--- |
| `lib/schema.js` | Update `COMPANY_SCHEMA` fields to support `addresses: []`, `phone_numbers: []`, and `emails: [{ email, department }]`. Update `mergeRecords` to use `deduplicatePhones`, `deduplicateAddresses`, and `aggregateEmails`. |
| `lib/engine.js` | Replace static `scoreLinks` with `scoreFrontierLink(link, missingKeys, baseOrigin)` in `expandFrontier`. Route all extracted executive entries through `sanitizeExecutive`. |
| `lib/harness.js` | Wrap step iterations with `CrawlerState.persist()` and call `executeWithRetry` during tab updates/content script dispatches. |
| `tests/engine.test.mjs` | Add test cases for URL trap detection, cyclic route rejection, token Jaccard address matching, and UI navigation keyword rejection. |

---

## Validation & Test Verification Command

Run test suites to ensure full backwards compatibility and verify the new aggregation logic:

```bash
npm test
```
