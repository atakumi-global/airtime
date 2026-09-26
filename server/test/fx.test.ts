import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import {
  auth,
  getDb,
  login,
  makeApp,
  resetData,
  seed,
  setupSchema,
  testConfig,
} from './helpers.js';

let app: FastifyInstance;
let fxServer: Server;
let fxDate = new Date().toISOString().slice(0, 10);
let failing = false;

before(async () => {
  await setupSchema();
  fxServer = createServer((_request, response) => {
    if (failing) {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'boom' }));
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        amount: 1,
        base: 'EUR',
        date: fxDate,
        rates: { USD: 1.2, GBP: 0.8 },
      }),
    );
  });
  await new Promise<void>((resolve) => fxServer.listen(0, resolve));
  testConfig.fxProviderUrl = `http://127.0.0.1:${(fxServer.address() as AddressInfo).port}/latest`;
  app = await makeApp();
});

beforeEach(async () => {
  await resetData();
  failing = false;
  fxDate = new Date().toISOString().slice(0, 10);
});

after(async () => {
  await app.close();
  await new Promise<void>((resolve) => fxServer.close(() => resolve()));
  await getDb().close();
});

async function createProjectWithWorkItem(organisationId: string): Promise<string> {
  const db = getDb();
  const projectId = randomUUID();
  await db.query(
    `INSERT INTO projects (id, organisation_id, plane_project_id, name, identifier)
     VALUES ($1, $2, 'plane-p1', 'Website', 'WEB')`,
    [projectId, organisationId],
  );
  await db.query(
    `INSERT INTO work_items
       (id, organisation_id, project_id, plane_work_item_id, identifier, name, is_open)
     VALUES ($1, $2, $3, 'wi-1', 'WEB-1', 'Fix login', true)`,
    [randomUUID(), organisationId, projectId],
  );
  return projectId;
}

async function refresh(token: string): Promise<void> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/fx/refresh',
    headers: auth(token),
  });
  assert.equal(response.statusCode, 200);
}

test('refreshing stores the daily rates and reports them', async () => {
  const { admin } = await seed();
  const token = await login(app, admin.email, admin.password);
  await refresh(token);

  const response = await app.inject({
    method: 'GET',
    url: '/api/fx/rates',
    headers: auth(token),
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().base, 'EUR');
  assert.equal(response.json().date, fxDate);
  assert.equal(response.json().stale, false);
  assert.equal(response.json().rates.USD, 1.2);
  assert.equal(response.json().rates.GBP, 0.8);
});

test('a member cannot trigger an FX refresh', async () => {
  const { member } = await seed();
  const token = await login(app, member.email, member.password);
  const response = await app.inject({
    method: 'POST',
    url: '/api/fx/refresh',
    headers: auth(token),
  });
  assert.equal(response.statusCode, 403);
});

test('totals convert to the reporting currency and expose the rate and date', async () => {
  const { organisationId, admin } = await seed();
  const projectId = await createProjectWithWorkItem(organisationId);
  const token = await login(app, admin.email, admin.password);
  await refresh(token);

  await app.inject({
    method: 'PUT',
    url: '/api/rates',
    headers: auth(token),
    payload: {
      scope: 'project',
      projectId,
      currency: 'GBP',
      hourlyAmount: 100,
    },
  });
  await app.inject({
    method: 'POST',
    url: '/api/time-entries',
    headers: auth(token),
    payload: { workItemId: 'wi-1', durationMinutes: 60 },
  });
  await app.inject({
    method: 'PUT',
    url: `/api/projects/${projectId}/budget`,
    headers: auth(token),
    payload: { amount: 200, currency: 'USD' },
  });

  const response = await app.inject({
    method: 'GET',
    url: `/api/projects/${projectId}/summary`,
    headers: auth(token),
  });
  const summary = response.json().summary;
  assert.equal(summary.currency, 'USD');
  assert.equal(summary.spent, 150);
  assert.equal(summary.convertedBudget, 200);
  assert.equal(summary.remaining, 50);
  assert.equal(summary.percentUsed, 75);
  assert.equal(summary.currencyTotals.GBP, 100);
  assert.equal(summary.conversions.GBP.rate, 1.5);
  assert.equal(summary.conversions.GBP.date, fxDate);
  assert.equal(summary.conversions.GBP.stale, false);
  assert.equal(summary.fxStale, false);
});

test('an unreachable provider keeps the last rates and marks them stale', async () => {
  const { organisationId, admin } = await seed();
  const projectId = await createProjectWithWorkItem(organisationId);
  const token = await login(app, admin.email, admin.password);
  fxDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await refresh(token);

  await app.inject({
    method: 'PUT',
    url: '/api/rates',
    headers: auth(token),
    payload: { scope: 'project', projectId, currency: 'GBP', hourlyAmount: 100 },
  });
  await app.inject({
    method: 'POST',
    url: '/api/time-entries',
    headers: auth(token),
    payload: { workItemId: 'wi-1', durationMinutes: 60 },
  });

  failing = true;
  const failed = await app.inject({
    method: 'POST',
    url: '/api/fx/refresh',
    headers: auth(token),
  });
  assert.equal(failed.statusCode, 502);

  const response = await app.inject({
    method: 'GET',
    url: `/api/projects/${projectId}/summary`,
    headers: auth(token),
  });
  const summary = response.json().summary;
  assert.equal(summary.fxStale, true);
  assert.equal(summary.conversions.GBP.stale, true);
  assert.equal(summary.spent, 150);
});

test('an admin can change the reporting currency, a member cannot', async () => {
  const { admin, member } = await seed();
  const adminToken = await login(app, admin.email, admin.password);
  const memberToken = await login(app, member.email, member.password);

  const denied = await app.inject({
    method: 'PATCH',
    url: '/api/organisation',
    headers: auth(memberToken),
    payload: { reportingCurrency: 'EUR' },
  });
  assert.equal(denied.statusCode, 403);

  const updated = await app.inject({
    method: 'PATCH',
    url: '/api/organisation',
    headers: auth(adminToken),
    payload: { reportingCurrency: 'EUR' },
  });
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.json().organisation.reportingCurrency, 'EUR');
});
