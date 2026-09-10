# Aether progress log

Hourly automation: **one `pending` item from `plan.json` per run**, in id order.

| When (IST) | Item | Result |
| --- | --- | --- |
| 2026-09-11 05:00 IST | P07 Background tab cap + cleanup | Heal tabs gated to 2 concurrent slots; `finally` always removes the tab; 8s timeouts/failures logged to the side panel. |
| 2026-09-11 04:00 IST | P06 Persist undo history | Session-backed undo/redo (20 snapshots per origin, local fallback); panel restores stacks after reload. |
| 2026-09-11 03:03 IST | P05 Options page | `options_ui` + sync settings (PII mask, max pages 2–6, force-heuristic, clear cache); harness uses stored maxPages. |
| 2026-09-11 02:00 IST | P04 Route inference through offscreen | SW `inferViaOffscreen` sends `AETHER_OFFSCREEN_INFER`; harness injects `infer` for primary + heal; heuristic fallback if offscreen missing. |
| 2026-09-11 01:01 IST | P03 Chunked DOM map-reduce | `chunkMarkdown` splits >8k-token pages on h1–h3; `inferDocument` merges chunk records; serialize cap 200k chars; 20k-word fixture test. |
| 2026-09-11 00:01 IST | P02 Harness circuit-breaker tests | Shipped `tests/harness.test.mjs`; visited registry + MAX_PAGES cap; `node --test` 4/4 pass (cache short-circuit, score skip, no refetch, loop cap). |
| 2026-09-10 23:00 IST | P01 Engine unit tests | Shipped `tests/engine.test.mjs` + `package.json`; `node --test` 8/8 pass (merge conflict, JP/DE, DLP mask). |
| — | — | Awaiting first hourly run. Next: **P01 Engine unit tests**. |

When an item ships, prepend a row (newest first) and set `status: done` on that object in `plan.json`.
