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

const STRING_KEYS = [...FIELD_KEYS, "language"];
const EXEC_KEYS = ["name", "role", "email", "linkedin", "xing", "wechat"];

/** JSON Schema for Prompt API responseConstraint. Strings and arrays of strings. */
export const COMPANY_JSON_SCHEMA = {
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
      },
    },
  },
};

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
 * Null / number / boolean fields become strings. A type mismatch on one
 * executive field no longer rejects the whole Nano result.
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
    payload.addresses = raw.addresses
      .map(asString)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!payload.address && payload.addresses.length) {
      payload.address = payload.addresses[0];
    }
    any = true;
  } else if (payload.address) {
    payload.addresses = [payload.address];
  }

  if ("phone_numbers" in raw && Array.isArray(raw.phone_numbers)) {
    payload.phone_numbers = raw.phone_numbers
      .map(asString)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!payload.phone && payload.phone_numbers.length) {
      payload.phone = payload.phone_numbers[0];
    }
    any = true;
  } else if (payload.phone) {
    payload.phone_numbers = [payload.phone];
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
      payload.executives.push(row);
    }
    any = true;
  }
  if (!any) return { ok: false, reason: "empty" };
  return { ok: true, payload };
}
