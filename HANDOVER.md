# Airtime — Handover

Time tracking and budget management for self-hosted Plane. This file records
where the build stands, what is verified, and what is left.

## Branch and state

- Branch model: `dev` (GitHub default) -> `stage` -> `prod`, promoted by the
  manual **Promote to stage** / **Promote to prod** actions. `prototypes/AIRTIME-16`
  keeps the coded design artifacts; GitHub Pages is disabled.
- Work sits on a local stack: `feature/AIRTIME-31` -> `feature/AIRTIME-32` ->
  `feature/AIRTIME-33` (current), based on `dev` at `9c80586`. Nothing is
  pushed; `dev`, `stage` and `prod` are unchanged.
- Working tree clean after this handover is committed.
- Local stack is up and healthy: PostgreSQL container and the dev server
  (`.\air.ps1 status` reports `/health` ok).
- Work is tracked in Plane — workspace `atakumi`, project **Airtime**
  (`AIRTIME`); ids in `.plane.json`. Standard docs: `AGENTS.md`,
  `CONSTITUTION.md`, `design-system/DESIGN.md`.

## What was completed

The server (v1.1–v1.8) was already built. This session completed the Windows
desktop client to the approved coded designs in `prototypes/AIRTIME-16/v2`, closing
the v1.3–v1.8 client criteria.
  (`/health` reports ok). A browser preview also works (`npm run dev` on
  `http://localhost:5173`); the API client falls back to the web fetch outside
  Tauri and the server allows that origin.

## What was completed

The server (v1.1–v1.8) and the Windows desktop client were built in earlier
sessions. This session closed three QA-audit items from the approved v2 design:
the duration parser, the week/month timesheet view and bulk row entry.

| Commit | Work |
| --- | --- |
| `2b6075e` | Duration parser, `DurationInput`, wired into back-fill and edit (AIRTIME-31) |
| `2346c0e` | Review change: top-aligned date/duration, quick chips removed (AIRTIME-31) |
| `fbd69ab` | `GET /api/time-entries/summary`: costed entries and period totals (AIRTIME-32) |
| `d4b97c8` | Desktop types, `ApiClient.timesheet`, `loadTimesheet`, `periodRange` (AIRTIME-32) |
| `cc77cc5` | Week/month timesheet screen with stats, table and states (AIRTIME-32) |
| `0dfba9f` | Use the web fetch outside Tauri so the browser preview can sign in |
| `53628f5` | The timesheet replaces My time, keeping the name (AIRTIME-32) |
| `c7e977e` | Bulk row entry with save-all and keyboard flow (AIRTIME-33) |

Installer built (earlier session):

```
desktop/src-tauri/target/release/bundle/nsis/Airtime_0.1.0_x64-setup.exe
```

Repository hygiene (earlier session) is unchanged: synced lockfiles, trimmed
Docker context, CI on `dev`/`stage`/`prod`, manual fast-forward promotion
actions, `HANDOVER.md` tracked.

## Repository layout

- `server/` — TypeScript, Fastify, PostgreSQL. Accounts, roles, server-side
  authorisation, audit log, Plane sync, time tracking, budgets/rates/burn,
  multi-currency, CSV export, feedback capture. 41 tests.
- `desktop/` — Tauri v2, React, TypeScript. The Windows client.
- `prototypes/AIRTIME-16/v1` and `v2` — coded design artifacts (static HTML,
  multi-currency, CSV export, feedback capture, and the timesheet summary
  endpoint with read-time costing. 45 tests.
- `desktop/` — Tauri v2, React, TypeScript. The Windows client. My time is the
  week/month timesheet with bulk entry; the duration parser is shared by the
  timesheet, back-fill dialog and entry edit.
- `design/AIRTIME-16/v1` and `v2` — coded design artifacts (static HTML,
  light/dark, WCAG 2.2 AA target). `v2` is the approved set.
- `air.ps1` — brings up PostgreSQL and the dev server locally.

## How to run and verify

```
.\air.ps1 start                 # postgres + dev server, http://localhost:3000
cd desktop
npm install
npm run dev                     # browser preview at http://localhost:5173
npm run tauri dev               # development window (needs Rust on PATH)
npm run tauri build             # NSIS installer
```

Sign in as the bootstrap administrator from `.env` and check:

- **My time** — Week/Month ranges with `‹ ›`, period totals (Total, Billable,
  Uncosted, Cost), entry table with edit; bulk entry: Add row, `1h 30m` in the
  duration cell, Enter saves and opens the next row, Shift+Enter repeats the
  work item, Ctrl+Enter or Save N entries saves all valid rows, an invalid
  duration stays inline.
- **Back-fill / Edit entry** — duration formats `1h 30m`, `1h30m`, `90m`, `2h`,
  `1d` (8h), `1w` (40h), `0.5d`, `+15m`; parsed value echoed; save blocked while
  invalid.
- **Projects** — set or edit a budget per project; budget health, burn and flags.
- **Budgets** — set member, project or client rates.
- **Reports** — filter by date/project/member and export CSV.
- **Admin** — add/role/remove members, read the audit log, review and export the
  anonymised feedback dataset.
- **Settings** — reporting currency and FX refresh.

## Verification results

- Server: `npm run typecheck`, `npm run lint` and `npm run build` clean;
  `npm test` 45 passed (41 before, 4 for the timesheet summary) against a
  throwaway `airtime_test` database in the local Postgres container.
- Desktop: `npm test` 40 passed (22 at the start of the session), `npm run lint`
  0 errors (2 pre-existing warnings), `npm run build` clean.
- Live check: `/health` ok; `GET /api/time-entries/summary` is registered
  (401 unauthenticated, not 404).
- Rust: release build and NSIS bundle succeed (earlier session).
- Note: a branch push made by the promote actions with `GITHUB_TOKEN` does not
  re-trigger CI on the target branch, so confirm the source branch was green
  before promoting.

## Plane status

State map: Backlog `50c450d6`, Todo `7da2cc89`, In Progress `9b44d5a7`,
Done `463fbefb`.

### Done and signed off

AIRTIME-1, 3, 4, 5, 7, 8, 9, 10, 16, 17–24, 26, 31, 32, 33, 53, 55.

### In Progress

- **AIRTIME-2** (epic) — closes when its children close.
- **AIRTIME-6** v1.4 budgets, rates, burn — meets its child criteria and awaits
  the PO moving it to Done. Caveat: the epic criterion "manager opens the
  project" is served by the Projects list, not a project detail screen; that is
  AIRTIME-43.

### Not fully done

- **AIRTIME-27** PDF export — not started; needs a template review and a server
  PDF library. Blocks AIRTIME-69 (invoicing).
- **AIRTIME-28** multi-workspace sync — not started; sized L.
- **AIRTIME-25** track expenses — not started.
- **AIRTIME-11–15** future activity capture — backlog by design.
- **AIRTIME-17–24** Design 1–8 — coded work exists in `prototypes/AIRTIME-16/v2`,
  but the tickets are still Todo; they need a decision to close, not code.
- **AIRTIME-30, 34–52, 54, 56** — the rest of the QA-audit batch. High-priority
  missing items: 42 (Price, Profit and targets), 43 (project detail).
- **AIRTIME-57–70** — the newer roadmap batch, untouched.
- **AIRTIME-33 follow-up** — the PO-added bulk update/delete was descoped; it
  needs AIRTIME-64's lock state and a selection design.
- Copy-last-week, split and duplicate (PO additions to AIRTIME-32) were
  descoped for the same reason: no design reference.

## Remaining work, in order

1. Push the stack (`feature/AIRTIME-31`..`33`) and open PRs into `dev`; promote
   when the build is signed off.
2. AIRTIME-42 Price/Profit/targets: record the two open definitions first
   (how Profit is defined, whether the margin target is an amount or a
   percentage), then build.
3. AIRTIME-43 project detail screen (needs 42 for the five-number summary; also
   closes the AIRTIME-6 caveat).
4. AIRTIME-27 PDF export: template, then generation.
5. AIRTIME-28 multi-workspace: server schema and sync first, then the desktop
   workspace list, grouping and filters.
6. Remaining QA-audit items (30, 34–52, 54, 56).
7. Ask the PO to move AIRTIME-6 to Done.

## Decisions and assumptions

- AIRTIME-16 v2 is the approved design; screens were implemented without
  per-screen checkpoints, then reviewed.
- My time is now the week/month timesheet; the earlier day-list screen was
  removed.
- Timesheet totals: Total and Billable are summed client-side; Cost and
  Uncosted come from server read-time costing (most specific rate wins), cost
  converted to the reporting currency. Uncosted means no applicable rate.
- The duration parser accepts only the documented formats; bare numbers such as
  `90` are rejected. The quick-duration chips were removed at review.
- Bulk entry: Enter saves the row and appends a fresh row with the same date,
  Shift+Enter keeps the work item, Ctrl+Enter/Save N saves every valid row and
  leaves invalid rows inline with errors. Draft rows preview Billable (10-minute
  floor) and show Cost as `—`; there is no focusable Billable control until
  AIRTIME-41.
- Bulk saves are one POST per row with a single refresh afterwards; network
  failures queue each row and leave the grid.
- Entry date/duration edits are sent as `startedAt`/`endedAt`; the server derives
  duration from them and has no `date` field.
- Delete has no undo in the client: the server soft-deletes but exposes no
  restore route. Edit undo re-applies the previous values via another PATCH.
- Edits and deletes are not queued offline; a network error is surfaced instead.
- Rate client scope takes a raw client id (Plane has no clients list).
- Members, roles, audit and feedback are grouped into one tabbed Admin screen.
- CSV download uses a Blob anchor; in the Tauri app all requests go through the
  HTTP plugin (loopback/CORS), in a plain browser through the web fetch.
- Branch model is `dev` -> `stage` -> `prod`; feature branches stay local until
  promoted by PR or push, and promotion is fast-forward only.

## Resume

- Next build: `/work-issue AIRTIME-42` (record the two definitions first), then
  `/work-issue AIRTIME-43`.
- Also queued: `/work-issue AIRTIME-27`, `/work-issue AIRTIME-28`.
- Approvals: move AIRTIME-6 to Done.
- Publish: push `feature/AIRTIME-31`..`33` and PR into `dev`, then run the
  manual **Promote to stage** / **Promote to prod** actions when signed off.
