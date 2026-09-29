# Airtime — Handover

Time tracking and budget management for self-hosted Plane. This file records
where the build stands, what is verified, and what is left.

## Branch and state

- Branch model: `dev` (GitHub default) -> `stage` -> `prod`, promoted by the
  manual **Promote to stage** / **Promote to prod** actions. `prototypes/AIRTIME-16`
  keeps the coded design artifacts; GitHub Pages is disabled.
- Work sits on `feature/AIRTIME-55` and is pushed to `dev` (`6311646`). `stage`
  and `prod` still point at the design commit until promoted.
- Working tree clean; lockfiles, docs and CI tidied this session.
- Local stack is up and healthy: PostgreSQL container and the dev server
  (`.\air.ps1 status` reports `/health` ok).
- Work is tracked in Plane — workspace `atakumi`, project **Airtime**
  (`AIRTIME`); ids in `.plane.json`. Standard docs: `AGENTS.md`,
  `CONSTITUTION.md`, `design-system/DESIGN.md`.

## What was completed

The server (v1.1–v1.8) was already built. This session completed the Windows
desktop client to the approved coded designs in `prototypes/AIRTIME-16/v2`, closing
the v1.3–v1.8 client criteria.

| Commit | Work |
| --- | --- |
| `70b4d3a` | Entry edit and delete with history and undo (AIRTIME-5) |
| `35b3571` | Budget and rate administration (AIRTIME-6) |
| `20fc573` | Reporting-currency picker and FX refresh (AIRTIME-7) |
| `0c339d2` | Reports screen with filtered CSV export (AIRTIME-8) |
| `e304b6d` | Admin screen: members/roles, audit log, feedback review (AIRTIME-9/10) |
| `3821f72` | README update |
| `4baaf5c` | AIRTIME-55 fix: removal deletes the Plane connection and sync stops |

Installer built:

```
desktop/src-tauri/target/release/bundle/nsis/Airtime_0.1.0_x64-setup.exe
```

Repository hygiene (this session):

- Root `package-lock.json` synced with `server/package.json`; `desktop/package.json`
  renamed `@airtime/desktop`, versioned `0.1.0` to match the server and installer.
- `.dockerignore` excludes `desktop/`, so the server image no longer pulls the
  Rust target directory into the build context.
- Compose passes `LOG_LEVEL` and `APP_JWT_TTL`, matching `.env.example`;
  `.gitattributes` normalises line endings.
- CI (`.github/workflows/ci.yml`) runs on pushes and PRs to `dev`, `stage` and
  `prod`: server typecheck/lint/tests against a Postgres 16 service, desktop
  lint/tests/build.
- Manual promotion actions: `promote-to-stage.yml` (`dev` -> `stage`) and
  `promote-to-prod.yml` (`stage` -> `prod`), both fast-forward only.
- `dev` is the GitHub default branch; GitHub Pages was disabled and `.nojekyll`
  removed.
- `HANDOVER.md` is now tracked.

## Repository layout

- `server/` — TypeScript, Fastify, PostgreSQL. Accounts, roles, server-side
  authorisation, audit log, Plane sync, time tracking, budgets/rates/burn,
  multi-currency, CSV export, feedback capture. 41 tests.
- `desktop/` — Tauri v2, React, TypeScript. The Windows client.
- `prototypes/AIRTIME-16/v1` and `v2` — coded design artifacts (static HTML,
  light/dark, WCAG 2.2 AA target). `v2` is the approved set.
- `air.ps1` — brings up PostgreSQL and the dev server locally.

## How to run and verify

```
.\air.ps1 start                 # postgres + dev server, http://localhost:3000
cd desktop
npm install
npm run tauri dev               # development window
npm run tauri build             # NSIS installer
```

Sign in as the bootstrap administrator from `.env` and check:

- **My time** — edit an entry (date/duration/note), `0` duration is blocked with
  a message, history shows author and time, delete confirms, edit offers undo.
- **Projects** — set or edit a budget per project; budget health, burn and flags.
- **Budgets** — set member, project or client rates.
- **Reports** — filter by date/project/member and export CSV.
- **Admin** — add/role/remove members, read the audit log, review and export the
  anonymised feedback dataset.
- **Settings** — reporting currency and FX refresh.

## Verification results

- Server: `npm run typecheck`, `npm run lint` and `npm run build` clean;
  `npm test` 41 passed (39 before, 2 new for AIRTIME-55) against a throwaway
  `airtime_test` database in the local Postgres container.
- Desktop: `npm test` 22 passed, `npm run lint` 0 errors (2 pre-existing
  warnings), `npm run build` clean.
- Rust: release build and NSIS bundle succeed (earlier session).
- Live server smoke test (administrator token): 200 on `/api/me`,
  `/api/projects?withBudget`, `/api/rates`, `/api/members`, `/api/audit`,
  `/api/feedback`, `/api/organisation`, `/api/fx/rates`, `/api/fx/refresh`,
  `/api/exports/time-entries.csv`, `/api/plane/connection`,
  `/api/plane/work-items`.
- `docker compose -f docker-compose.yml config` parses; the three workflows
  parse as YAML. CI on the first `dev` push (run `36345186389`) is green:
  server and desktop jobs both pass.
- Note: a branch push made by the promote actions with `GITHUB_TOKEN` does not
  re-trigger CI on the target branch, so confirm the source branch was green
  before promoting.

## Plane status

State map: Backlog `50c450d6`, Todo `7da2cc89`, In Progress `9b44d5a7`,
Done `463fbefb`.

### Fully done — awaiting sign-off

Meets child acceptance criteria; sits in In Progress only because the running app
has not been signed off.

- **AIRTIME-5** v1.3 timer, back-fill, edit history.
- **AIRTIME-6** v1.4 budgets, rates, burn. Caveat: the epic criterion "manager
  opens the project" is served by the Projects list, not a project detail screen.
- **AIRTIME-7** v1.5 multi-currency, FX.
- **AIRTIME-9** v1.7 desktop shell, secure token, local cache.
- **AIRTIME-10** v1.8 feedback capture.
- **AIRTIME-55** v1.1 follow-up — member removal deletes the Plane connection;
  poll, webhook and manual sync stop for removed members. Server-only; tests
  cover it.

### Already Done in Plane

AIRTIME-1, AIRTIME-3, AIRTIME-4, AIRTIME-16, AIRTIME-26.

### Not fully done

- **AIRTIME-2** (epic) — closes when its children close.
- **AIRTIME-8** v1.6 — CSV done; PDF half deferred.
- **AIRTIME-27** PDF export — not started.
- **AIRTIME-28** multi-workspace sync — not started.
- **AIRTIME-25** track expenses — not started.
- **AIRTIME-11–15** future activity capture — backlog by design.
- **AIRTIME-17–24** Design 1–8 — coded work exists in `prototypes/AIRTIME-16/v2`,
  but the tickets are still Todo; they need a decision to close, not code.

## Remaining work, in order

1. Sign off the six done items above.
2. AIRTIME-27 pdf export: needs a template (visual review) and likely a server
   PDF library.
3. AIRTIME-28 multi-workspace: server schema and sync first, then the desktop
   workspace list, grouping and filters.
4. Optional project-detail screen to satisfy the strict AIRTIME-6 epic criterion.
5. Close or keep the Design 1–8 children.

## Decisions and assumptions

- AIRTIME-16 v2 was taken as the approved design, so screens were implemented
  without per-screen design checkpoints.
- Entry date/duration edits are sent as `startedAt`/`endedAt`; the server derives
  duration from them and has no `date` field.
- Delete has no undo in the client: the server soft-deletes but exposes no
  restore route. Edit undo re-applies the previous values via another PATCH.
- Edits and deletes are not queued offline; a network error is surfaced instead.
- Rate client scope takes a raw client id (Plane has no clients list).
- Members, roles, audit and feedback are grouped into one tabbed Admin screen.
- CSV download uses a Blob anchor, which works in the WebView2.
- Branch model is `dev` -> `stage` -> `prod`; feature branches stay local until
  promoted by PR or push, and promotion is fast-forward only.
- CI was added this session; the promote actions use the default `GITHUB_TOKEN`,
  so their pushes do not re-run CI on the target branch.

## Resume

- Next build: `/work-issue AIRTIME-27`.
- Other tickets: `/work-issue AIRTIME-28`.
- Approvals: move AIRTIME-5, 7, 9, 10, 55 to Done; decide on 6 and 8; decide on
  the Design 1–8 children.
- Promote: run the manual **Promote to stage** and **Promote to prod** actions
  once the dev work is signed off.
