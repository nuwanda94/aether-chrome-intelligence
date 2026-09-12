import {
  SCHEMA_PROMPT,
  extractFromMarkdown,
  emptyRecord,
  FIELD_KEYS,
  chunkMarkdown,
  TOKEN_LIMIT,
  mergeRecords,
  matchSourceId,
} from "./engine.js";
import { COMPANY_JSON_SCHEMA, validateCompanyPayload } from "./schema.js";

/** Minimal options so availability() matches create(). */
const MODEL_OPTIONS = {
  expectedInputs: [{ type: "text", languages: ["en"] }],
  expectedOutputs: [{ type: "text", languages: ["en"] }],
};

function getLM() {
  return globalThis.LanguageModel || globalThis.ai?.languageModel || null;
}

/** Map legacy Prompt API values (`readily`, `after-download`, `no`) onto the current enum. */
export function normalizeAvailability(value) {
  const s = String(value || "")
    .toLowerCase()
    .trim();
  if (s === "available" || s === "readily") return "available";
  if (s === "downloadable" || s === "after-download") return "downloadable";
  if (s === "downloading") return "downloading";
  if (s === "unavailable" || s === "no" || s === "none") return "unavailable";
  return s || "unknown";
}

export async function probeNano() {
  const LM = getLM();
  if (!LM) return { status: "missing-api", api: false };
  try {
    if (typeof LM.availability !== "function") {
      return { status: "unknown", api: true };
    }
    let a;
    try {
      a = await LM.availability(MODEL_OPTIONS);
    } catch {
      a = await LM.availability();
    }
    return { status: normalizeAvailability(a), api: true };
  } catch {
    return { status: "unavailable", api: true };
  }
}

async function samplingParams(LM) {
  try {
    if (typeof LM.params !== "function") return {};
    const p = await LM.params();
    const maxK = Number(p?.maxTopK);
    const defK = Number(p?.defaultTopK);
    const maxT = Number(p?.maxTemperature);
    const topK = Number.isFinite(maxK)
      ? Math.min(8, Math.max(1, defK || 3))
      : 3;
    const temperature = Number.isFinite(maxT) ? Math.min(0.2, maxT) : 0.2;
    if (!Number.isFinite(topK) || !Number.isFinite(temperature)) return {};
    return { temperature, topK };
  } catch {
    return {};
  }
}

/**
 * Create a LanguageModel session. Triggers model download when status is
 * downloadable / downloading. Reports 0–1 progress via onProgress.
 * @param {(loaded: number) => void} [onProgress]
 * @returns {Promise<object|null>}
 */
export async function getLanguageModel(onProgress) {
  const LM = getLM();
  if (!LM || typeof LM.create !== "function") return null;

  try {
    let status = "unknown";
    if (typeof LM.availability === "function") {
      try {
        status = normalizeAvailability(await LM.availability(MODEL_OPTIONS));
      } catch {
        status = normalizeAvailability(await LM.availability());
      }
    }
    if (status === "unavailable") return null;

    const monitor = (m) => {
      try {
        m.addEventListener("downloadprogress", (e) => {
          const loaded = Number(e?.loaded);
          if (Number.isFinite(loaded) && typeof onProgress === "function") {
            onProgress(Math.min(1, Math.max(0, loaded)));
          }
        });
      } catch {
        /* older CreateMonitor shapes */
      }
    };

    if (typeof onProgress === "function" && status === "downloadable") onProgress(0);
    if (typeof onProgress === "function" && status === "downloading") onProgress(0.01);

    const sample = await samplingParams(LM);
    const attempts = [
      { ...MODEL_OPTIONS, ...sample, monitor },
      { ...MODEL_OPTIONS, monitor },
      { monitor },
    ];

    let session = null;
    for (const opts of attempts) {
      try {
        session = await LM.create(opts);
        if (session) break;
      } catch {
        session = null;
      }
    }
    if (typeof onProgress === "function" && session) onProgress(1);
    return session || null;
  } catch {
    return null;
  }
}

export async function ensureNano(onEvent) {
  const emit = (status, loaded) => {
    try {
      onEvent?.({ status, loaded });
    } catch {
      /* ignore UI errors */
    }
  };

  const probe = await probeNano();
  if (probe.status === "missing-api") {
    emit("missing-api");
    return { ok: false, status: "missing-api" };
  }
  if (probe.status === "unavailable") {
    emit("unavailable");
    return { ok: false, status: "unavailable" };
  }
  if (probe.status === "available") {
    emit("available", 1);
    return { ok: true, status: "available" };
  }

  emit(probe.status === "downloading" ? "downloading" : "downloadable", 0);
  const session = await getLanguageModel((loaded) => {
    emit("downloading", loaded);
  });
  if (session) {
    try {
      session.destroy?.();
    } catch {
      /* ignore */
    }
    emit("available", 1);
    return { ok: true, status: "available" };
  }
  emit("unavailable");
  return { ok: false, status: "unavailable" };
}

export function applyJson(doc, data) {
  const rec = extractFromMarkdown(doc);
  const sources = doc.sources || [];
  const set = (key, value, kinds = []) => {
    if (!value || !String(value).trim()) return;
    const v = String(value).trim();
    const sourceId = matchSourceId(sources, v, kinds);
    rec.fields[key] = {
      ...rec.fields[key],
      value: v,
      confidence: "high",
      sourceUrl: doc.url,
      sourceSnippet: v,
      ...(sourceId ? { sourceId } : {}),
    };
  };
  const FIELD_KINDS = {
    company_name: ["heading"],
    legal_name: ["heading"],
    email: ["email"],
    phone: ["phone"],
    address: ["heading"],
  };
  for (const key of FIELD_KEYS) set(key, data[key], FIELD_KINDS[key] || []);
  const named = Array.isArray(data.executives)
    ? data.executives.filter((e) => e?.name && String(e.name).trim())
    : [];
  if (named.length) {
    rec.executives = named.map((e) => {
      const name = String(e.name).trim();
      const role = String(e.role || "").trim();
      const sourceId =
        matchSourceId(sources, name, ["person"]) ||
        matchSourceId(sources, `${name} ${role}`.trim(), ["person"]);
      return {
        id: crypto.randomUUID(),
        name,
        role,
        email: String(e.email || "").trim(),
        linkedin: String(e.linkedin || "").trim(),
        xing: String(e.xing || "").trim(),
        wechat: String(e.wechat || "").trim(),
        confidence: "high",
        sourceUrl: doc.url,
        dirty: false,
        verified: false,
        ...(sourceId ? { sourceId } : {}),
      };
    });
  }
  if (data.language) rec.language = data.language;
  rec.complete = Boolean(
    rec.fields.company_name.value && rec.executives.length,
  );
  return rec;
}

/** Pull a JSON object out of fences, preamble, or a raw string. */
export function parseModelJson(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  const candidates = [];
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) candidates.push(fence[1].trim());
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1));
  candidates.push(text);
  for (const c of candidates) {
    try {
      const v = JSON.parse(c);
      if (v && typeof v === "object" && !Array.isArray(v)) return v;
    } catch {
      /* try next */
    }
  }
  return null;
}

async function readPromptOutput(raw) {
  if (raw == null) return "";
  if (typeof raw === "string") return raw;
  if (typeof raw[Symbol.asyncIterator] === "function") {
    let s = "";
    for await (const chunk of raw) {
      if (typeof chunk === "string") s += chunk;
      else if (chunk && typeof chunk === "object") {
        s += chunk.content || chunk.text || chunk.output || "";
      }
    }
    return s;
  }
  if (typeof raw.text === "function") return String(await raw.text());
  if (typeof raw.output === "string") return raw.output;
  if (typeof raw.content === "string") return raw.content;
  return "";
}

function budgetChars(session) {
  const window = Number(session?.inputQuota ?? session?.contextWindow ?? 0);
  const used = Number(session?.contextUsage ?? 0);
  if (window > 0) {
    const tokens = Math.max(256, window - (Number.isFinite(used) ? used : 0) - 512);
    return tokens * 4;
  }
  return TOKEN_LIMIT * 4;
}

async function callPrompt(session, prompt, options) {
  if (typeof session.prompt !== "function") {
    if (typeof session.promptStreaming === "function") {
      return session.promptStreaming(prompt, options);
    }
    throw new Error("no-prompt");
  }
  try {
    return await session.prompt(prompt, options);
  } catch (err) {
    if (err?.name === "QuotaExceededError") throw err;
    try {
      return await session.prompt([{ role: "user", content: prompt }], options);
    } catch {
      throw err;
    }
  }
}

async function inferOne(doc, session) {
  if (!session) {
    return {
      record: extractFromMarkdown(doc),
      engine: "heuristic",
      nanoError: "no-session",
    };
  }
  const limit = budgetChars(session);
  const body = String(doc.markdown || "").slice(0, limit);
  const prompt = `${SCHEMA_PROMPT}\n\nURL: ${doc.url}\nLanguage: ${doc.lang}\n\n${body}`;
  const optionSets = [
    { responseConstraint: COMPANY_JSON_SCHEMA },
    { responseConstraint: COMPANY_JSON_SCHEMA, omitResponseConstraintInput: true },
    {},
  ];

  let lastError = "prompt-failed";
  for (const options of optionSets) {
    try {
      const raw = await callPrompt(session, prompt, options);
      const text = await readPromptOutput(raw);
      const json = parseModelJson(text);
      if (!json) {
        lastError = "invalid-json";
        continue;
      }
      const checked = validateCompanyPayload(json);
      if (!checked.ok) {
        lastError = checked.reason || "schema";
        continue;
      }
      return { record: applyJson(doc, checked.payload), engine: "nano" };
    } catch (err) {
      lastError = err?.name || err?.message || "prompt-failed";
      if (lastError === "QuotaExceededError") {
        try {
          const shorter = `${SCHEMA_PROMPT}\n\nURL: ${doc.url}\n\n${body.slice(0, Math.floor(limit / 3))}`;
          const raw = await callPrompt(session, shorter, {});
          const text = await readPromptOutput(raw);
          const json = parseModelJson(text);
          const checked = json ? validateCompanyPayload(json) : { ok: false };
          if (checked.ok) {
            return { record: applyJson(doc, checked.payload), engine: "nano" };
          }
        } catch {
          /* keep lastError */
        }
      }
    }
  }
  return {
    record: extractFromMarkdown(doc),
    engine: "heuristic",
    nanoError: lastError,
  };
}

/**
 * @param {object} doc
 * @param {{ onProgress?: (loaded: number) => void }} [opts]
 */
export async function inferDocument(doc, opts = {}) {
  const chunks = chunkMarkdown(doc.markdown || "");
  const session = await getLanguageModel(opts.onProgress);
  try {
    if (chunks.length <= 1) {
      return inferOne(
        { ...doc, markdown: chunks[0] || doc.markdown || "" },
        session,
      );
    }
    let record = emptyRecord(doc.url, doc.lang);
    record.pagesVisited = [];
    let engine = "heuristic";
    let nanoError;
    for (const markdown of chunks) {
      const part = await inferOne({ ...doc, markdown }, session);
      if (part.engine === "nano") engine = "nano";
      else if (part.nanoError) nanoError = part.nanoError;
      const { merged } = mergeRecords(record, part.record);
      record = merged;
    }
    return { record, engine, chunks: chunks.length, nanoError };
  } finally {
    session?.destroy?.();
  }
}

/** @deprecated Prefer probeNano(); kept for callers that expect a boolean. */
export async function nanoAvailable() {
  const { status } = await probeNano();
  return (
    status === "available" ||
    status === "downloadable" ||
    status === "downloading"
  );
}
