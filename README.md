# Airtime

Time tracking and budget management for self-hosted [Plane](https://plane.so).
Airtime reads projects and work items from Plane with a per-user API token and
adds time-and-materials budgets, rates, burn and export on top, without changing
Plane.

This repository currently contains the **Airtime server**: the service that owns
shared state - accounts, roles, projects, rates, budgets and time entries - plus
its PostgreSQL schema, OIDC/local sign-in, role-based access control, financial
audit log and Docker deployment (work item `AIRTIME-3`, v1.1). It reads projects
and work items from Plane using a per-user API token, stored encrypted at rest,
kept fresh by webhooks and a polling fallback (work item `AIRTIME-4`, v1.2). It
records time with a one-timer-per-member start/stop and manual back-fill, a
10-minute billable minimum and a full edit history (work item `AIRTIME-5`, v1.3).
The Windows desktop client lands in a later work item (`AIRTIME-9`).

The coded design system and product screens live under `design/AIRTIME-16/v2`.

## Prerequisites

- Docker Desktop (for the documented deployment path), or
- Node.js 20+ and a PostgreSQL 16 database (for local development)

## Deploy with Docker

On a clean host with Docker installed:

```sh
cp .env.example .env   # then edit secrets and the bootstrap admin password
docker compose up -d
```

The command builds the server image, starts PostgreSQL, applies migrations and
reports healthy. Confirm with:

```sh
docker compose ps                    # server should be healthy
curl http://localhost:3000/health    # {"status":"ok","database":"up"}
```

The first start creates a single organisation and a bootstrap administrator from
`BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD`. Change the defaults in `.env`
before exposing the server. Generate `APP_JWT_SECRET` and `COOKIE_SECRET` with
`openssl rand -hex 32`.

## Local development

```sh
npm install
cp .env.example .env                 # point DATABASE_URL at your Postgres
npm run dev                          # tsx watch on http://localhost:3000
```

Migrations run automatically on start.

## Time tracking

`POST /api/timer/start` starts a timer for the signed-in member; starting a
second timer stops the first and records it as an entry. `POST /api/timer/stop`
creates an entry from the running timer. `POST /api/time-entries` back-fills
manually from a `date` and `durationMinutes`, or from explicit `startedAt` and
`endedAt`.

Every entry stores `duration_minutes` and `billable_minutes`; the billed figure
is floored at 10 minutes. A zero or negative duration, or an end before the
start, is rejected with a 400 and a message. Each create, edit and delete writes
a history row with the previous and new value, the author and a timestamp,
readable at `/api/time-entries/:id/history`. Deleted entries are soft-deleted so
their history survives, and members can only change their own entries.

## Budgets and burn

A time-and-materials budget is an amount and currency per project, set with
`PUT /api/projects/:id/budget`. Time is costed at read time using the most
specific rate available: a member rate, then a project rate, then a client rate
(`clientId` on a project), otherwise the entry is uncosted and excluded from cost
totals.

`GET /api/projects/:id/summary` returns spend, remaining, percent used, uncosted
hours, any totals in other currencies, the current burn rate per day and a
projected overrun or underrun. The projection runs from today to the project's
`target_date` synced from Plane; `projectionBasis` reports `project_end_date`
when that date is used. Only when a Plane project has no target date does it fall
back to a fixed `PROJECTION_HORIZON_DAYS` (default 30) and report
`default_horizon`. A project is flagged `over` when spend exceeds the budget and
`warning` when less than 10 percent remains. `GET /api/projects?withBudget=true`
adds the same summary to every project row so lists can flag at-risk projects.

## Multi-currency

Each workspace has a reporting currency (`PATCH /api/organisation`, administrator
only, audited). Amounts are stored in their original currency and converted when
read, using daily rates from Frankfurter (European Central Bank reference rates,
EUR-based), which needs no API key. Set `FX_PROVIDER_URL` to any compatible
endpoint; `FX_REFRESH_HOURS` (default 24) controls the scheduler, and
`POST /api/fx/refresh` forces a fetch.

Every budget summary reports `spent` in the reporting currency, a
`currencyTotals` breakdown of the original amounts, and a `conversions` entry per
currency with the rate and its date. If the provider is unavailable, the last
stored rates are used and marked `fxStale`, so totals still render. A cost in a
currency the provider does not publish is counted under `unconverted` and left
out of totals rather than crashing the view.

## Export

`GET /api/exports/time-entries.csv` exports one row per entry, filterable by
`from`, `to`, `projectId` and `memberId`. Columns cover project, member, date,
duration, work item, rate, currency and cost, plus the converted cost, reporting
currency and the FX rate and date used. The file is UTF-8 with a BOM and CRLF
line endings, and fields containing commas, quotes or newlines are quoted, so it
opens directly in Excel.

PDF export is deferred to AIRTIME-27 in the backlog so its layout gets a visual
review first.

## Feedback capture

Opt-in per member via `PATCH /api/me/feedback`. While opted in, every create,
edit and delete of a time entry also writes a feedback event for the future
inference engine: action, source, before and after values and a timestamp. The
stored event is anonymised - the member is a keyed hash, and descriptions, cost
and identifiers are stripped - and nothing is written while a member is opted
out. The entry edit history itself is always kept, as v1.3 requires.

Administrators can review events with `GET /api/feedback` and pull the anonymised
dataset with `GET /api/feedback/export`.

## Roles

| Role | Capabilities |
| --- | --- |
| `administrator` | Everything a manager can do, plus manage members and read the audit log |
| `manager` | Read projects, create budgets, set rates, read audit-gated data |
| `member` | Read projects and budgets, read own profile |

Every role-gated route enforces the rule server-side and returns `403` for a
caller without the role.

## API (v1.1)

| Method | Path | Role |
| --- | --- | --- |
| `GET` | `/health` | public |
| `POST` | `/auth/login` | public |
| `GET` | `/auth/oidc/login`, `/auth/oidc/callback` | public (when OIDC configured) |
| `POST` | `/auth/logout` | public |
| `GET` | `/api/me` | any authenticated member |
| `GET` | `/api/members` | manager, administrator |
| `POST` | `/api/members` | administrator |
| `PATCH` | `/api/members/:id/role` | administrator |
| `DELETE` | `/api/members/:id` | administrator |
| `GET` | `/api/projects` | any authenticated member |
| `POST` | `/api/projects` | manager, administrator |
| `PATCH` | `/api/projects/:id` | manager, administrator |
| `GET` | `/api/projects/:id/summary` | any authenticated member |
| `GET` | `/api/projects/:id/budget` | any authenticated member |
| `PUT` | `/api/projects/:id/budget` | manager, administrator |
| `DELETE` | `/api/projects/:id/budget` | manager, administrator |
| `GET` | `/api/rates` | manager, administrator |
| `PUT` | `/api/rates` | manager, administrator |
| `DELETE` | `/api/rates/:id` | manager, administrator |
| `GET` | `/api/audit` | administrator |
| `GET` | `/api/organisation` | any authenticated member |
| `PATCH` | `/api/organisation` | administrator |
| `GET` | `/api/fx/rates` | any authenticated member |
| `POST` | `/api/fx/refresh` | administrator |
| `GET` | `/api/exports/time-entries.csv` | manager, administrator |
| `PATCH` | `/api/me/feedback` | any authenticated member |
| `GET` | `/api/feedback` | administrator |
| `GET` | `/api/feedback/export` | administrator |
| `GET` | `/api/plane/connection` | any authenticated member |
| `PUT` | `/api/plane/connection` | any authenticated member |
| `DELETE` | `/api/plane/connection` | any authenticated member |
| `POST` | `/api/plane/sync` | any authenticated member |
| `GET` | `/api/plane/work-items` | any authenticated member |
| `POST` | `/api/plane/webhook/:secret` | public (secret path) |
| `GET` | `/api/timer` | any authenticated member |
| `POST` | `/api/timer/start` | any authenticated member |
| `POST` | `/api/timer/stop` | any authenticated member |
| `GET` | `/api/time-entries` | any authenticated member (own; managers all) |
| `POST` | `/api/time-entries` | any authenticated member |
| `PATCH` | `/api/time-entries/:id` | entry owner, manager, administrator |
| `DELETE` | `/api/time-entries/:id` | entry owner, manager, administrator |
| `GET` | `/api/time-entries/:id/history` | entry owner, manager, administrator |

Authenticate with `Authorization: Bearer <token>` from `/auth/login`, or the
`airtime_token` cookie set on sign-in. Every rate and budget change is written to
the audit log with actor and timestamp.

## Plane connection and sync

`PUT /api/plane/connection` takes `baseUrl`, `workspaceSlug` and a Plane personal
API token. The server verifies the token with a read-only Plane request, stores
the token encrypted with AES-256-GCM under `TOKEN_ENCRYPTION_KEY`, then syncs all
projects and work items visible to that token into the local cache. Airtime only
ever issues `GET` requests to Plane; it never writes back.

Every connection gets a unique webhook path (`webhookPath` in the connection
response). Register it in Plane to receive the fastest updates; a scheduler polls
each connection every `SYNC_POLL_SECONDS` (default 60) as a fallback for
installations without webhooks. `GET /api/plane/work-items` returns the open work
items, optionally filtered by `projectId` (add `includeClosed=true` for all).

`TOKEN_ENCRYPTION_KEY` is required to save a connection and must be 32 bytes as
64 hex characters. Losing it means stored Plane tokens cannot be decrypted and
must be re-entered.

## Scripts

```sh
npm run typecheck
npm run lint
npm run build
npm test          # integration tests; requires TEST_DATABASE_URL
```

The tests need a throwaway PostgreSQL database. For example:

```sh
docker run -d --name airtime-test-pg \
  -e POSTGRES_USER=airtime -e POSTGRES_PASSWORD=airtime -e POSTGRES_DB=airtime_test \
  -p 6010:5432 postgres:16-alpine
TEST_DATABASE_URL=postgres://airtime:airtime@localhost:6010/airtime_test npm test
```

## Licence

Airtime reuses Plane code and tokens and is therefore a derivative work of
Plane, which is licensed AGPL-3.0. Airtime is released under the
[GNU Affero General Public License v3.0](LICENSE) (`AGPL-3.0-only`).
Copyright (C) 2026 atakumi-global.
