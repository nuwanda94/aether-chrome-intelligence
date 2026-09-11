import { test } from "node:test";
import assert from "node:assert/strict";
import { runHarness, MAX_PAGES, SCORE_THRESHOLD } from "../lib/harness.js";
import { extractFromMarkdown } from "../lib/engine.js";

const SPARSE = `# Loop Corp

A one-line homepage with no address or officers.
`;

function sparseDoc(url, extraLinks = []) {
  const links = [
    { href: "https://loop.example/leadership", text: "Leadership team" },
    { href: "https://loop.example/team", text: "Our team" },
    { href: "https://loop.example/about", text: "About us" },
    { href: "https://loop.example/impressum", text: "Impressum" },
    { href: "https://loop.example/vorstand", text: "Vorstand" },
    { href: "https://loop.example/management", text: "Management" },
    { href: "https://loop.example/directors", text: "Board of directors" },
    ...extraLinks,
  ];
  return {
    url,
    title: "Loop Corp",
    lang: "en",
    markdown: SPARSE,
    links,
  };
}

test("cache short-circuit never calls fetchPage", async () => {
  let fetches = 0;
  const cached = {
    fields: { company_name: { value: "Cached Co" } },
    executives: [],
    complete: false,
  };
  const result = await runHarness({
    startDoc: sparseDoc("https://loop.example/"),
    fetchPage: async () => {
      fetches += 1;
      return sparseDoc("https://loop.example/fetched");
    },
    cached,
  });
  assert.equal(fetches, 0);
  assert.equal(result.engine, "cache");
  assert.equal(result.record.cacheHit, true);
  assert.equal(result.record.fields.company_name.value, "Cached Co");
});

test("score threshold skips blog/product links", async () => {
  const fetched = [];
  const startDoc = {
    url: "https://loop.example/",
    title: "Loop",
    lang: "en",
    markdown: SPARSE,
    links: [
      { href: "https://loop.example/blog", text: "Blog" },
      { href: "https://loop.example/products", text: "Products" },
      { href: "https://loop.example/careers", text: "Careers" },
    ],
  };
  await runHarness({
    startDoc,
    fetchPage: async (href) => {
      fetched.push(href);
      return sparseDoc(href);
    },
  });
  assert.deepEqual(fetched, []);
  assert.ok(SCORE_THRESHOLD >= 0.7);
});

test("visited-url registry does not refetch the start URL or duplicates", async () => {
  const fetched = [];
  const start = "https://loop.example/";
  const startDoc = sparseDoc(start, [
    { href: start, text: "Leadership home" },
    { href: "https://loop.example/leadership", text: "Leadership team" },
    { href: "https://loop.example/leadership", text: "Team again" },
  ]);
  await runHarness({
    startDoc,
    fetchPage: async (href) => {
      fetched.push(href);
      return sparseDoc(href);
    },
  });
  assert.equal(fetched.includes(start), false);
  const unique = new Set(fetched);
  assert.equal(unique.size, fetched.length);
});

test("looping link graph cannot exceed MAX_PAGES", async () => {
  const fetched = [];
  const start = "https://loop.example/";
  await runHarness({
    startDoc: sparseDoc(start),
    fetchPage: async (href) => {
      fetched.push(href);
      return sparseDoc(href);
    },
  });
  const pagesTouched = 1 + fetched.length;
  assert.ok(pagesTouched <= MAX_PAGES, `touched ${pagesTouched} > MAX_PAGES ${MAX_PAGES}`);
  assert.ok(fetched.length <= MAX_PAGES - 1);
  assert.equal(MAX_PAGES, 4);
});

test("custom infer is used for primary and second-pass pages", async () => {
  const inferred = [];
  const start = "https://loop.example/";
  await runHarness({
    startDoc: sparseDoc(start),
    fetchPage: async (href) => sparseDoc(href),
    infer: async (doc) => {
      inferred.push(doc.url);
      return { record: extractFromMarkdown(doc), engine: "offscreen" };
    },
  });
  assert.ok(inferred.includes(start), "primary pass uses infer");
  assert.ok(inferred.length >= 2, "heal pages also use infer");
  assert.equal(inferred[0], start);
});

test("heal-page links are scored so About can discover /leadership", async () => {
  const fetched = [];
  const startDoc = {
    url: "https://loop.example/",
    title: "Loop",
    lang: "en",
    markdown: SPARSE,
    links: [{ href: "https://loop.example/about", text: "About us" }],
  };
  const aboutDoc = {
    url: "https://loop.example/about",
    title: "About",
    lang: "en",
    markdown: SPARSE,
    links: [{ href: "https://loop.example/leadership", text: "Leadership team" }],
  };
  const leadMd = `# Leadership

- **Ada Lovelace** — Chief Executive Officer — ada@loop.example
`;
  const leadDoc = {
    url: "https://loop.example/leadership",
    title: "Leadership",
    lang: "en",
    markdown: leadMd,
    links: [],
  };

  await runHarness({
    startDoc,
    fetchPage: async (href) => {
      fetched.push(href);
      if (href.includes("/about")) return aboutDoc;
      if (href.includes("/leadership")) return leadDoc;
      return { url: href, title: "", lang: "en", markdown: SPARSE, links: [] };
    },
  });

  assert.ok(fetched.includes("https://loop.example/about"), "fetches About from homepage");
  assert.ok(
    fetched.includes("https://loop.example/leadership"),
    "discovers /leadership from About page links",
  );
  assert.ok(fetched.length <= MAX_PAGES - 1);
});
