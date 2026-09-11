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
import { validateCompanyPayload } from "./schema.js";

/** Options shared by availability() and create() — keep minimal so more devices qualify. */
const MODEL_OPTIONS = {
  expectedInputs: [{ type: "text", languages: ["en"] }],
  expectedOutputs: [{ type: "text", languages: ["en"] }],
};

function getLM() {
  return globalThis.LanguageModel || globalThis.ai?.languageModel || null;
}

/**
 * Probe Prompt API / Gemini Nano without starting a download.
 * @returns {Promise<{ status: string, api: boolean }>}
 *   status: missing-api | unavailable | downloadable | downloading | available | unknown
 */
export async function probeNano() {
  const LM = getLM();
  if (!LM) return { status: "missing-api", api: false };
  try {
    if (typeof LM.availability !== "function") {
      return { status: "unknown", api: true };
    }
    const a = await LM.availability(MODEL_OPTIONS);
    const status = typeof a === "string" ? a : "unknown";
    return { status, api: true };
  } catch {
    return { status: "unavailable", api: true };
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
      status = await LM.availability(MODEL_OPTIONS);
    }
    if (status === "unavailable") return null;

    const createOpts = {
      temperature: 0.2,
      topK: 8,
      ...MODEL_OPTIONS,
      monitor(m) {
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
      },
    };

    if (typeof onProgress === "function" && status === "downloadable") {
      onProgress(0);
    }
    if (typeof onProgress === "function" && status === "downloading") {
      onProgress(0.01);
    }

    const session = await LM.create(createOpts);
    if (typeof onProgress === "function") onProgress(1);
    return session || null;
  } catch {
    return null;
  }
}

/**
 * Ensure the on-device model is present (download if needed). Safe to call from
 * a user-gesture handler in the side panel so Chrome allows the first download.
 * @param {(evt: { status: string, loaded?: number }) => void} [onEvent]
 */
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
  if (Array.isArray(data.executives)) {
    rec.executives = data.executives
      .filter((e) => e?.name)
      .map((e) => {
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

async function inferOne(doc, session) {
  if (!session) {
    return { record: extractFromMarkdown(doc), engine: "heuristic" };
  }
  try {
    const prompt = `${SCHEMA_PROMPT}\n\nURL: ${doc.url}\nLanguage: ${doc.lang}\n\n${doc.markdown.slice(0, TOKEN_LIMIT * 4)}`;
    const raw =
      typeof session.prompt === "function"
        ? await session.prompt(prompt)
        : await session.promptStreaming?.(prompt);
    const text = typeof raw === "string" ? raw : String(raw || "");
    const json = JSON.parse(text.replace(/^```json\s*|\s*```$/g, "").trim());
    const checked = validateCompanyPayload(json);
    if (!checked.ok) {
      return { record: extractFromMarkdown(doc), engine: "heuristic" };
    }
    return { record: applyJson(doc, checked.payload), engine: "nano" };
  } catch {
    return { record: extractFromMarkdown(doc), engine: "heuristic" };
  }
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
    for (const markdown of chunks) {
      const part = await inferOne({ ...doc, markdown }, session);
      if (part.engine === "nano") engine = "nano";
      const { merged } = mergeRecords(record, part.record);
      record = merged;
    }
    return { record, engine, chunks: chunks.length };
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
