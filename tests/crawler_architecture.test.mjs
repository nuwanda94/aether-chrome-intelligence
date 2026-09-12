import test from "node:test";
import assert from "node:assert/strict";

import {
  canonicalizeUrl,
  scoreFrontierLink,
  expandFrontier,
  PATH_TRAP_RE,
} from "../lib/frontier.js";

import {
  deduplicateAddresses,
  deduplicatePhones,
  aggregateEmails,
  classifyEmailDepartment,
} from "../lib/aggregation.js";

import {
  sanitizeExecutive,
  validateCompanyPayload,
  looksLikePersonName,
} from "../lib/validator.js";

import { CrawlerState } from "../lib/crawler-state.js";
import { runHarness } from "../lib/harness.js";

test("Phase 1: URL Canonization normalizes tracking params, query strings, and fragments", () => {
  const origin = "https://example.com";
  
  // Lowercase hostname and trailing slash trimming
  assert.equal(
    canonicalizeUrl("HTTPS://Example.COM/About/", origin),
    "https://example.com/about",
  );

  // Removes fragments and tracking params
  assert.equal(
    canonicalizeUrl("/contact?utm_source=google&fbclid=xyz#top", origin),
    "https://example.com/contact",
  );

  // Strips non-essential query parameters
  assert.equal(
    canonicalizeUrl("/team?session_id=12345", origin),
    "https://example.com/team",
  );

  // Preserves pagination / language queries if relevant
  assert.equal(
    canonicalizeUrl("/locations?lang=en", origin),
    "https://example.com/locations?lang=en",
  );
});

test("Phase 1: URL Canonization rejects asset files and cyclic infinite paths", () => {
  const origin = "https://example.com";

  // Rejects static assets and documents
  assert.equal(canonicalizeUrl("/docs/report.pdf", origin), null);
  assert.equal(canonicalizeUrl("/assets/logo.png", origin), null);
  assert.equal(canonicalizeUrl("/styles/main.css", origin), null);
  assert.equal(canonicalizeUrl("/scripts/bundle.js", origin), null);

  // Cyclic trap detection (same path segment repeated 3+ times)
  assert.equal(
    canonicalizeUrl("/catalog/category/catalog/category/catalog/category", origin),
    null,
  );
});

test("Phase 1: Dynamic Deficit Frontier boosts score for links matching missing fields", () => {
  const origin = "https://example.com";
  const linkContact = { href: "https://example.com/contact-us", text: "Contact Us" };
  const linkTeam = { href: "https://example.com/our-leadership", text: "Executive Leadership" };
  const linkLocations = { href: "https://example.com/global-offices", text: "Offices & Locations" };

  // When executives are missing, leadership link gets boosted score
  const scoreExecsMissing = scoreFrontierLink(linkTeam, ["executives"], origin);
  const scoreExecsNotMissing = scoreFrontierLink(linkTeam, ["phone"], origin);
  assert.ok(scoreExecsMissing > scoreExecsNotMissing);

  // When address is missing, locations link gets boosted score
  const scoreLocMissing = scoreFrontierLink(linkLocations, ["address"], origin);
  assert.ok(scoreLocMissing >= 0.9);

  // When phone or email is missing, contact link is top priority
  const scoreContactMissing = scoreFrontierLink(linkContact, ["phone", "email"], origin);
  assert.ok(scoreContactMissing >= 0.9);
});

test("Phase 1: expandFrontier filters visited links and prioritizes missing field cues", () => {
  const origin = "https://example.com";
  const visited = new Set(["https://example.com", "https://example.com/already-seen"]);
  const candidates = [
    { href: "https://example.com/already-seen", text: "Already Seen" },
    { href: "https://example.com/blog/2024/spring-update", text: "Blog post" },
    { href: "https://example.com/team", text: "Our Team" },
    { href: "https://example.com/contact", text: "Contact Information" },
    { href: "https://example.com/flyer.pdf", text: "Download PDF" },
  ];

  const frontier = expandFrontier(candidates, ["executives"], visited, origin);
  assert.ok(frontier.length >= 2);
  // Team should be top ranked when executives are missing
  assert.equal(frontier[0].href, "https://example.com/team");
  // PDF should be filtered out
  assert.ok(!frontier.some((l) => l.href.endsWith(".pdf")));
  // Already visited should be excluded
  assert.ok(!frontier.some((l) => l.href === "https://example.com/already-seen"));
});

test("Phase 2: Address deduplication merges substrings and normalizes whitespace", () => {
  const existing = [
    "100 Market St, Suite 400, San Francisco, CA 94105",
    "One Apple Park Way, Cupertino, CA",
  ];
  const incoming = [
    "100 Market St, San Francisco, CA 94105", // substring of existing[0]
    "   One Apple Park Way, Cupertino, CA   ", // exact duplicate with whitespace
    "100 Market St, Suite 400, Floor 4, San Francisco, CA 94105, USA", // more complete version
    "10 Downing Street, London, UK", // new distinct address
  ];

  const merged = deduplicateAddresses(existing, incoming);
  assert.equal(merged.length, 3);
  assert.ok(merged.includes("10 Downing Street, London, UK"));
  // Retained the longer/more specific version of 100 Market St
  assert.ok(merged.includes("100 Market St, Suite 400, Floor 4, San Francisco, CA 94105, USA"));
});

test("Phase 2: Phone deduplication compares canonical digit sequences and extensions", () => {
  const existing = ["+1 (415) 555-0199", "030-123456"];
  const incoming = [
    "415.555.0199", // same digits
    "+1 415 555 0199 ext. 102", // extension version
    "+44 20 7946 0991", // new distinct UK number
    "123", // invalid short number (should be skipped)
  ];

  const merged = deduplicatePhones(existing, incoming);
  assert.equal(merged.length, 3);
  assert.ok(merged.includes("+44 20 7946 0991"));
  // Retained the longer extension version
  assert.ok(merged.includes("+1 415 555 0199 ext. 102"));
});

test("Phase 2: Email aggregation categorizes by department and prevents duplicates", () => {
  assert.equal(classifyEmailDepartment("support@example.com"), "support");
  assert.equal(classifyEmailDepartment("billing@example.com"), "billing");
  assert.equal(classifyEmailDepartment("press-relations@example.com"), "press");
  assert.equal(classifyEmailDepartment("careers@example.com"), "careers");
  assert.equal(classifyEmailDepartment("info@example.com"), "general");

  const existing = [
    { email: "info@example.com", department: "general" },
    { email: "sales@example.com", department: "sales" },
  ];
  const incoming = [
    "INFO@EXAMPLE.COM", // duplicate with different casing
    "support@example.com",
    { email: "press@example.com", department: "press" },
  ];

  const aggregated = aggregateEmails(existing, incoming);
  assert.equal(aggregated.length, 4);
  assert.equal(aggregated[0].email, "info@example.com");
  assert.equal(aggregated.find((e) => e.email === "support@example.com").department, "support");
});

test("Phase 3: Executive sanitization rejects navigation elements, menu items, and ads", () => {
  // Navigation elements
  assert.equal(sanitizeExecutive({ name: "About Us", role: "Company Overview" }), null);
  assert.equal(sanitizeExecutive({ name: "Products & Solutions", role: "Software" }), null);
  assert.equal(sanitizeExecutive({ name: "Careers", role: "Join Our Team" }), null);
  assert.equal(sanitizeExecutive({ name: "Privacy Policy", role: "Legal" }), null);

  // Job advertisement snippets
  assert.equal(sanitizeExecutive({ name: "We are hiring Senior Engineers", role: "Full Time" }), null);
  assert.equal(sanitizeExecutive({ name: "Open Positions", role: "Apply Now" }), null);

  // Non-human names / single words / random numbers
  assert.equal(sanitizeExecutive({ name: "100+", role: "Clients Worldwide" }), null);
  assert.equal(sanitizeExecutive({ name: "Platform", role: "Architecture" }), null);

  // Valid executive entries
  const validExec = sanitizeExecutive({
    name: "Dr. Elena Rostova",
    role: "Chief Technology Officer",
    email: "elena@example.com",
  });
  assert.ok(validExec !== null);
  assert.equal(validExec.name, "Dr. Elena Rostova");
  assert.equal(validExec.role, "Chief Technology Officer");
});

test("Phase 4: CrawlerState manages lifecycle checkpoints and fault recovery", async () => {
  const fakeStore = {};
  const mockStorage = {
    async get(key) {
      return { [key]: fakeStore[key] };
    },
    async set(obj) {
      Object.assign(fakeStore, obj);
    },
    async remove(key) {
      delete fakeStore[key];
    },
  };

  const state1 = new CrawlerState({ storage: mockStorage, storageKey: "test:crawl" });
  state1.state.visited.push("https://example.com");
  state1.state.frontier = ["https://example.com/about", "https://example.com/contact"];
  state1.state.status = "running";
  await state1.persist();

  // New instance can restore checkpoint
  const state2 = new CrawlerState({ storage: mockStorage, storageKey: "test:crawl" });
  const restored = await state2.restore();
  assert.equal(restored, true);
  assert.equal(state2.state.status, "running");
  assert.deepEqual(state2.state.visited, ["https://example.com"]);
  assert.equal(state2.state.frontier.length, 2);

  // Retry execution with exponential backoff on transient failure
  let calls = 0;
  const flakyFunction = async (arg) => {
    calls++;
    if (calls < 2) throw new Error("Network glitch");
    return { ok: true, url: arg };
  };

  const result = await state2.executeWithRetry(flakyFunction, "https://example.com/about", 3, 10);
  assert.equal(result.ok, true);
  assert.equal(calls, 2);
  assert.equal(state2.state.retryCount, 1);

  // Clear state
  await state2.clear();
  assert.equal(fakeStore["test:crawl"], undefined);
});
