# Aether implementation plan

Canonical tracker: [`plan.json`](./plan.json). Run log: [`PROGRESS.md`](./PROGRESS.md).  
Repo: [nuwanda94/aether-chrome-intelligence](https://github.com/nuwanda94/aether-chrome-intelligence)

An hourly automation implements **exactly one** `pending` item per run, in file order (`R01` … `R12` while those are pending).  
**v2.1** (F01–F03, 1A, 3A, P01–P12) is complete.  
**v2.2** backlog (`R01`–`R12`) comes from a principal engineering review: provenance, schema validation, heuristic breadth, heal-link graph, permission surface, slim cache, gold-set metrics, CI, exec merge, README guarantees, force re-extract.

## How a run works

1. Read `plan.json` from `main`.
2. Take the first item with `"status": "pending"`.
3. Implement only that item, to its `done_when`.
4. Set `status` to `"done"`, add `completed_at` (ISO-8601 UTC) and a short `notes`.
5. Prepend a row to `PROGRESS.md` (IST timestamp).
6. Commit and push to `main` with `github___push_files` (conventional commit: `feat:` / `fix:` / `test:` / `docs:`).
7. If none pending: update `PROGRESS.md`, reply `Aether plan complete.`, no other code changes.

Do not start a second item in the same run. Touch only the item's `files` plus tests/docs strictly required for that item.

Constraints (unchanged): Manifest V3, CSP `script-src 'self'`, no remote code, Unicode-safe extraction, no analytics or network calls that leak page content.

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
| H | Hardening (v2.2) | Review findings R01–R12 |

## Backlog (v2.2 — pending)

| Id | Title | Priority theme |
| --- | --- | --- |
| R01 | Attach sourceIds to record fields | Provenance (P0) |
| R02 | Validate Nano JSON against CompanyRecord schema | Trust (P0) |
| R03 | Broader heuristic executive patterns | Extraction (P0) |
| R04 | Score links from heal pages | Harness (P0) |
| R05 | On-demand content script injection | Permissions (P1) |
| R06 | Slim cache payload + schema version | Storage (P1) |
| R07 | Correct offscreen document reasons | MV3 policy (P1) |
| R08 | Gold-set fixtures + quality metrics | Measurement (P2) |
| R09 | GitHub Actions CI for unit tests | Quality (P2) |
| R10 | Richer executive merge | Merge (P2) |
| R11 | README results and guarantees section | Docs (P3) |
| R12 | Force re-extract control in side panel | UX (P3) |

## Completed (v2.1)

| Id | Title | Phase |
| --- | --- | --- |
| F01–F03, 1A, 3A | Foundation + dossier + harness v1 | F / 1 / 3 |
| P01–P12 | Tests through store listing | Q / 1–5 |

Each object in `plan.json` has `id`, `phase`, `status`, `title`, `detail`, `files`, `done_when`.
