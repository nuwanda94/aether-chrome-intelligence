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

async function getLanguageModel() {
  const LM = globalThis.LanguageModel || globalThis.ai?.languageModel;
  if (!LM) return null;
  try {
    if (typeof LM.availability === "function") {
      const a = await LM.availability();
      if (a !== "available" && a !== "downloadable") return null;
    }
    if (typeof LM.create === "function") {
      return await LM.create({
        temperature: 0.2,
        topK: 8,
        expectedInputs: [{ type: "text", languages: ["en", "de", "ja", "es"] }],
      });
    }
  } catch {
    return null;
  }
  return null;
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

export async function inferDocument(doc) {
  const chunks = chunkMarkdown(doc.markdown || "");
  const session = await getLanguageModel();
  try {
    if (chunks.length <= 1) {
      return inferOne({ ...doc, markdown: chunks[0] || doc.markdown || "" }, session);
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

export async function nanoAvailable() {
  try {
    const LM = globalThis.LanguageModel || globalThis.ai?.languageModel;
    if (!LM?.availability) return false;
    const a = await LM.availability();
    return a === "available" || a === "downloadable";
  } catch {
    return false;
  }
}
