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

/** JSON Schema for Prompt API responseConstraint. Strings only — Nano often emits nulls. */
export const COMPANY_JSON_SCHEMA = {
  type: "object",
  properties: {
    company_name: { type: "string" },
    legal_name: { type: "string" },
    industry: { type: "string" },
    description: { type: "string" },
    address: { type: "string" },
    email: { type: "string" },
    phone: { type: "string" },
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
  if ("executives" in raw) {
    const list = Array.isArray(raw.executives) ? raw.executives : [];
    payload.executives = [];
    for (const e of list) {
      if (!e || typeof e !== "object" || Array.isArray(e)) continue;
      const name = asString(e.name).trim();
      if (!name) continue;
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
