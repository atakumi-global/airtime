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
} from './helpers.js';

let app: FastifyInstance;

before(async () => {
  await setupSchema();
  app = await makeApp();
});

beforeEach(async () => {
  await resetData();
});

after(async () => {
  await app.close();
  await getDb().close();
});

test('GET /health reports the database is reachable', async () => {
  const response = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: 'ok', database: 'up' });
});

test('the desktop webview origin is allowed by CORS', async () => {
  const preflight = await app.inject({
    method: 'OPTIONS',
    url: '/auth/login',
    headers: {
      origin: 'http://tauri.localhost',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type,authorization',
    },
  });
  assert.equal(preflight.statusCode, 204);
  assert.equal(
    preflight.headers['access-control-allow-origin'],
    'http://tauri.localhost',
  );

  const request = await app.inject({
    method: 'GET',
    url: '/health',
    headers: { origin: 'http://tauri.localhost' },
  });
  assert.equal(request.headers['access-control-allow-origin'], 'http://tauri.localhost');
});

test('an unknown browser origin is not granted CORS access', async () => {
  const response = await app.inject({
    method: 'GET',
    url: '/health',
    headers: { origin: 'https://evil.example' },
  });
  assert.equal(response.headers['access-control-allow-origin'], undefined);
});

test('GET / describes the service instead of returning a bare 404', async () => {
  const response = await app.inject({ method: 'GET', url: '/' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().name, 'Airtime server');
  assert.equal(response.json().health, '/health');
  assert.equal(response.json().endpoints.login, '/auth/login');
});

test('local sign-in succeeds with valid credentials and fails otherwise', async () => {
  const { admin } = await seed();

  const ok = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: admin.email, password: admin.password },
  });
  assert.equal(ok.statusCode, 200);
  assert.ok(ok.json().token);
  assert.equal(ok.json().member.role, 'administrator');

  const bad = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: admin.email, password: 'wrong-password' },
  });
  assert.equal(bad.statusCode, 401);
});

test('a member calling a manager or admin endpoint receives 403', async () => {
  const { member } = await seed();
  const token = await login(app, member.email, member.password);

  const managerEndpoint = await app.inject({
    method: 'GET',
    url: '/api/members',
    headers: auth(token),
  });
  assert.equal(managerEndpoint.statusCode, 403);

  const adminEndpoint = await app.inject({
    method: 'GET',
    url: '/api/audit',
    headers: auth(token),
  });
  assert.equal(adminEndpoint.statusCode, 403);
});

test('a manager changing a rate writes an audit record', async () => {
  const { admin, manager, member } = await seed();
  const managerToken = await login(app, manager.email, manager.password);

  const rate = await app.inject({
    method: 'PUT',
    url: '/api/rates',
    headers: auth(managerToken),
    payload: {
      scope: 'member',
      memberId: member.id,
      currency: 'usd',
      hourlyAmount: 120,
    },
  });
  assert.equal(rate.statusCode, 200);
  assert.equal(rate.json().rate.currency, 'USD');

  const adminToken = await login(app, admin.email, admin.password);
  const audit = await app.inject({
    method: 'GET',
    url: '/api/audit',
    headers: auth(adminToken),
  });
  assert.equal(audit.statusCode, 200);
  const entry = audit
    .json()
    .entries.find(
      (item: { action: string }) => item.action === 'rate.created',
    );
  assert.ok(entry, 'expected a rate.created audit entry');
  assert.equal(entry.actor_member_id, manager.id);
  assert.ok(entry.created_at);
});

test('a manager changing a budget writes an audit record', async () => {
  const { admin, manager } = await seed();
  const managerToken = await login(app, manager.email, manager.password);

  const project = await app.inject({
    method: 'POST',
    url: '/api/projects',
    headers: auth(managerToken),
    payload: { name: 'Website rebuild' },
  });
  assert.equal(project.statusCode, 201);
  const projectId = project.json().project.id;

  const budget = await app.inject({
    method: 'PUT',
    url: `/api/projects/${projectId}/budget`,
    headers: auth(managerToken),
    payload: {
      amount: 10000,
      currency: 'eur',
      price: 20000,
      profitTargetPercent: 35,
      marginTargetAmount: 4000,
    },
  });
  assert.equal(budget.statusCode, 200);
  assert.equal(budget.json().budget.amount, '10000.00');
  assert.equal(budget.json().budget.price, '20000.00');
  assert.equal(budget.json().budget.profit_target_percent, '35.0000');
  assert.equal(budget.json().budget.margin_target_amount, '4000.00');

  const invalid = await app.inject({
    method: 'PUT',
    url: `/api/projects/${projectId}/budget`,
    headers: auth(managerToken),
    payload: { amount: 10000, currency: 'eur', profitTargetPercent: 101 },
  });
  assert.equal(invalid.statusCode, 400);

  const adminToken = await login(app, admin.email, admin.password);
  const audit = await app.inject({
    method: 'GET',
    url: '/api/audit',
    headers: auth(adminToken),
  });
  const entry = audit
    .json()
    .entries.find(
      (item: { action: string }) => item.action === 'budget.created',
    );
  assert.ok(entry, 'expected a budget.created audit entry');
  assert.equal(entry.after_state.project_id, projectId);
});

test('removing a member blocks sign-in and keeps their entries', async () => {
  const { admin, member } = await seed();
  const memberToken = await login(app, member.email, member.password);

  const db = getDb();
  await db.query(
    `INSERT INTO time_entries
       (id, organisation_id, project_id, member_id, work_item_id, source,
        started_at, ended_at, duration_minutes, billable_minutes)
     VALUES ($1, $2, NULL, $3, 'wi-1', 'manual', now(), now(), 10, 10)`,
    [randomUUID(), (await db.query('SELECT id FROM organisations LIMIT 1'))[0]!.id, member.id],
  );

  const adminToken = await login(app, admin.email, admin.password);
  const removed = await app.inject({
    method: 'DELETE',
    url: `/api/members/${member.id}`,
    headers: auth(adminToken),
  });
  assert.equal(removed.statusCode, 200);
  assert.equal(removed.json().member.status, 'removed');

  const relogin = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: member.email, password: member.password },
  });
  assert.equal(relogin.statusCode, 401);

  const staleToken = await app.inject({
    method: 'GET',
    url: '/api/me',
    headers: auth(memberToken),
  });
  assert.equal(staleToken.statusCode, 401);

  const remaining = await db.query(
    'SELECT count(*)::int AS count FROM time_entries WHERE member_id = $1',
    [member.id],
  );
  assert.equal(remaining[0]!.count, 1);
});

test('OIDC routes report not configured when no provider is set', async () => {
  const response = await app.inject({ method: 'GET', url: '/auth/oidc/login' });
  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error, 'oidc_not_configured');
});
