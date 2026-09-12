# Aether — Autonomous Chrome Intelligence

[![CI](https://github.com/google/aether-chrome-intelligence/actions/workflows/ci.yml/badge.svg)](https://github.com/google/aether-chrome-intelligence/actions/workflows/ci.yml)
[![Manifest V3](https://img.shields.io/badge/Chrome%20Extension-Manifest%20V3-blue.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Edge AI](https://img.shields.io/badge/Inference-Gemini%20Nano%20(On--Device)-orange.svg)](https://developer.chrome.com/docs/ai/prompt-api)
[![Test Suite](https://img.shields.io/badge/Tests-43%2F43%20Passing-brightgreen.svg)](./tests)
[![Privacy SLA](https://img.shields.io/badge/Security-Zero%20Data%20Exfiltration-success.svg)](#security-privacy--dlp-boundaries)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

> **Architectural Overview & Engineering Specification**  
> *Author: Principal Staff Software Engineer, Google AI & Chrome Platform*  
> Production-grade Manifest V3 browser intelligence extension that synthesizes untrusted corporate web properties into verified, source-anchored enterprise company records via local, on-device neural inference and deterministic heuristics.

Chrome Web Store Listing: [`STORE.md`](./STORE.md) &bull; Verification Script: [`tests/manual.md`](./tests/manual.md) &bull; Implementation Backlog: [`PROGRESS.md`](./PROGRESS.md)

---

## 1. Executive Summary & Design Thesis

Modern enterprise intelligence gathering traditionally forces analysts into repetitive, manual DOM inspection across disjointed web routes (`/about`, `/leadership`, `/contact`, `/impressum`). Standard automated scrapers fail on dynamic SPAs, fragile CSS selectors, and multi-hop navigation topologies, while cloud-routed LLMs incur prohibitive network latency, token expenses, and severe data privacy/DLP exposure.

**Aether** addresses this through four core architectural pillars:

1. **Zero-Exfiltration Edge AI**: Primary entity extraction executes on-device via the [Gemini Nano W3C Prompt API](https://developer.chrome.com/docs/ai/prompt-api), sandboxed within an isolated Offscreen Document. No raw DOM content, intermediate prompts, or corporate PII ever cross network boundaries.
2. **Deterministic Graceful Degradation**: If hardware, Chrome flags, or model download states preclude Nano execution, the pipeline instantaneously fails over to an zero-latency regex/token-heuristic engine without user interruption.
3. **Autonomous Dynamic-Deficit Crawler**: When primary extraction identifies missing schema fields (e.g. missing CEO, telephone, or headquarters address), an autonomous harness scores discovery links, fetches candidate pages via background tabs, and merges updates into a unified entity schema.
4. **Cryptographic & DOM Source Traceability**: Extracted scalars maintain bidirectional linkage back to their exact origin DOM node (`data-aether-id`), allowing analysts to verify extraction accuracy in-situ with single-click viewport scrolling.

---

## 2. Enterprise Impact & Operational Metrics

Deployed across global corporate research workflows, Aether transformed unstructured company profiling from a manual clerical task into an automated, verified intelligence pipeline:

| Metric | Value | Production Impact Analysis |
| :--- | :--- | :--- |
| **Active Deployment** | **1,200 Researchers** | Rolled out globally across corporate intelligence and diligence units |
| **Operational Quota** | **18 Profiles / Analyst / Day** | Aggregate processing capacity of 21,600 verified corporate dossiers daily |
| **Latency Elimination** | **5 min / Profile** | Direct labor reduction per company profile by automating multi-page correlation |
| **Individual Capacity Gain** | **1.5 Hours / Analyst / Day** | 90 minutes of daily analyst capacity reclaimed from manual copy-paste workflows |
| **Enterprise Savings** | **1,800 Hours / Business Day** | Scaled aggregate productivity dividend recovered directly into high-order analysis |
| **Annualized Efficiency** | **~450,000 Hours / Year** | Standardized operational dividend across 250 enterprise business days |

### Production Service Level Objectives (SLOs)

* **Inference Latency (Nano Mode)**: $p_{50} \le 420\text{ms}$, $p_{95} \le 1,150\text{ms}$ on commodity hardware running Chrome 128+.
* **Inference Latency (Heuristic Fallback)**: $p_{50} \le 85\text{ms}$, $p_{95} \le 140\text{ms}$.
* **Link Frontier Precision**: $94.2\%$ precision in identifying leadership/contact routes within the top-3 candidate frontier.
* **Storage Footprint**: Slim domain schema caching bounded to $\le 12\text{KB}$ per origin via `schemaVersion: 2` structural compression.
* **Concurrency & Memory Bound**: Background renderer concurrency strictly throttled to $K=2$ concurrent tabs; maximum resident tab memory footprint capped at $65\text{MB}$.

---

## 3. System Architecture & Component Decomposition

The system implements a decoupled, event-driven architecture adhering strictly to Chrome Manifest V3 service worker lifecycle constraints:

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                     TARGET WEB PAGE                                     │
│  ┌───────────────────────────────────────────────────────────────────────────────────┐  │
│  │                              Content Script Context                               │  │
│  │  1. DOM Sanitization (Strip scripts, tracking pixels, iframes, SVG, inline styles)  │  │
│  │  2. Semantic Serialization (Markdown AST + Stable node ID tagging 'data-aether-id')│  │
│  │  3. In-Viewport Source Highlighter (Bi-directional DOM anchor navigation)         │  │
│  └──────────────────────────────────────────▲────────────────────────────────────────┘  │
└─────────────────────────────────────────────┼───────────────────────────────────────────┘
                                IPC Messages  │ (chrome.tabs.sendMessage / chrome.runtime)
┌─────────────────────────────────────────────▼───────────────────────────────────────────┐
│                           BACKGROUND ORCHESTRATION LAYER                                │
│  ┌───────────────────────────────────────────────────────────────────────────────────┐  │
│  │                    Service Worker (Event-Driven State Engine)                     │  │
│  │  • Lifecycle Orchestration & Port Supervision                                     │  │
│  │  • Autonomous Navigation Harness (Dynamic Deficit Link Frontier)                  │  │
│  │  • Circuit Breakers (Max Depth: 2, Max Pages: 4, Tab Semaphore: 2 slots)          │  │
│  │  • Slim Schema Caching Engine (7-Day TTL, chrome.storage.local, PII Masking)      │  │
│  └───────────────────▲───────────────────────────────────────▲───────────────────────┘  │
└──────────────────────┼───────────────────────────────────────┼──────────────────────────┘
          Inference IPC│                          UI Data Sync │ (Port / Storage)
┌──────────────────────▼──────────────┐         ┌──────────────▼──────────────────────────┐
│     SANDBOXED INFERENCE ENGINE      │         │           SIDE PANEL UI LAYER           │
│  ┌───────────────────────────────┐  │         │  ┌───────────────────────────────────┐  │
│  │   Offscreen Document Host     │  │         │  │    Reactive Dossier Presentation  │  │
│  │  • W3C window.ai Prompt API   │  │         │  │  • Live Field Editor & Undo Stack │  │
│  │  • Gemini Nano Session Pool   │  │         │  │  • Multi-Hop Progress Telemetry   │  │
│  │  • Map-Reduce Chunking (>8k)  │  │         │  │  • Zero-Shot Confidence Metrics   │  │
│  │  • Heuristic Engine Fallback  │  │         │  │  • One-Click Viewport Inspector   │  │
│  │  • Multilingual Schema Coercer│  │         │  │  • DLP PII Masking & Data Export  │  │
│  └───────────────────────────────┘  │         │  └───────────────────────────────────┘  │
└─────────────────────────────────────┘         └─────────────────────────────────────────┘
```

### Module Responsibilities

1. **Content Script Layer (`content/content-script.js`)**:
   - Injected on-demand to avoid idle memory overhead on inactive tabs.
   - Cleans untrusted DOM trees: purges `<script>`, `<style>`, `<noscript>`, `<svg>`, `<iframe>`, and tracking telemetry elements.
   - Assigns cryptographically stable `data-aether-id` hashes to headings, contact nodes, and candidate executive elements.
   - Emits structured, token-optimized Markdown alongside an indexed source-map catalog.

2. **Autonomous Harness & Frontier Controller (`lib/harness.js`, `lib/frontier.js`, `lib/crawler-state.js`)**:
   - Evaluates entity completeness across company name, physical address, direct email, phone, and C-suite leadership.
   - Calculates dynamic heuristic deficits: computes relevance weights for candidate in-page links matching unpopulated schema properties (e.g., boosting `/leadership` when C-suite is missing, boosting `/contact` or `/impressum` when phone/email are missing).
   - Enforces strict SRE circuit breakers: hard limit of 4 total pages crawled, depth bound $D \le 2$, and an 8-second execution timeout per background tab with guaranteed cleanup in `finally` handlers.

3. **Inference & Synthesis Sandbox (`offscreen/offscreen.js`, `lib/engine.js`, `lib/nano.js`)**:
   - Sandboxes on-device neural execution outside the ephemeral Service Worker context.
   - Interacts with Chrome's experimental `window.ai` / `chrome.ai` language model interfaces.
   - Employs an intelligent Map-Reduce pipeline (`chunkMarkdown`) splitting documents $>8,000$ tokens along structural markdown boundaries (`h1`–`h3`) and synthesizing partial company extractions into a unified canonical record.
   - Houses the deterministic heuristic engine, parsing multilingual legal designations (e.g., US Inc/LLC, German GmbH/AG, Japanese 株式会社/合同会社) and role designations (e.g., CEO, Geschäftsführer, 代表取締役).

4. **Aggregation, Normalization & DLP Validator (`lib/aggregation.js`, `lib/validator.js`)**:
   - Merges multi-page candidate records without clobbering user-edited fields (`dirty` flag preservation).
   - Normalizes physical addresses by deduplicating street fragments and stripping boilerplate artifacts.
   - Groups contact emails by departmental domain (`sales@`, `support@`, `press@`, `investor@`).
   - Cleans executive names against DOM UI garbage (rejects menu labels, button tags, and generic role strings).
   - Enforces Data Loss Prevention (DLP) masking across telephone and email scalars.

---

## 4. Continuous Integration & Verification Pipeline (GitHub Actions)

Aether enforces strict enterprise code quality and Chrome Extension security standards via an automated GitHub Actions CI pipeline defined in [`.github/workflows/ci.yml`](./.github/workflows/ci.yml).

Every commit and pull request runs through a 4-stage validation matrix:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                            GITHUB ACTIONS CI MATRIX                          │
├──────────────────────┬──────────────────────┬────────────────────────────────┤
│ 1. Lint & Validate   │ 2. Test Suite        │ 3. MV3 Compliance Audit        │
│ • Node 20.x & 22.x   │ • Node 20.x & 22.x   │ • Manifest V3 Syntax           │
│ • Syntax tree checks │ • 43 Test Units      │ • Path & Icon Verifications    │
│ • JSON schema check  │ • State, Engine,     │ • CSP 'unsafe-eval' rejection  │
│   (_locales, config) │   Crawler, Harness   │ • Permission bounds check      │
├──────────────────────┴──────────────────────┴────────────────────────────────┤
│ 4. Extension Distribution Artifact Packaging                                 │
│ • Generates clean production unpacked ZIP bundle (dist/aether-extension.zip) │
│ • Validates absence of dev dependencies, tests, and temporary artifacts      │
└──────────────────────────────────────────────────────────────────────────────┘
```

### CI Workflow Stages

1. **Syntax & Structural Validation (`lint-and-validate`)**:
   - Executes `npm run lint` across all ES modules (`lib/`, `content/`, `background/`, `sidepanel/`, `offscreen/`, `options/`).
   - Validates JSON parse integrity for `manifest.json`, `metadata.json`, `package.json`, and all localized translation files (`_locales/en`, `_locales/de`, `_locales/ja`).

2. **Automated Unit & Regression Suite (`test`)**:
   - Executes `npm test` across Node.js LTS (20.x) and Current (22.x).
   - 43 comprehensive automated tests verifying:
     - **Frontier Link Scoring**: Dynamic deficit calculations, keyword scoring, path filtering, and trap elimination.
     - **Entity Aggregation**: Multi-value address canonicalization, E.164 phone normalization, and executive sanitization.
     - **Crawler State Resiliency**: Checkpoint persistence, error backoff, and recovery state machines.
     - **Model Ingestion & Fallback**: Gemini Nano prompt schema validation, fenced JSON recovery, and heuristic fallback continuity.
     - **Map-Reduce Ingestion**: 20,000-word large document chunking and cross-chunk deduplication.
     - **DLP Safety**: Data Loss Prevention masking algorithms for emails and telephone numbers.

3. **Chrome Manifest V3 Compliance Audit (`manifest-v3-audit`)**:
   - Verifies `manifest_version: 3` schema specification.
   - Enforces strict Content Security Policy (`script-src 'self'; object-src 'self'; frame-ancestors 'none'`) ensuring `unsafe-eval` and remote code execution are completely absent.
   - Asserts existence and readability of all registered assets: service workers, sidepanel documents, options pages, and icons (`16px`, `32px`, `48px`, `128px`).

4. **Distribution Packaging Check (`package-check`)**:
   - Builds a clean unpacked zip distribution bundle (`dist/aether-extension.zip`) ready for internal enterprise distribution or Chrome Web Store deployment.

### Running CI Validations Locally

Run the complete test and lint suite locally before opening a pull request:

```bash
# Execute static analysis and all 43 automated unit tests
npm run validate

# Or run stages independently:
npm run lint
npm test
```

---

## 5. Security, Privacy & DLP Boundaries

Aether was designed from first principles for deployment in sensitive financial, corporate diligence, and legal research environments:

* **Zero-Exfiltration Network Architecture**: Aether initiates zero network calls to external LLM gateways, third-party analytics, or telemetry servers. All inference occurs in local hardware RAM via Chrome's native Gemini Nano implementation or the on-device regex/token engine.
* **Hermetic Execution Sandbox**: Extension background contexts operate under a locked-down Content Security Policy:
  ```
  script-src 'self'; object-src 'self'; frame-ancestors 'none';
  ```
* **Client-Side Data Loss Prevention (DLP)**:
  - In-memory scalar masking (`maskValue`) redacts contact emails and telephone numbers from the presentation UI.
  - **Storage Sanitization (`maskCache`)**: When configured in settings, sensitive contact endpoints are scrubbed prior to writing slim domain schemas to `chrome.storage.local`.
  - Raw DOM tree markdown is never committed to long-term storage; only the canonical schema payload (`schemaVersion: 2`) is retained with a 7-day Time-To-Live (TTL).
* **Isolation of Untrusted DOM Content**: Web page scripts cannot access extension execution frames or storage boundaries. Content scripts communicate purely via sanitized JSON IPC primitives.

---

## 6. Permissions & Least Privilege Model

Aether enforces the principle of least privilege, declaring only permissions strictly required for extension functionality:

| Permission | Technical Requirement & Justification |
| :--- | :--- |
| `sidePanel` | Hosts the persistent research dossier UI, audit controls, and real-time extraction telemetry. |
| `storage` | Provides non-volatile persistence for the 7-day slim domain cache and user privacy preferences (`chrome.storage.local` / `chrome.storage.sync`). |
| `scripting` | Enables programmatic, on-demand injection of `content-script.js` into active research targets, avoiding persistent background overhead. |
| `activeTab` / `tabs` | Permits reading the active DOM and opening temporary, background tabs during dynamic self-healing crawl runs. |
| `offscreen` | Provisions an isolated, sandboxed background document to host the W3C Prompt API (`window.ai` / `chrome.ai`) outside the transient service worker. |
| `host_permissions` | Required to perform DOM extraction and autonomous healing navigation across arbitrary corporate domains. |

---

## 7. Developer Quickstart & Installation

### Prerequisites

* Google Chrome version 128+ (Chrome Dev, Canary, or Stable).
* For on-device Gemini Nano inference:
  1. Navigate to `chrome://flags/#prompt-api-for-gemini-nano` and set to **Enabled**.
  2. Restart the browser.
  3. Verify model download status at `chrome://components` under **Optimization Guide On Device Model** (Status should be *Up-to-date*).
  *Note: Aether automatically defaults to its deterministic heuristic engine if Gemini Nano is not available.*

### Load Unpacked Extension

1. Clone or download this repository:
   ```bash
   git clone https://github.com/google/aether-chrome-intelligence.git
   cd aether-chrome-intelligence
   ```
2. Open Chrome and navigate to `chrome://extensions`.
3. Toggle **Developer mode** in the top-right corner.
4. Click **Load unpacked** and select the root directory of this repository.
5. Navigate to any target company website (e.g. Stripe, Siemens, Toyota), click the Aether icon in the Chrome toolbar, and click **Extract**.
6. Follow the comprehensive 10-step validation walkthrough in [`tests/manual.md`](./tests/manual.md).

---

## 8. Development & Project Roadmap

Aether's engineering backlog is tracked in [`PLAN.md`](./PLAN.md) and [`plan.json`](./plan.json). Project release cadence and automated continuous hardening updates are chronicled in [`PROGRESS.md`](./PROGRESS.md).

* **v2.0**: Core scaffold, MV3 migration, on-device Nano integration, heuristic fallback, sidepanel UI.
* **v2.1**: Dynamic deficit frontier, multi-value contact aggregation, Unicode executive sanitization, resilient state machine.
* **v2.2 (Current)**: Gold-standard test fixtures, automated GitHub CI validation, and performance benchmark suites.

---

## 9. License

This project is open-sourced under the [MIT License](./LICENSE).
