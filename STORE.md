# Aether — Chrome Web Store listing draft

Use this copy when submitting to the Chrome Web Store. Fields match the Developer Dashboard listing form.

## Name

Aether — Company Intelligence

(Store name limit 45 characters. Manifest `name` is localized via `extName`.)

## Short description

On-device company dossiers from any corporate site. No page content leaves your machine.

(Limit 132 characters.)

## Long description

Aether turns a company website into an editable, source-traced dossier — C-suite, address, contacts, and more — without sending page content to a remote API.

How it works

1. Sanitize the live page (scripts, SVGs, trackers).
2. Serialize semantic content to Markdown.
3. Infer a structured CompanyRecord with Gemini Nano (Prompt API) when available, or a deterministic heuristic fallback.
4. Self-heal sparse homepages by scoring About / Team / Impressum links and merging up to a small number of background pages.
5. Edit every field in the side panel. Undo/redo survives panel reloads. Verify source jumps to the stamped DOM node.

Privacy by design

- Extraction and inference run on-device. Untrusted page JavaScript never executes in the extension context.
- CSP on extension pages: script-src 'self'; object-src 'self'.
- Optional Mask PII redacts emails and phones in the UI and exports.
- Optional mask-cache setting redacts emails and phones before writing domain schemas to chrome.storage.local (default off so later extracts can still heal).
- You choose when to export JSON, Markdown, or CSV. Nothing is uploaded by the extension.

Requirements

- Chrome 123+
- Gemini Nano is optional (Prompt API / Optimization Guide). Without it, the heuristic engine still extracts.

Languages

UI chrome: English, German, Japanese (chrome.i18n). Extracted names and addresses keep their original Unicode.

## Category

Productivity

## Language

English (default). Additional locales: de, ja.

## Privacy (store questionnaire notes)

- Single purpose: extract and edit a local company record from the active tab and a small set of same-site heal pages.
- Host permission is required to serialize the active corporate site and to open short-lived background tabs for scored About/Team/Impressum links.
- Data used: page text and links from sites you visit while Extract is running; user edits; optional cached schema per origin.
- Data shared with third parties: none. No analytics. No remote inference endpoint.
- Remote code: none. All scripts ship in the package (MV3, script-src 'self').
- User controls: Mask PII, mask cache, force heuristic, max heal pages (2–6), clear cache, export/copy.

## Screenshots to capture (not included in this repo)

1. Side panel on a public company homepage after Extract.
2. C-suite cards with confidence badges.
3. Verify source highlight on the live page.
4. Options page (PII, max pages, mask cache).
5. Export / copy toast.

## Support / homepage

https://github.com/nuwanda94/aether-chrome-intelligence
