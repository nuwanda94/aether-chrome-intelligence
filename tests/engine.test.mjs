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
  toTargetSchema,
  recordToTargetJson,
} from "../lib/engine.js";
import { inferDocument, applyJson, parseModelJson, probeNano, normalizeAvailability } from "../lib/nano.js";
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

test("validateCompanyPayload rejects non-objects, coerces loose field types", () => {
  assert.equal(validateCompanyPayload(null).ok, false);
  assert.equal(validateCompanyPayload("nope").ok, false);
  const num = validateCompanyPayload({ company_name: 12, email: null });
  assert.equal(num.ok, true);
  assert.equal(num.payload.company_name, "12");
  assert.equal(num.payload.email, "");
  const execObj = validateCompanyPayload({ executives: { name: "Pat" } });
  assert.equal(execObj.ok, true);
  assert.equal(execObj.payload.executives.length, 0);
  const execEmail = validateCompanyPayload({
    executives: [{ name: "Pat", email: ["x"] }],
  });
  assert.equal(execEmail.ok, true);
  assert.equal(execEmail.payload.executives[0].name, "Pat");
  assert.equal(execEmail.payload.executives[0].email, "");
});

test("applyJson overlays Nano fields; ready session is used even with coerced JSON", async () => {
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
      prompt: async () =>
        JSON.stringify({ company_name: 404, email: null, executives: "nope" }),
      destroy() {},
    }),
  };
  try {
    const { record, engine } = await inferDocument(EN_DOC);
    assert.equal(engine, "nano");
    assert.equal(record.fields.company_name.value, "404");
    assert.equal(record.executives[0].name, "Jane Doe");
  } finally {
    if (prev === undefined) delete globalThis.LanguageModel;
    else globalThis.LanguageModel = prev;
  }
});

test("parseModelJson accepts fenced JSON and preamble", () => {
  const obj = { company_name: "Acme", executives: [{ name: "Ada", role: "CTO" }] };
  assert.equal(parseModelJson(JSON.stringify(obj)).company_name, "Acme");
  const fenced = "Here you go:\n```json\n" + JSON.stringify(obj) + "\n```\n";
  assert.equal(parseModelJson(fenced).company_name, "Acme");
  assert.equal(parseModelJson("not json at all"), null);
});

test("inferDocument uses Nano when availability is ready and JSON is fenced", async () => {
  const prev = globalThis.LanguageModel;
  globalThis.LanguageModel = {
    availability: async () => "readily",
    create: async () => ({
      prompt: async () =>
        "```json\n" +
        JSON.stringify({
          company_name: "Nano Co",
          executives: [{ name: "Ada Lovelace", role: "CTO" }],
        }) +
        "\n```",
      destroy() {},
    }),
  };
  try {
    assert.equal(normalizeAvailability("readily"), "available");
    const probe = await probeNano();
    assert.equal(probe.status, "available");
    const { record, engine } = await inferDocument(EN_DOC);
    assert.equal(engine, "nano");
    assert.equal(record.fields.company_name.value, "Nano Co");
    assert.equal(record.executives[0].name, "Ada Lovelace");
  } finally {
    if (prev === undefined) delete globalThis.LanguageModel;
    else globalThis.LanguageModel = prev;
  }
});

test("inferDocument consumes async iterable prompt output", async () => {
  const prev = globalThis.LanguageModel;
  const payload = JSON.stringify({
    company_name: "Stream Co",
    executives: [{ name: "Pat Stream", role: "CEO" }],
  });
  globalThis.LanguageModel = {
    availability: async () => "available",
    create: async () => ({
      prompt: async () =>
        (async function* () {
          yield payload.slice(0, 12);
          yield payload.slice(12);
        })(),
      destroy() {},
    }),
  };
  try {
    const { record, engine } = await inferDocument(EN_DOC);
    assert.equal(engine, "nano");
    assert.equal(record.fields.company_name.value, "Stream Co");
    assert.equal(record.executives[0].name, "Pat Stream");
  } finally {
    if (prev === undefined) delete globalThis.LanguageModel;
    else globalThis.LanguageModel = prev;
  }
});

test("inferDocument falls back only when the model output is unusable", async () => {
  const prev = globalThis.LanguageModel;
  globalThis.LanguageModel = {
    availability: async () => "available",
    create: async () => ({
      prompt: async () => "I cannot extract that.",
      destroy() {},
    }),
  };
  try {
    const { record, engine, nanoError } = await inferDocument(EN_DOC);
    assert.equal(engine, "heuristic");
    assert.equal(nanoError, "invalid-json");
    assert.equal(record.fields.company_name.value, "Acme Corp");
  } finally {
    if (prev === undefined) delete globalThis.LanguageModel;
    else globalThis.LanguageModel = prev;
  }
});

test("extractExecs accepts plain Name — Role without markdown bold", () => {
  const rec = extractFromMarkdown({
    url: "https://acme.example/team",
    title: "Team",
    lang: "en",
    markdown: `# Leadership

Jane Doe — Chief Executive Officer
Pat Lee — Head of Engineering
`,
  });
  assert.equal(rec.executives.length, 2);
  assert.equal(rec.executives[0].name, "Jane Doe");
  assert.equal(rec.executives[0].role, "Chief Executive Officer");
  assert.equal(rec.executives[1].name, "Pat Lee");
  assert.match(rec.executives[1].role, /Head of Engineering/);
});

test("extractExecs accepts Name, Title lines when title is a role", () => {
  const rec = extractFromMarkdown({
    url: "https://acme.example/people",
    title: "People",
    lang: "en",
    markdown: `# People

Morgan Blake, Chief Financial Officer
Alex Rivera, Vice President
`,
  });
  assert.ok(rec.executives.some((e) => e.name === "Morgan Blake" && /Chief Financial Officer/.test(e.role)));
  assert.ok(rec.executives.some((e) => e.name === "Alex Rivera" && /Vice President/.test(e.role)));
});

test("extractExecs accepts DE/JP role tokens without bold markers", () => {
  const de = extractFromMarkdown({
    url: "https://beispiel.de/vorstand",
    title: "Vorstand",
    lang: "de",
    markdown: `# Vorstand

Anna Schmidt — Geschäftsführerin
`,
  });
  assert.equal(de.executives[0].name, "Anna Schmidt");
  assert.match(de.executives[0].role, /Geschäftsführerin/);

  const jp = extractFromMarkdown({
    url: "https://example.co.jp/officers",
    title: "役員",
    lang: "ja",
    markdown: `# 役員

山田 太郎 — 代表取締役社長
`,
  });
  assert.equal(jp.executives[0].name, "山田 太郎");
  assert.equal(jp.executives[0].role, "代表取締役社長");
});

test("getLanguageModel handles InvalidStateError with retry and monitors download progress", async () => {
  const prev = globalThis.LanguageModel;
  let attempts = 0;
  const progressEvents = [];

  globalThis.LanguageModel = {
    availability: async () => "downloadable",
    create: async (opts) => {
      attempts++;
      if (opts?.monitor) {
        let listener;
        opts.monitor({
          addEventListener: (evt, cb) => {
            if (evt === "downloadprogress") listener = cb;
          },
        });
        if (listener) {
          listener({ loaded: 50, total: 100 });
        }
      }
      if (attempts === 1) {
        const err = new Error("Model daemon initializing");
        err.name = "InvalidStateError";
        throw err;
      }
      return {
        prompt: async () => JSON.stringify({ company_name: "Recovered Inc" }),
        destroy() {},
      };
    },
  };

  try {
    const { getLanguageModel } = await import("../lib/nano.js");
    const session = await getLanguageModel((pct) => progressEvents.push(pct));
    assert.ok(session);
    assert.ok(attempts > 1, "Should have retried after InvalidStateError");
    assert.ok(progressEvents.includes(0.5), "Should record 50% download progress");
  } finally {
    if (prev === undefined) delete globalThis.LanguageModel;
    else globalThis.LanguageModel = prev;
  }
});

test("validateCompanyPayload filters UI/nav items and feature bullets from executives and parses social object", () => {
  const res = validateCompanyPayload({
    company_name: "CloudTech Inc",
    social: {
      linkedin: "https://linkedin.com/company/cloudtech",
      xing: "https://xing.com/pages/cloudtech",
    },
    executives: [
      { name: "Products", role: "Navigation" },
      { name: "Solutions", role: "Menu" },
      { name: "Automated multi-currency payment processing", role: "Feature" },
      { name: "40% gain in operational efficiency", role: "Metric" },
      { name: "Careers", role: "Footer" },
      { name: "Sarah Connor", role: "Chief Executive Officer" },
      { name: "John Doe", role: "VP of Engineering" },
    ],
  });

  assert.equal(res.ok, true);
  assert.equal(res.payload.linkedin, "https://linkedin.com/company/cloudtech");
  assert.equal(res.payload.xing, "https://xing.com/pages/cloudtech");
  assert.equal(res.payload.executives.length, 2);
  assert.equal(res.payload.executives[0].name, "Sarah Connor");
  assert.equal(res.payload.executives[0].role, "Chief Executive Officer");
  assert.equal(res.payload.executives[1].name, "John Doe");
  assert.equal(res.payload.executives[1].role, "VP of Engineering");
});

test("scoreLinks prioritizes high-value paths (/contact, /about, /locations, /team, /company) and ignores traps", () => {
  const links = [
    { href: "https://acme.example/blog/how-to-scale-sensors", text: "Read our latest blog" },
    { href: "https://acme.example/privacy-policy", text: "Privacy Policy" },
    { href: "https://acme.example/terms-of-service", text: "Terms of Service" },
    { href: "https://acme.example/cart", text: "Shopping Cart" },
    { href: "https://acme.example/locations", text: "Global Offices & Locations" },
    { href: "https://acme.example/company", text: "Company Overview" },
    { href: "https://acme.example/team", text: "Executive Team" },
    { href: "https://acme.example/contact", text: "Contact Us" },
    { href: "https://acme.example/about", text: "About Us" },
  ];

  const scored = scoreLinks(links, "https://acme.example/");
  
  // High-value paths should score >= 0.7
  const highValueHrefs = [
    "https://acme.example/team",
    "https://acme.example/locations",
    "https://acme.example/company",
    "https://acme.example/about",
    "https://acme.example/contact",
  ];
  for (const href of highValueHrefs) {
    const item = scored.find((s) => s.href === href);
    assert.ok(item, `Link ${href} should be scored`);
    assert.ok(item.score >= 0.7, `Link ${href} score should be >= 0.7, got ${item.score}`);
  }

  // Traps should be classified as trap/ignored with score <= 0.05
  const trapHrefs = [
    "https://acme.example/blog/how-to-scale-sensors",
    "https://acme.example/privacy-policy",
    "https://acme.example/terms-of-service",
    "https://acme.example/cart",
  ];
  for (const href of trapHrefs) {
    const item = scored.find((s) => s.href === href);
    assert.ok(item, `Trap link ${href} should be found`);
    assert.ok(item.score <= 0.05, `Trap ${href} score should be <= 0.05, got ${item.score}`);
    assert.ok(item.reason.includes("trap"), `Trap ${href} reason should mention trap`);
  }
});

test("extractFromMarkdown extracts multiple phone numbers and multiple addresses", () => {
  const multiDoc = {
    url: "https://acme.example/contact",
    title: "Acme Corp | Contact & Locations",
    lang: "en",
    markdown: `# Acme Global

Acme Global delivers high-precision optical sensors and embedded software platforms for industrial robotics worldwide.

Headquarters: 100 Market Street, Suite 400, San Francisco, CA 94105
European Office: Friedrichstraße 45, 10117 Berlin, Germany
APAC Headquarters: 1-1-1 Marunouchi, Chiyoda-ku, Tokyo 100-0005, Japan

Toll-Free Support: +1 800-555-0199
US Office Phone: +1 415-555-0122
EU Direct Line: +49 30 98765432
General Inquiries: info@acmeworks.example

- **Elena Rostova** — Chief Executive Officer
- **David Chen** — Head of Hardware Engineering
`,
  };

  const rec = extractFromMarkdown(multiDoc);

  assert.ok(Array.isArray(rec.addresses), "rec.addresses should be an array");
  assert.ok(rec.addresses.length >= 3, `Expected at least 3 addresses, got ${rec.addresses.length}`);
  assert.ok(rec.addresses.some((a) => a.includes("Market Street")));
  assert.ok(rec.addresses.some((a) => a.includes("Berlin") || a.includes("Friedrichstraße")));
  assert.ok(rec.addresses.some((a) => a.includes("Tokyo") || a.includes("Marunouchi")));

  assert.ok(Array.isArray(rec.phone_numbers), "rec.phone_numbers should be an array");
  assert.ok(rec.phone_numbers.length >= 3, `Expected at least 3 phone numbers, got ${rec.phone_numbers.length}`);
  assert.ok(rec.phone_numbers.some((p) => p.includes("800")));
  assert.ok(rec.phone_numbers.some((p) => p.includes("415")));
  assert.ok(rec.phone_numbers.some((p) => p.includes("49 30")));

  // Synthesized description
  assert.ok(rec.fields.description.value.includes("optical sensors"));
  assert.equal(rec.executives.length, 2);
});

test("mergeRecords combines multi-value addresses and phone numbers across pages without duplicates", () => {
  const page1 = extractFromMarkdown({
    url: "https://acme.example/",
    title: "Acme Corp",
    lang: "en",
    markdown: `# Acme Corp\n\nCloud infrastructure automation tools.\n\nAddress: 100 Market Street, San Francisco, CA\nPhone: +1 415-555-0100\nEmail: contact@acme.example\n`,
  });

  const page2 = extractFromMarkdown({
    url: "https://acme.example/locations",
    title: "Acme Corp - Locations",
    lang: "en",
    markdown: `# Locations\n\nRegional Office: 200 Broadway, New York, NY 10038\nSecondary Phone: +1 212-555-0199\n`,
  });

  const { merged } = mergeRecords(page1, page2);

  assert.equal(merged.addresses.length, 2);
  assert.ok(merged.addresses[0].includes("Market Street"));
  assert.ok(merged.addresses[1].includes("Broadway"));

  assert.equal(merged.phone_numbers.length, 2);
  assert.ok(merged.phone_numbers[0].includes("415"));
  assert.ok(merged.phone_numbers[1].includes("212"));
});

test("toTargetSchema formats extracted data strictly adhering to target output schema", () => {
  const doc = {
    url: "https://zenith.example/",
    title: "Zenith Robotics",
    lang: "en",
    markdown: `# Zenith Robotics

Zenith Robotics designs autonomous warehouse rovers and fleet management systems.

Primary Address: 500 Technology Way, Austin, TX 78701
Regional Office: 12 King Street, London EC2V 8AU, UK

Phone: +1 512-555-0144
Support Phone: +1 888-555-0199
Email: inquiries@zenith.example

- **Alex Rivera** — Chief Executive Officer
- **Maya Patel** — Chief Technology Officer
`,
  };

  const rec = extractFromMarkdown(doc);
  const target = toTargetSchema(rec);

  assert.deepEqual(Object.keys(target).sort(), [
    "addresses",
    "company_name",
    "description",
    "email",
    "executives",
    "industry",
    "phone_numbers",
    "website",
  ].sort());

  assert.equal(target.company_name, "Zenith Robotics");
  assert.ok(target.description.includes("autonomous warehouse rovers"));
  assert.ok(Array.isArray(target.addresses) && target.addresses.length >= 2);
  assert.ok(Array.isArray(target.phone_numbers) && target.phone_numbers.length >= 2);
  assert.equal(target.email, "inquiries@zenith.example");
  assert.equal(target.website, "https://zenith.example");
  assert.equal(target.executives.length, 2);
  assert.equal(target.executives[0].name, "Alex Rivera");
  assert.equal(target.executives[0].role, "Chief Executive Officer");

  const targetJson = recordToTargetJson(rec);
  const parsed = JSON.parse(targetJson);
  assert.equal(parsed.company_name, "Zenith Robotics");
  assert.ok(Array.isArray(parsed.addresses));
  assert.ok(Array.isArray(parsed.phone_numbers));
});

test("validateCompanyPayload validates and sanitizes multi-value addresses and phone numbers", () => {
  const valid = validateCompanyPayload({
    company_name: "Apex Global",
    industry: "Enterprise Software",
    description: "Cloud security and identity management platform.",
    addresses: [
      "100 First St, Seattle, WA 98104",
      "  ",
      "250 Queen St, Melbourne VIC 3000  ",
    ],
    phone_numbers: [
      "+1 206-555-0123",
      "+61 3 9000 0000",
    ],
    email: "contact@apex.example",
    website: "https://apex.example",
    executives: [
      { name: "Rachel Adams", role: "Chief Security Officer" },
    ],
  });

  assert.equal(valid.ok, true);
  assert.deepEqual(valid.payload.addresses, [
    "100 First St, Seattle, WA 98104",
    "250 Queen St, Melbourne VIC 3000",
  ]);
  assert.deepEqual(valid.payload.phone_numbers, [
    "+1 206-555-0123",
    "+61 3 9000 0000",
  ]);
  assert.equal(valid.payload.executives.length, 1);
});

