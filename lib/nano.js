import { SCHEMA_PROMPT, extractFromMarkdown, emptyRecord, FIELD_KEYS } from "./engine.js";

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

function applyJson(doc, data) {
  const rec = extractFromMarkdown(doc);
  const set = (key, value) => {
    if (!value || !String(value).trim()) return;
    rec.fields[key] = {
      ...rec.fields[key],
      value: String(value).trim(),
      confidence: "high",
      sourceUrl: doc.url,
    };
  };
  for (const key of FIELD_KEYS) set(key, data[key]);
  if (Array.isArray(data.executives)) {
    rec.executives = data.executives
      .filter((e) => e?.name)
      .map((e) => ({
        id: crypto.randomUUID(),
        name: String(e.name).trim(),
        role: String(e.role || "").trim(),
        email: String(e.email || "").trim(),
        linkedin: String(e.linkedin || "").trim(),
        xing: String(e.xing || "").trim(),
        wechat: String(e.wechat || "").trim(),
        confidence: "high",
        sourceUrl: doc.url,
        dirty: false,
        verified: false,
      }));
  }
  if (data.language) rec.language = data.language;
  rec.complete = Boolean(
    rec.fields.company_name.value && rec.executives.length,
  );
  return rec;
}

export async function inferDocument(doc) {
  const session = await getLanguageModel();
  if (!session) {
    return { record: extractFromMarkdown(doc), engine: "heuristic" };
  }
  try {
    const prompt = `${SCHEMA_PROMPT}\n\nURL: ${doc.url}\nLanguage: ${doc.lang}\n\n${doc.markdown.slice(0, 8000)}`;
    const raw =
      typeof session.prompt === "function"
        ? await session.prompt(prompt)
        : await session.promptStreaming?.(prompt);
    const text = typeof raw === "string" ? raw : String(raw || "");
    const json = JSON.parse(text.replace(/^```json\s*|\s*```$/g, "").trim());
    session.destroy?.();
    return { record: applyJson(doc, json), engine: "nano" };
  } catch {
    session?.destroy?.();
    return { record: extractFromMarkdown(doc), engine: "heuristic" };
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
