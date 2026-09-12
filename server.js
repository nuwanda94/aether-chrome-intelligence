import express from "express";
import path from "path";
import { GoogleGenAI, Type } from "@google/genai";
import {
  extractFromMarkdown,
  htmlToMarkdown,
  scoreLinks,
  mergeRecords,
  toTargetSchema,
  recordToTargetJson,
  canonicalizeUrl,
  deduplicateAddresses,
  deduplicatePhones,
  sanitizeExecutive,
} from "./lib/engine.js";

const app = express();
const PORT = 3000;
const HOST = "0.0.0.0";
const rootDir = process.cwd();

app.use(express.json({ limit: "10mb" }));

// Lazy initialization of Gemini client
let genAIClient = null;
function getGenAI() {
  if (!genAIClient && process.env.GEMINI_API_KEY) {
    genAIClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return genAIClient;
}

// Extract HTML links helper
function extractHtmlLinks(html, baseUrl) {
  const links = [];
  const linkRe = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = linkRe.exec(html))) {
    const rawHref = m[1].trim();
    const rawText = m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (!rawHref || rawHref.startsWith("javascript:") || rawHref.startsWith("#")) continue;
    const canon = canonicalizeUrl(rawHref, baseUrl);
    if (canon) {
      links.push({ href: canon, text: rawText });
    }
  }
  return links;
}

// Intelligent Crawler that follows high-value paths and avoids traps
async function crawlUrl(startUrl, maxPages = 4) {
  const visited = new Set();
  const pages = [];
  const queue = [startUrl];
  let origin = "";
  try {
    origin = new URL(startUrl).origin;
  } catch {
    return pages;
  }

  while (queue.length && pages.length < maxPages) {
    const currentUrl = queue.shift();
    if (visited.has(currentUrl)) continue;
    visited.add(currentUrl);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 7000);
      const res = await fetch(currentUrl, {
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 AetherBot/2.1",
          Accept: "text/html,application/xhtml+xml,text/plain",
        },
      });
      clearTimeout(timeoutId);

      if (!res.ok) continue;
      const html = await res.text();
      const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const title = titleMatch ? titleMatch[1].replace(/\s+/g, " ").trim() : "";
      const markdown = htmlToMarkdown(html);
      const links = extractHtmlLinks(html, currentUrl);

      pages.push({
        url: currentUrl,
        title,
        markdown,
        links,
      });

      // Score and prioritize high-value internal links
      const scored = scoreLinks(links, origin).filter(
        (l) => l.score >= 0.7 && !visited.has(l.href),
      );

      for (const item of scored) {
        if (!visited.has(item.href) && !queue.includes(item.href)) {
          queue.push(item.href);
        }
      }
    } catch (err) {
      console.warn(`[Aether Crawler] Failed fetching ${currentUrl}:`, err.message);
    }
  }

  return pages;
}

// Clean and prepare multi-page text chunks
function prepareMultiPageContext(pages) {
  return pages
    .map((p, idx) => {
      // Clean chunk: remove excessive linebreaks and redundant whitespace
      const cleanMd = p.markdown
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .join("\n")
        .slice(0, 12000);
      return `--- Page ${idx + 1}: ${p.url} (${p.title || "No Title"}) ---\n${cleanMd}`;
    })
    .join("\n\n========================================\n\n");
}

// Core extractor with Gemini 3.8 Flash (temperature 0.15) and deterministic fallback
async function extractWithGeminiOrDeterministic(pages, requestedUrl = "") {
  if (!pages || !pages.length) {
    throw new Error("No page content available for extraction");
  }

  const multiPageContext = prepareMultiPageContext(pages);
  const ai = getGenAI();

  if (ai) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.8-flash",
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `Extract the company information from the following website pages into the target JSON structure.\n\nContext:\n${multiPageContext}`,
              },
            ],
          },
        ],
        config: {
          systemInstruction: `You are an advanced web crawling and data extraction agent. Your objective is to navigate website structures intelligently, follow the correct internal paths (such as "About Us", "Contact", "Locations", or "Leadership"), and extract comprehensive, multi-value data points into a clean JSON structure.

### 1. Navigation & Crawl Strategy (Path Robustness)
- Prioritize High-Value Pages: Focus on internal content from /contact, /about, /locations, /team, or /company.
- Avoid Traps: Ignore generic footer boilerplate, irrelevant marketing blogs, or navigation links that do not contribute to core company data.

### 2. Multi-Value Extraction Rules
- Phone Numbers: If a company lists multiple phone numbers (e.g., toll-free, regional offices, support lines), extract all unique numbers into an array rather than stopping at the first match.
- Addresses: Capture all listed business addresses, headquarters, and regional office locations rather than only capturing the primary footer address.

### 3. Synthesis & Description Generation
- Product/Service Description: Read the core content of the website (hero sections, product pages, solutions overview) and write a professional, objective description summarizing what products or services the company provides.
- Tone: Keep descriptions concise, factual, and business-focused (avoiding fluff or marketing hype).

### 4. Target Output Schema
Return the extracted data strictly adhering to this JSON format:
{
  "company_name": "string",
  "industry": "string",
  "description": "Synthesized, professional description of the company's core products and services based on website content.",
  "addresses": [
    "Primary or Headquarter Address",
    "Secondary / Regional Address (if available)"
  ],
  "phone_numbers": [
    "Primary Phone",
    "Secondary / Toll-Free Phone"
  ],
  "email": "string",
  "website": "string",
  "executives": [
    {
      "name": "Full Human Name",
      "role": "Corporate Job Title"
    }
  ]
}

Ensure temperature setting is strictly respected. Preserve Unicode. Output empty string or empty array if unknown.`,
          temperature: 0.15,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              company_name: { type: Type.STRING },
              industry: { type: Type.STRING },
              description: { type: Type.STRING },
              addresses: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              phone_numbers: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              email: { type: Type.STRING },
              website: { type: Type.STRING },
              executives: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    role: { type: Type.STRING },
                  },
                  required: ["name", "role"],
                },
              },
            },
            required: [
              "company_name",
              "industry",
              "description",
              "addresses",
              "phone_numbers",
              "email",
              "website",
              "executives",
            ],
          },
        },
      });

      const text = response.text?.trim();
      if (text) {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed.executives)) {
          parsed.executives = parsed.executives.map(sanitizeExecutive).filter(Boolean);
        }
        if (Array.isArray(parsed.addresses)) {
          parsed.addresses = deduplicateAddresses([], parsed.addresses);
        }
        if (Array.isArray(parsed.phone_numbers)) {
          parsed.phone_numbers = deduplicatePhones([], parsed.phone_numbers);
        }
        return {
          ok: true,
          engine: "gemini-3.8-flash",
          data: parsed,
          pagesVisited: pages.map((p) => p.url),
        };
      }
    } catch (err) {
      console.warn("[Aether Server] Gemini API call failed, falling back to deterministic engine:", err.message);
    }
  }

  // Deterministic multi-page engine fallback
  let record = extractFromMarkdown(pages[0]);
  for (let i = 1; i < pages.length; i++) {
    const subRecord = extractFromMarkdown(pages[i]);
    const merged = mergeRecords(record, subRecord);
    record = merged.merged;
  }

  const targetPayload = toTargetSchema(record);
  if (!targetPayload.website && requestedUrl) {
    try {
      targetPayload.website = new URL(requestedUrl).origin;
    } catch {
      targetPayload.website = requestedUrl;
    }
  }

  return {
    ok: true,
    engine: "deterministic-aggregator",
    data: targetPayload,
    record,
    pagesVisited: pages.map((p) => p.url),
  };
}

// API endpoint: Health
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    name: "aether-chrome-intelligence",
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    model: "gemini-3.8-flash",
  });
});

// API endpoint: Extract from provided pages or live URL crawl
app.post("/api/extract", async (req, res) => {
  try {
    const { url, pages, maxPages = 4 } = req.body || {};

    let crawledPages = Array.isArray(pages) && pages.length ? pages : null;

    if (!crawledPages && url) {
      crawledPages = await crawlUrl(url, maxPages);
    }

    if (!crawledPages || !crawledPages.length) {
      return res.status(400).json({
        ok: false,
        error: "No pages provided or URL could not be crawled",
      });
    }

    const result = await extractWithGeminiOrDeterministic(crawledPages, url || crawledPages[0]?.url);
    res.json(result);
  } catch (err) {
    console.error("[API Extract Error]", err);
    res.status(500).json({
      ok: false,
      error: err?.message || "Extraction failed",
    });
  }
});

// Serve static files from root
app.use(
  express.static(rootDir, {
    extensions: ["html", "htm"],
    index: "index.html",
  }),
);

// Route aliases
app.get("/sidepanel", (req, res) => {
  res.sendFile(path.join(rootDir, "sidepanel", "index.html"));
});

app.get("/options", (req, res) => {
  res.sendFile(path.join(rootDir, "options", "index.html"));
});

// Fallback to index.html for client-side routing
app.get("*all", (req, res) => {
  res.sendFile(path.join(rootDir, "index.html"));
});

app.listen(PORT, HOST, () => {
  console.log(`Aether server listening on http://${HOST}:${PORT}`);
});
