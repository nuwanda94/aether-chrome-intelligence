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

/** Accept only known string fields and executives that have a name. */
export function validateCompanyPayload(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "not-object" };
  }
  const payload = {};
  for (const key of STRING_KEYS) {
    if (!(key in raw)) continue;
    if (typeof raw[key] !== "string") {
      return { ok: false, reason: `field:${key}` };
    }
    payload[key] = raw[key];
  }
  if ("executives" in raw) {
    if (!Array.isArray(raw.executives)) {
      return { ok: false, reason: "executives" };
    }
    const executives = [];
    for (const e of raw.executives) {
      if (!e || typeof e !== "object" || Array.isArray(e)) continue;
      if (typeof e.name !== "string" || !e.name.trim()) continue;
      for (const k of EXEC_KEYS) {
        if (k in e && typeof e[k] !== "string") {
          return { ok: false, reason: `exec.${k}` };
        }
      }
      executives.push({
        name: e.name,
        role: typeof e.role === "string" ? e.role : "",
        email: typeof e.email === "string" ? e.email : "",
        linkedin: typeof e.linkedin === "string" ? e.linkedin : "",
        xing: typeof e.xing === "string" ? e.xing : "",
        wechat: typeof e.wechat === "string" ? e.wechat : "",
      });
    }
    payload.executives = executives;
  }
  return { ok: true, payload };
}
