# Aether — Autonomous Chrome Intelligence

Manifest V3 side-panel extension that turns a corporate site into a source-traced company record. Extraction runs **on-device** via [Gemini Nano](https://developer.chrome.com/docs/ai/prompt-api) when available, with a deterministic heuristic fallback. Missing C-suite, address, or email trips a self-healing navigation harness.

Chrome Web Store copy: [`STORE.md`](./STORE.md). Unpacked QA: [`tests/manual.md`](./tests/manual.md).

## What it does

1. **Sanitize** the live DOM (scripts, SVGs, tracking pixels, inline styles).
2. **Serialize** semantic content to Markdown.
3. **Infer** against a strict JSON schema (Nano or heuristic), tagging confidence.
4. **Self-heal** — score in-page links with a zero-shot classifier, open high-probability About / Team / Impressum pages in background tabs, merge.
5. **Cache** domain schemas in `chrome.storage.local`.
6. **Edit** every field in the side panel with undo/redo, PII masking, conflict protection, and “verify source” highlight.

Multilingual: language is taken from `lang` / the document, Unicode names and addresses are preserved (Japanese, German, and Latin scripts are first-class).

## Install (unpacked)

1. Chrome 123+ (Gemini Nano needs a recent Canary/Dev or Stable with the Prompt API).
2. `chrome://extensions` → enable **Developer mode**.
3. **Load unpacked** → select this folder.
4. Open any company site, click the Aether icon. The side panel opens.
5. **Extract**.

Optional Nano: `chrome://flags/#prompt-api-for-gemini-nano` → Enabled, restart, wait for the model download (`chrome://components` → Optimization Guide).

Without Nano, Aether still extracts via the local heuristic engine.

Follow [`tests/manual.md`](./tests/manual.md) for a 10-step QA pass after load.

## Permissions

| Permission | Why |
| --- | --- |
| `sidePanel` | Dossier UI |
| `storage` | Domain schema cache |
| `scripting` / `tabs` / host | Read the page, open hidden heal tabs |
| `offscreen` | Isolated inference document |

No data leaves the machine unless you export the JSON/Markdown yourself.

## Architecture

```
content-script  →  sanitize + Markdown + links
service-worker  →  harness state machine, cache, background tabs
offscreen       →  Gemini Nano / heuristic inference
side panel      →  editable record, confidence, sources, log
```

Circuit breakers: max depth 2, max 4 pages, visited-URL registry.

## Roadmap

v2.0 is the scaffold (MV3, sanitize, Nano/heuristic, self-heal, dossier UI).
Remaining work is tracked in [`PLAN.md`](./PLAN.md) / [`plan.json`](./plan.json). An hourly automation implements **one pending item per run**.

Store listing draft and privacy questionnaire notes live in [`STORE.md`](./STORE.md).

## Privacy

- PII mask toggle redacts emails and phones in the UI and in exports.
- **Mask cache** (`maskCache` in `chrome.storage.sync`, default **off**): when enabled, emails and phones are redacted with `maskRecordForCache` before the domain schema is written to `chrome.storage.local`. Leave it off if you want later re-extracts to heal from cached contact fields. Clear the domain cache after turning it on so older unmasked blobs are gone.
- CSP on extension pages: `script-src 'self'; object-src 'self'`.
- Untrusted page JS never executes inside the extension context.

## License

MIT
