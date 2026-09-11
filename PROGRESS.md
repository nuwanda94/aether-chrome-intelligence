# Aether progress log

Hourly automation: **one `pending` item from `plan.json` per run**, in id order.

**v2.1 complete.** v2.2 hardening in progress. Next run: **R03 Broader heuristic executive patterns**.

| When (IST) | Item | Result |
| --- | --- | --- |
| 2026-09-11 13:00 IST | R02 Validate Nano JSON against CompanyRecord schema | validateCompanyPayload accepts string fields + named execs, rejects bad types; infer falls back to heuristic. |
| 2026-09-11 12:36 IST | R01 Attach sourceIds to record fields | Map doc.sources onto company/email/phone/exec sourceId in extract + Nano applyJson; panel already prefers sourceId; unit test asserts fixture stamps. |
| 2026-09-11 12:04 IST | v2.2 backlog opened | Principal review findings filed as R01–R12 (pending). Next: R01 sourceIds on fields. |
| 2026-09-11 11:04 IST | Plan complete (v2.1) | All F/P items done. Superseded by v2.2 backlog. |
| 2026-09-11 10:03 IST | P12 Web Store listing draft + test script | Added STORE.md (name, short/long description, privacy questionnaire) and tests/manual.md (10-step unpacked QA); README links both. |
| 2026-09-11 09:04 IST | P11 Mask PII before cache write | Optional `maskCache` (default off) redacts emails/phones via `maskRecordForCache` before `chrome.storage.local` schema writes; documented in README. |
| 2026-09-11 08:00 IST | P10 Side panel UI locale | chrome.i18n `_locales/{en,de,ja}` + `default_locale`; Extract/Record/Mask PII/C-suite and other chrome strings localize; extracted JP names unchanged. |
| 2026-09-11 07:00 IST | P09 CSV export and clipboard | Executives CSV (`name,role,email`, PII-aware); Copy writes masked JSON when Mask PII is on, with a short toast. |
| 2026-09-11 06:01 IST | P08 Stable source IDs in the DOM | Serialize stamps `data-aether-id` on heading/email/phone/person nodes; Verify source highlights by id (snippet+kind fallback), not XPath. |
| 2026-09-11 05:00 IST | P07 Background tab cap + cleanup | Heal tabs gated to 2 concurrent slots; `finally` always removes the tab; 8s timeouts/failures logged to the side panel. |
| 2026-09-11 04:00 IST | P06 Persist undo history | Session-backed undo/redo (20 snapshots per origin, local fallback); panel restores stacks after reload. |
| 2026-09-11 03:03 IST | P05 Options page | `options_ui` + sync settings (PII mask, max pages 2–6, force-heuristic, clear cache); harness uses stored maxPages. |
| 2026-09-11 02:00 IST | P04 Route inference through offscreen | SW `inferViaOffscreen` sends `AETHER_OFFSCREEN_INFER`; harness injects `infer` for primary + heal; heuristic fallback if offscreen missing. |
| 2026-09-11 01:01 IST | P03 Chunked DOM map-reduce | `chunkMarkdown` splits >8k-token pages on h1–h3; `inferDocument` merges chunk records; serialize cap 200k chars; 20k-word fixture test. |
| 2026-09-11 00:01 IST | P02 Harness circuit-breaker tests | Shipped `tests/harness.test.mjs`; visited registry + MAX_PAGES cap; `node --test` 4/4 pass (cache short-circuit, score skip, no refetch, loop cap). |
| 2026-09-10 23:00 IST | P01 Engine unit tests | Shipped `tests/engine.test.mjs` + `package.json`; `node --test` 8/8 pass (merge conflict, JP/DE, DLP mask). |
| — | — | Awaiting first hourly run. Next: **P01 Engine unit tests**. |

When an item ships, prepend a row (newest first) and set `status: done` on that object in `plan.json`.
