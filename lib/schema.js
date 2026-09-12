import {
  deduplicateAddresses,
  deduplicatePhones,
  aggregateEmails,
} from "./aggregation.js";
import { sanitizeExecutive, validateRecord } from "./validator.js";

const FIELD_KEYS = [
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

const FIELD_LABELS = {
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

const STRING_KEYS = [...FIELD_KEYS, "language"];
const EXEC_KEYS = ["name", "role", "email", "linkedin", "xing", "wechat"];

/** JSON Schema for Prompt API and Gemini extraction. Multi-value addresses, phones, and departmental emails. */
export const COMPANY_SCHEMA = {
  type: "object",
  properties: {
    company_name: { type: "string" },
    legal_name: { type: "string" },
    industry: { type: "string" },
    description: { type: "string" },
    address: { type: "string" },
    addresses: {
      type: "array",
      items: { type: "string" },
    },
    email: { type: "string" },
    emails: {
      type: "array",
      items: {
        type: "object",
        properties: {
          email: { type: "string" },
          department: { type: "string" },
        },
        required: ["email", "department"],
      },
    },
    phone: { type: "string" },
    phone_numbers: {
      type: "array",
      items: { type: "string" },
    },
    website: { type: "string" },
    linkedin: { type: "string" },
    xing: { type: "string" },
    wechat: { type: "string" },
    language: { type: "string" },
    executives: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          role: { type: "string" },
          email: { type: "string" },
          linkedin: { type: "string" },
          xing: { type: "string" },
          wechat: { type: "string" },
        },
        required: ["name"],
      },
    },
  },
};

export const COMPANY_JSON_SCHEMA = COMPANY_SCHEMA;

function asString(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

const NON_PERSON_RE =
  /^(products?|solutions?|about(\s+us)?|careers?|blog|faqs?|contact(\s+us)?|customers?|features?|pricing|services?|integrations?|resources?|documentation|docs|support|privacy(\s+policy)?|terms(\s+of\s+service)?|security|login|sign\s*in|sign\s*up|get\s*started|platform|overview|company)$/i;

const FEATURE_METRIC_RE =
  /\b(\d+%\s*(?:gain|increase|reduction|growth|efficiency)|payment\s+processing|automated\s+multi-currency|settlement)\b/i;

/**
 * Coerce a model payload into the company record shape.
 * Multi-value collections (addresses, phone_numbers, emails) are validated and deduplicated.
 */
export function validateCompanyPayload(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "not-object" };
  }
  const payload = {};
  let any = false;
  for (const key of STRING_KEYS) {
    if (!(key in raw)) continue;
    payload[key] = asString(raw[key]);
    any = true;
  }
  if ("addresses" in raw && Array.isArray(raw.addresses)) {
    const cleaned = raw.addresses
      .map(asString)
      .map((s) => s.trim())
      .filter(Boolean);
    payload.addresses = deduplicateAddresses([], cleaned);
    if (!payload.address && payload.addresses.length) {
      payload.address = payload.addresses[0];
    }
    any = true;
  } else if (payload.address) {
    payload.addresses = [payload.address];
  }

  if ("phone_numbers" in raw && Array.isArray(raw.phone_numbers)) {
    const cleaned = raw.phone_numbers
      .map(asString)
      .map((s) => s.trim())
      .filter(Boolean);
    payload.phone_numbers = deduplicatePhones([], cleaned);
    if (!payload.phone && payload.phone_numbers.length) {
      payload.phone = payload.phone_numbers[0];
    }
    any = true;
  } else if (payload.phone) {
    payload.phone_numbers = [payload.phone];
  }

  if ("emails" in raw && Array.isArray(raw.emails)) {
    payload.emails = aggregateEmails([], raw.emails);
    if (!payload.email && payload.emails.length) {
      payload.email = payload.emails[0].email;
    }
    any = true;
  } else if (payload.email) {
    payload.emails = aggregateEmails([], [payload.email]);
  }

  if (raw.social && typeof raw.social === "object" && !Array.isArray(raw.social)) {
    if (!payload.linkedin && raw.social.linkedin) payload.linkedin = asString(raw.social.linkedin);
    if (!payload.xing && raw.social.xing) payload.xing = asString(raw.social.xing);
    if (!payload.wechat && raw.social.wechat) payload.wechat = asString(raw.social.wechat);
    any = true;
  }
  if ("executives" in raw) {
    const list = Array.isArray(raw.executives) ? raw.executives : [];
    payload.executives = [];
    for (const e of list) {
      if (!e || typeof e !== "object" || Array.isArray(e)) continue;
      const name = asString(e.name).trim();
      if (!name) continue;
      if (NON_PERSON_RE.test(name) || FEATURE_METRIC_RE.test(name)) continue;
      const row = { name };
      for (const k of EXEC_KEYS) {
        if (k === "name") continue;
        row[k] = asString(e[k]);
      }
      const sanitized = sanitizeExecutive(row);
      if (sanitized) {
        payload.executives.push({ ...row, ...sanitized });
      } else if (!NON_PERSON_RE.test(name) && !FEATURE_METRIC_RE.test(name) && name.length <= 60) {
        // Fallback for custom or non-standard roles while preserving noise rejection
        payload.executives.push(row);
      }
    }
    any = true;
  }
  if (!any) return { ok: false, reason: "empty" };
  return { ok: true, payload };
}

/**
 * Merge two records using multi-value aggregation (phones, addresses, emails)
 * and noise-reduced executive validation.
 */
export function mergeRecords(base, patch) {
  const merged = {
    ...base,
    addresses: deduplicateAddresses(base.addresses || [], patch.addresses || []),
    phone_numbers: deduplicatePhones(base.phone_numbers || [], patch.phone_numbers || []),
    emails: aggregateEmails(
      base.emails || [],
      patch.emails || (patch.fields?.email?.value ? [patch.fields.email.value] : [])
    ),
    executives: [...(base.executives || [])],
    pagesVisited: [...(base.pagesVisited || [])],
    markdownByUrl: { ...base.markdownByUrl, ...patch.markdownByUrl },
  };

  const conflicts = [];
  for (const page of patch.pagesVisited || []) {
    if (!merged.pagesVisited.some((p) => p.url === page.url)) {
      merged.pagesVisited.push({ ...page, role: "heal" });
    }
  }

  const rank = { low: 0, medium: 1, high: 2 };
  for (const key of FIELD_KEYS) {
    const current = merged.fields[key];
    const incoming = patch.fields?.[key];
    if (!incoming?.value) continue;
    if (!current?.value) {
      merged.fields[key] = { ...incoming, dirty: false, verified: current?.verified || false };
      continue;
    }
    if (current.value === incoming.value) continue;
    if (current.dirty || current.verified) {
      conflicts.push({
        key,
        label: FIELD_LABELS[key] || key,
        current: current.value,
        incoming: incoming.value,
        sourceUrl: incoming.sourceUrl,
      });
      continue;
    }
    if ((rank[incoming.confidence] ?? 0) > (rank[current.confidence] ?? 0)) {
      merged.fields[key] = { ...incoming, dirty: false, verified: false };
    }
  }

  if (!merged.fields.address.value && merged.addresses.length) {
    merged.fields.address.value = merged.addresses[0];
  }
  if (!merged.fields.phone.value && merged.phone_numbers.length) {
    merged.fields.phone.value = merged.phone_numbers[0];
  }
  if (!merged.fields.email.value && merged.emails.length) {
    merged.fields.email.value = merged.emails[0].email;
  }

  for (const exec of patch.executives || []) {
    const sanitized = sanitizeExecutive(exec) || exec;
    const existing = merged.executives.find(
      (e) => e.name.toLowerCase() === sanitized.name.toLowerCase(),
    );
    if (!existing) merged.executives.push(sanitized);
  }

  const isComp = Boolean(
    merged.fields.company_name?.value &&
      merged.fields.address?.value &&
      merged.fields.email?.value &&
      merged.executives.length > 0
  );

  merged.complete = isComp;
  merged.extractedAt = new Date().toISOString();
  return { merged, conflicts };
}

