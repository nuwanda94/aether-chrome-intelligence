import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractFromMarkdown,
  scoreLinks,
  mergeRecords,
  maskValue,
  isComplete,
  emptyRecord,
  chunkMarkdown,
  estimateTokens,
  TOKEN_LIMIT,
  matchSourceId,
} from "../lib/engine.js";
import { inferDocument, applyJson } from "../lib/nano.js";
import { validateCompanyPayload } from "../lib/schema.js";

const EN_DOC = {
  url: "https://acme.example/",
  title: "Acme Corp | Home",
  lang: "en",
  markdown: `# Acme Corp

Acme Corp builds industrial sensors for global manufacturers and ships from three continents.

Address: 100 Market Street, San Francisco, CA 94105
Contact press@acme.example or +1 415-555-0199
[Leadership](/leadership) [About](/about)

- **Jane Doe** — Chief Executive Officer — jane.doe@acme.example
`,
};

const JP_DOC = {
  url: "https://example.co.jp/",
  title: "株式会社アether | 会社概要",
  lang: "ja",
  markdown: `# 株式会社アether

東京都千代田区丸の内1-1-1 〒100-0005 に本社を置くソフトウェア企業です。製品は日本語のまま記録します。

お問い合わせ: info@example.co.jp
[会社概要](/about) [役員](/leadership)

- **山田 太郎** — 代表取締役社長 — taro@example.co.jp
`,
};

const DE_DOC = {
  url: "https://beispiel.de/",
  title: "Beispiel GmbH — Über uns",
  lang: "de",
  markdown: `# Beispiel GmbH

Beispiel GmbH entwickelt Messsysteme für die Industrie und hat den Sitz in München.

10115 Berlin, Friedrichstraße 1
Impressum: hallo@beispiel.de
Telefon +49 30 12345678
[Vorstand](/vorstand) [Über uns](/ueber-uns)

- **Anna Schmidt** — Geschäftsführerin — anna@beispiel.de
`,
};

test("extractFromMarkdown fills EN company, contact, and executives", () => {
  const rec = extractFromMarkdown(EN_DOC);
  assert.equal(rec.fields.company_name.value, "Acme Corp");
  assert.equal(rec.fields.email.value, "press@acme.example");
  assert.ok(rec.fields.phone.value.includes("415"));
  assert.equal(rec.executives.length, 1);
  assert.equal(rec.executives[0].name, "Jane Doe");
  assert.equal(rec.executives[0].role, "Chief Executive Officer");
  assert.equal(rec.language, "en");
  assert.equal(isComplete(rec), true);
});

test("JP fixture preserves Unicode names and legal form", () => {
  const rec = extractFromMarkdown(JP_DOC);
  assert.equal(rec.language, "ja");
  assert.equal(rec.fields.company_name.value, "株式会社アether");
  assert.equal(rec.fields.legal_name.value, "株式会社アether");
  assert.match(rec.fields.address.value, /〒\s*100-0005|東京都千代田区/);
  assert.equal(rec.fields.email.value, "info@example.co.jp");
  assert.equal(rec.executives[0].name, "山田 太郎");
  assert.equal(rec.executives[0].role, "代表取締役社長");
  assert.equal(isComplete(rec), true);
});

test("DE fixture extracts GmbH, Impressum email, and Geschäftsführerin", () => {
  const rec = extractFromMarkdown(DE_DOC);
  assert.equal(rec.language, "de");
  assert.equal(rec.fields.company_name.value, "Beispiel GmbH");
  assert.equal(rec.fields.legal_name.value, "Beispiel GmbH");
  assert.equal(rec.fields.email.value, "hallo@beispiel.de");
  assert.ok(rec.fields.address.value.includes("Berlin") || rec.fields.address.value.includes("Friedrich"));
  assert.equal(rec.executives[0].name, "Anna Schmidt");
  assert.match(rec.executives[0].role, /Geschäftsführerin/);
  assert.equal(isComplete(rec), true);
});

test("isComplete is false until name, address, email, and an executive exist", () => {
  const rec = emptyRecord("https://sparse.example/");
  assert.equal(isComplete(rec), false);
  rec.fields.company_name.value = "Sparse";
  assert.equal(isComplete(rec), false);
  rec.fields.address.value = "1 Main";
  rec.fields.email.value = "hi@sparse.example";
  assert.equal(isComplete(rec), false);
  rec.executives.push({ name: "Pat", role: "CEO" });
  assert.equal(isComplete(rec), true);
});

test("scoreLinks ranks leadership above about and contact", () => {
  const scored = scoreLinks(
    [
      { href: "/contact", text: "Contact" },
      { href: "/team", text: "Leadership team" },
      { href: "/about", text: "About us" },
      { href: "/blog", text: "Blog" },
    ],
    "https://acme.example/",
  );
  assert.equal(scored[0].href, "https://acme.example/team");
  assert.ok(scored[0].score > scored.find((s) => s.href.endsWith("/about")).score);
  assert.ok(scored.find((s) => s.href.endsWith("/contact")).score > 0.5);
  assert.ok(scored.find((s) => s.href.endsWith("/blog")).score < 0.2);
});

test("mergeRecords reports dirty-field conflicts and keeps the user value", () => {
  const base = extractFromMarkdown(EN_DOC);
  base.fields.email.dirty = true;
  base.fields.email.value = "user-edited@acme.example";

  const patch = extractFromMarkdown({
    ...EN_DOC,
    url: "https://acme.example/contact",
    markdown: `# Acme Corp\n\nother@acme.example\n`,
  });
  patch.fields.email.value = "other@acme.example";
  patch.fields.email.confidence = "high";

  const { merged, conflicts } = mergeRecords(base, patch);
  assert.equal(merged.fields.email.value, "user-edited@acme.example");
  assert.ok(conflicts.some((c) => c.key === "email" && c.incoming === "other@acme.example"));
});

test("mergeRecords fills empty fields and appends new executives", () => {
  const base = extractFromMarkdown({
    url: "https://acme.example/",
    title: "Acme",
    lang: "en",
    markdown: `# Acme\n\nJust a homepage.\n`,
  });
  const patch = extractFromMarkdown(EN_DOC);
  const { merged, conflicts } = mergeRecords(base, patch);
  assert.equal(conflicts.length, 0);
  assert.equal(merged.fields.email.value, "press@acme.example");
  assert.equal(merged.executives.some((e) => e.name === "Jane Doe"), true);
});

test("maskValue is DLP-safe for email and phone", () => {
  assert.equal(maskValue("email", "jane.doe@acme.example"), "j•••@acme.example");
  assert.equal(maskValue("phone", "+1 415-555-0199"), "+• •••-•••-••••");
  assert.equal(maskValue("company_name", "Acme Corp"), "Acme Corp");
  assert.equal(maskValue("email", ""), "");
});

test("chunkMarkdown keeps a single-pass path for small pages", () => {
  const chunks = chunkMarkdown(EN_DOC.markdown);
  assert.equal(chunks.length, 1);
  assert.ok(estimateTokens(EN_DOC.markdown) <= TOKEN_LIMIT);
});

test("20k-word fixture is chunked and map-reduce merges name + executives", async () => {
  const filler = "lorem ipsum dolor sit amet consectetur adipiscing elit. ";
  const wordsNeeded = 20_000;
  const repeats = Math.ceil(wordsNeeded / filler.trim().split(/\s+/).length);
  const body = filler.repeat(repeats);
  const markdown = [
    `# Acme Corp`,
    ``,
    `## Overview`,
    body.slice(0, body.length / 2),
    ``,
    `## History`,
    body.slice(body.length / 2),
    ``,
    `## Leadership`,
    `- **Jane Doe** — Chief Executive Officer — jane.doe@acme.example`,
  ].join("\n");
  assert.ok(markdown.split(/\s+/).length >= 20_000);
  const chunks = chunkMarkdown(markdown);
  assert.ok(chunks.length > 1, `expected multiple chunks, got ${chunks.length}`);
  assert.ok(chunks.every((c) => estimateTokens(c) <= TOKEN_LIMIT + 8));

  const { record, chunks: n } = await inferDocument({
    url: "https://acme.example/long",
    title: "Acme Corp",
    lang: "en",
    markdown,
  });
  assert.ok(n > 1);
  assert.equal(record.fields.company_name.value, "Acme Corp");
  assert.equal(record.executives.some((e) => e.name === "Jane Doe"), true);
});

test("sourceIds attach from doc.sources onto company/email/phone/exec fields", () => {
  const doc = {
    ...EN_DOC,
    sources: [
      { id: "aeth-heading-1", kind: "heading", text: "Acme Corp" },
      { id: "aeth-email-2", kind: "email", text: "press@acme.example" },
      { id: "aeth-phone-3", kind: "phone", text: "+1 415-555-0199" },
      { id: "aeth-person-4", kind: "person", text: "Jane Doe Chief Executive Officer jane.doe@acme.example" },
    ],
  };
  const rec = extractFromMarkdown(doc);
  assert.equal(rec.fields.company_name.sourceId, "aeth-heading-1");
  assert.equal(rec.fields.email.sourceId, "aeth-email-2");
  assert.equal(rec.fields.phone.sourceId, "aeth-phone-3");
  assert.equal(rec.executives[0].sourceId, "aeth-person-4");
  assert.equal(matchSourceId(doc.sources, "Acme Corp", ["heading"]), "aeth-heading-1");
  assert.equal(matchSourceId(doc.sources, "nope", ["heading"]), "");
});

test("validateCompanyPayload accepts known string fields and named executives", () => {
  const checked = validateCompanyPayload({
    company_name: "Acme Corp",
    email: "press@acme.example",
    mystery: 99,
    executives: [
      { name: "Jane Doe", role: "CEO", email: "jane.doe@acme.example" },
      { role: "Ghost" },
      { name: "" },
    ],
  });
  assert.equal(checked.ok, true);
  assert.equal(checked.payload.company_name, "Acme Corp");
  assert.equal("mystery" in checked.payload, false);
  assert.equal(checked.payload.executives.length, 1);
  assert.equal(checked.payload.executives[0].name, "Jane Doe");
});

test("validateCompanyPayload rejects wrong field types", () => {
  assert.equal(validateCompanyPayload(null).ok, false);
  assert.equal(validateCompanyPayload({ company_name: 12 }).ok, false);
  assert.equal(validateCompanyPayload({ executives: { name: "Pat" } }).ok, false);
  assert.equal(validateCompanyPayload({ executives: [{ name: "Pat", email: ["x"] }] }).ok, false);
});

test("applyJson uses validated payload and infer falls back on invalid Nano JSON", async () => {
  const valid = validateCompanyPayload({
    company_name: "Nano Co",
    executives: [{ name: "Ada Lovelace", role: "CTO" }],
  });
  assert.equal(valid.ok, true);
  const rec = applyJson(EN_DOC, valid.payload);
  assert.equal(rec.fields.company_name.value, "Nano Co");
  assert.equal(rec.executives.some((e) => e.name === "Ada Lovelace"), true);

  const prev = globalThis.LanguageModel;
  globalThis.LanguageModel = {
    availability: async () => "available",
    create: async () => ({
      prompt: async () => JSON.stringify({ company_name: 404, executives: "nope" }),
      destroy() {},
    }),
  };
  try {
    const { record, engine } = await inferDocument(EN_DOC);
    assert.equal(engine, "heuristic");
    assert.equal(record.fields.company_name.value, "Acme Corp");
    assert.equal(record.executives[0].name, "Jane Doe");
  } finally {
    if (prev === undefined) delete globalThis.LanguageModel;
    else globalThis.LanguageModel = prev;
  }
});
