# Aether v2.1 — implementation plan

Canonical tracker: [`plan.json`](./plan.json). Run log: [`PROGRESS.md`](./PROGRESS.md).  
Repo: [nuwanda94/aether-chrome-intelligence](https://github.com/nuwanda94/aether-chrome-intelligence)

An hourly automation implements **exactly one** `pending` item per run, in id order (`P01` … `P12`). Foundation items (`F01`–`F03`, `1A`, `3A`) shipped in v2.0.

## How a run works

1. Read `plan.json` from `main`.
2. Take the first item with `"status": "pending"`.
3. Implement only that item, to its `done_when`.
4. Set `status` to `"done"`, add `completed_at` (ISO-8601) and a short `notes`.
5. Prepend a row to `PROGRESS.md`.
6. Commit and push to `main` with `github___push_files`.
7. If none pending: stop. Reply `Aether plan complete.`

Do not start a second item in the same run.

## Phases

| Id | Phase | What |
| --- | --- | --- |
| F | Foundation | MV3 shell, serialize, Nano/heuristic |
| 1 | Side panel & state | Editable dossier, undo, source verify |
| 2 | Language & Unicode | JP/DE/EN extraction and UI chrome |
| 3 | Self-healing harness | Link scoring, hidden tabs, merge |
| 4 | Performance & cache | Sanitize, chunking, storage |
| 5 | Security | CSP, PII at rest |
| Q | Quality & ship | Tests, options, store listing |

## Backlog

| Id | Title | Phase |
| --- | --- | --- |
| P01 | Engine unit tests | Quality |
| P02 | Harness circuit-breaker tests | Quality |
| P03 | Chunked DOM map-reduce | Performance |
| P04 | Route inference through offscreen | Harness |
| P05 | Options page | Side panel |
| P06 | Persist undo history | Side panel |
| P07 | Background tab cap + cleanup | Harness |
| P08 | Stable source IDs in the DOM | Side panel |
| P09 | CSV export and clipboard | Side panel |
| P10 | Side panel UI locale | Language |
| P11 | Mask PII before cache write | Security |
| P12 | Web Store listing draft + test script | Quality |

Each object in `plan.json` has `id`, `phase`, `status`, `title`, `detail`, `files`, `done_when`.
