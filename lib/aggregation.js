/**
 * Multi-value aggregation and deduplication utilities.
 */

export function normalizePhone(raw) {
  if (!raw) return null;
  const str = String(raw).trim();
  const basePart = str.split(/\b(?:ext|extension|x)\b/i)[0];
  const digitsOnly = basePart.replace(/\D/g, "");
  if (digitsOnly.length < 7 || digitsOnly.length > 15) return null;

  const prefix = str.startsWith("+") ? "+" : "";
  return {
    raw: str,
    clean: `${prefix}${digitsOnly}`,
    footprint: digitsOnly.slice(-8),
    hasExtension: str.length > basePart.length,
  };
}

export function deduplicatePhones(existing = [], incoming = []) {
  const map = new Map();
  const list = [...(existing || []), ...(incoming || [])];

  for (const item of list) {
    const parsed = normalizePhone(item);
    if (!parsed) continue;

    const existingItem = map.get(parsed.footprint);
    if (!existingItem) {
      map.set(parsed.footprint, parsed.raw);
    } else {
      if (
        parsed.raw.length > existingItem.length ||
        (parsed.raw.startsWith("+") && !existingItem.startsWith("+"))
      ) {
        map.set(parsed.footprint, parsed.raw);
      }
    }
  }
  return Array.from(map.values());
}

export function tokenizeAddress(addr) {
  return new Set(
    String(addr)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((tok) => tok.length > 1)
  );
}

export function addressSimilarity(tokensA, tokensB) {
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

export function classifyEmailDepartment(email) {
  if (!email) return "general";
  const [user] = String(email).toLowerCase().split("@");
  if (/\b(career|careers|jobs|hr|talent|recruit|recruiting)\b|career/i.test(user)) return "careers";
  if (/\b(billing|invoice|account)\b|billing/i.test(user)) return "billing";
  if (/\b(press|media|pr|news)\b|press/i.test(user)) return "press";
  if (/\b(sales|deals|commercial|pricing)\b|sales/i.test(user)) return "sales";
  if (/\b(support|help|service|care|customer-care|customercare)\b|support|helpdesk/i.test(user)) return "support";
  if (/\b(legal|privacy|compliance)\b/i.test(user)) return "legal";
  return "general";
}

export function aggregateEmails(existing = [], incoming = []) {
  const map = new Map();
  const list = [...(existing || []), ...(incoming || [])];

  for (const item of list) {
    const email = (typeof item === "string" ? item : item?.email || "").toLowerCase().trim();
    if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email)) continue;
    if (/noreply|no-reply|donotreply/i.test(email)) continue;
    if (/^(?:email|yourname|name|test|user)@(example|domain|placeholder|yourcompany)\.com$/i.test(email)) continue;

    const department = (typeof item === "object" && item?.department && item.department !== "general")
      ? item.department
      : classifyEmailDepartment(email);

    if (!map.has(email)) {
      map.set(email, { email, department });
    }
  }

  return Array.from(map.values());
}
