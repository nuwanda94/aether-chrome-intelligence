# Aether v2.1 — implementation plan

Canonical tracker: [`plan.json`](./plan.json).  
Repo: [nuwanda94/aether-chrome-intelligence](https://github.com/nuwanda94/aether-chrome-intelligence)

An hourly automation implements **exactly one** `pending` item per run, in id order (`P01` … `P12`). Foundation items (`F01`–`F03`, `1A`, `3A`) shipped in v2.0.

## How a run works

1. Read `plan.json`.
2. Take the first item with `"status": "pending"`.
3. Implement only that item, to its `done_when`.
4. Set `status` to `"done"`, add `completed_at` (ISO-8601) and a short `notes`.
5. Commit and push to `main`.
6. If none pending: stop. Reply `Aether plan complete.`

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

Pending work is `P01`–`P12` in `plan.json`. Each object has `id`, `phase`, `status`, `title`, `detail`, `files`, `done_when`.
