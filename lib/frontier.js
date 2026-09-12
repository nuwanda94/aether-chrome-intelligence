/**
 * Frontier management: URL canonization, trap filtering, and dynamic link scoring.
 */

export const ASSET_EXTENSIONS = new Set([
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "zip", "tar", "gz", "7z", "dmg", "iso",
  "png", "jpg", "jpeg", "gif", "svg", "webp", "ico",
  "mp3", "mp4", "wav", "avi", "mov", "webm",
  "css", "js", "json", "xml", "rss"
]);

export const PATH_TRAP_RE = /(?:login|signin|signup|register|auth|cart|checkout|wishlist|subscribe|feed|search|wp-admin|wp-content)\b/i;

export const TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "gclid", "fbclid", "msclkid", "mc_cid", "mc_eid", "ref", "source",
  "session_id", "sessionid", "sid", "phpsessid", "jsessionid"
]);

/**
 * Normalizes URL and filters traps, cyclic path loops, or binary assets.
 * @param {string} rawUrl 
 * @param {string} baseUrl 
 * @returns {string|null}
 */
export function canonicalizeUrl(rawUrl, baseUrl) {
  try {
    const url = new URL(rawUrl, baseUrl);
    if (!["http:", "https:"].includes(url.protocol)) return null;

    const pathname = url.pathname.toLowerCase();
    const lastSeg = pathname.split("/").filter(Boolean).pop() || "";
    const ext = lastSeg.includes(".") ? lastSeg.split(".").pop() : "";
    if (ASSET_EXTENSIONS.has(ext)) return null;

    if (PATH_TRAP_RE.test(pathname)) return null;

    // Detect cyclic path loops (e.g., /shop/item/shop/item)
    const segments = pathname.split("/").filter(Boolean);
    const uniqueSegments = new Set(segments);
    if (segments.length > 3 && uniqueSegments.size < segments.length / 1.5) {
      return null;
    }

    url.pathname = pathname;

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

export const INTENT_TAXONOMY = {
  executives: {
    boost: 0.50,
    re: /\b(leadership|team|executives?|board|management|directors?|founders?|vorstand|leitung|officers?|people|役員|リーダー|経営)\b/i,
  },
  addresses: {
    boost: 0.46,
    re: /\b(locations?|offices?|branches|headquarters|standort[e]?|find-us|directions?|kontakt|anfahrt|拠点|支社|本社)\b/i,
  },
  emails: {
    boost: 0.45,
    re: /\b(contact|contact-us|impressum|kontakt|support|get-in-touch|お問い合わせ)\b/i,
  },
  phone_numbers: {
    boost: 0.45,
    re: /\b(contact|call-us|hotline|support|offices?|phone|tel)\b/i,
  },
  description: {
    boost: 0.40,
    re: /\b(about|about-us|company|overview|story|who-we-are|profile|über-uns|ueber-uns|会社概要|企業情報)\b/i,
  }
};

/**
 * Normalizes field keys to match INTENT_TAXONOMY taxonomy keys.
 */
function normalizeIntentKey(key) {
  if (key === "address") return "addresses";
  if (key === "email") return "emails";
  if (key === "phone") return "phone_numbers";
  return key;
}

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

  let score = 0.22; // baseline discovered link score
  const relativePath = normUrl.replace(baseOrigin, "");
  const haystack = `${link.text || ""} ${relativePath}`.toLowerCase();

  // Depth penalty (shallow paths are generally higher quality overview pages)
  const depth = new URL(normUrl).pathname.split("/").filter(Boolean).length;
  score -= Math.min(0.20, depth * 0.04);

  const hasDeficits = Array.isArray(missingKeys) && missingKeys.length > 0;
  const targetKeys = hasDeficits
    ? missingKeys.map(normalizeIntentKey)
    : Object.keys(INTENT_TAXONOMY);

  for (const key of targetKeys) {
    const matcher = INTENT_TAXONOMY[key];
    if (matcher && matcher.re.test(haystack)) {
      score += matcher.boost;
      if (hasDeficits) {
        score += 0.35; // Priority deficit boost
      }
    }
  }

  // Anchor text informativeness
  if (link.text && link.text.length > 2 && !/^(click|here|more|link|read|view)$/i.test(link.text)) {
    score += 0.05;
  }

  return Math.min(0.99, Math.max(0.01, Number(score.toFixed(3))));
}

/**
 * Expands frontier with canonicalized, deduplicated, and deficit-scored links.
 * Accepts flexible argument patterns:
 * expandFrontier(links, origin, missingKeys, visited) OR
 * expandFrontier(links, missingKeys, visited, origin)
 */
export function expandFrontier(links, arg2, arg3 = [], arg4 = "") {
  let origin = "";
  let missingKeys = [];
  let visited = new Set();

  if (typeof arg2 === "string") {
    origin = arg2;
    if (Array.isArray(arg3)) missingKeys = arg3;
    if (arg4 instanceof Set || Array.isArray(arg4)) visited = new Set(arg4);
  } else if (Array.isArray(arg2)) {
    missingKeys = arg2;
    if (arg3 instanceof Set || Array.isArray(arg3)) visited = new Set(arg3);
    if (typeof arg4 === "string") origin = arg4;
  }

  const seen = new Set();
  const scored = [];
  for (const link of links || []) {
    if (!link?.href) continue;
    const normUrl = canonicalizeUrl(link.href, origin);
    if (!normUrl || seen.has(normUrl) || visited.has(normUrl)) continue;
    seen.add(normUrl);

    const score = scoreFrontierLink(link, missingKeys, origin);
    if (score > 0) {
      scored.push({
        href: normUrl,
        text: link.text || "",
        score,
        reason: `frontier · deficit (${score.toFixed(2)})`,
      });
    }
  }
  return scored.sort((a, b) => b.score - a.score);
}
