# Aether unpacked QA checklist

Ten steps after **Load unpacked** from the repo root. Use a public company homepage you are allowed to inspect. Do not paste page content into remote tools.

## Setup

- Chrome 123+
- `chrome://extensions` → Developer mode → Load unpacked → this repository folder
- Optional: enable Prompt API + wait for Gemini Nano if you want the on-device model path

## Checklist

1. **Action opens the side panel**  
   Click the Aether toolbar icon. The side panel appears. No console CSP errors on `chrome-extension://` pages.

2. **Extract on a sparse homepage**  
   Open a company site. Click Extract. A record appears with at least `company_name` or a logged reason. Markdown serialize does not freeze the tab.

3. **Self-heal stays bounded**  
   If the homepage is thin, the log should mention scored About/Team/Impressum links. At most two extra tabs at a time; all heal tabs close when the run finishes. Total pages ≤ configured max (default 4, options 2–6).

4. **Edit + undo across reload**  
   Change a field. Close the side panel and reopen it on the same origin. Undo restores the previous value (session history, 20 snapshots).

5. **Verify source**  
   Click Verify source on a field that has a source. The page scrolls to the stamped `data-aether-id` node (or snippet fallback), not a brittle XPath.

6. **PII mask in UI and copy**  
   Enable Mask PII. Emails/phones show redacted. Copy record writes masked JSON and shows a short toast. Disable mask: raw values return in the panel.

7. **CSV + JSON/MD export**  
   Export executives CSV has `name,role,email` columns. JSON and Markdown downloads open locally. With Mask PII on, exports respect the mask.

8. **Options persist**  
   Extensions → Details → Extension options. Toggle default PII mask, max pages, force-heuristic, mask cache. Reload the panel; settings still apply. Clear cache removes stored domain schemas.

9. **Locale chrome vs extracted text**  
   With Chrome UI language German (or Japanese), chrome strings (Extract, Record, Mask PII, C-suite) localize. A Japanese or German name on the page is stored unchanged.

10. **Security smoke**  
    `manifest.json` CSP remains `script-src 'self'`. Options `maskCache` on: after Extract, `chrome.storage.local` schema for that host has no raw email/phone. No network request from the extension carries page body text.

## Automated complement

```bash
node --test tests/engine.test.mjs tests/harness.test.mjs
```

Ship only if this checklist and the unit tests both pass.
