# Airtime

Time tracking and budget management for self-hosted [Plane](https://plane.so).
Airtime reads projects and work items from Plane with a per-user API token and
adds time-and-materials budgets, rates, burn and export on top, without changing
Plane.

This repository currently contains the **Airtime server** (work item `AIRTIME-3`,
release v1.1): the service that owns shared state - accounts, roles, projects,
rates, budgets and time entries - plus its PostgreSQL schema, OIDC/local sign-in,
role-based access control, financial audit log and Docker deployment. The Windows
desktop client and the Plane sync land in later work items (`AIRTIME-4`, `AIRTIME-9`).

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
| `GET` | `/api/projects/:id/budget` | any authenticated member |
| `PUT` | `/api/projects/:id/budget` | manager, administrator |
| `DELETE` | `/api/projects/:id/budget` | manager, administrator |
| `GET` | `/api/rates` | manager, administrator |
| `PUT` | `/api/rates` | manager, administrator |
| `DELETE` | `/api/rates/:id` | manager, administrator |
| `GET` | `/api/audit` | administrator |

Authenticate with `Authorization: Bearer <token>` from `/auth/login`, or the
`airtime_token` cookie set on sign-in. Every rate and budget change is written to
the audit log with actor and timestamp.

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
