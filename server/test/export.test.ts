import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { auth, getDb, login, makeApp, resetData, seed, setupSchema } from './helpers.js';

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

async function createProjectState(
  organisationId: string,
  suffix: string,
): Promise<{ projectId: string; workItemId: string }> {
  const db = getDb();
  const projectId = randomUUID();
  const workItemId = `wi-${suffix}`;
  await db.query(
    `INSERT INTO projects (id, organisation_id, plane_project_id, name, identifier)
     VALUES ($1, $2, $3, $4, $5)`,
    [projectId, organisationId, `plane-${suffix}`, `Project ${suffix}`, suffix.toUpperCase()],
  );
  await db.query(
    `INSERT INTO work_items
       (id, organisation_id, project_id, plane_work_item_id, identifier, name, is_open)
     VALUES ($1, $2, $3, $4, $5, $6, true)`,
    [
      randomUUID(),
      organisationId,
      projectId,
      workItemId,
      `${suffix.toUpperCase()}-1`,
      'Fix login',
    ],
  );
  return { projectId, workItemId };
}

test('a manager can export filtered time entries as CSV', async () => {
  const { organisationId, manager, member } = await seed();
  const a = await createProjectState(organisationId, 'a');
  const memberToken = await login(app, member.email, member.password);
  const managerToken = await login(app, manager.email, manager.password);

  await app.inject({
    method: 'PUT',
    url: '/api/rates',
    headers: auth(managerToken),
    payload: {
      scope: 'project',
      projectId: a.projectId,
      currency: 'USD',
      hourlyAmount: 60,
    },
  });

  const entry = await app.inject({
    method: 'POST',
    url: '/api/time-entries',
    headers: auth(memberToken),
    payload: {
      workItemId: a.workItemId,
      durationMinutes: 60,
      description: 'Fix "login", again',
    },
  });
  assert.equal(entry.statusCode, 201);

  const response = await app.inject({
    method: 'GET',
    url: `/api/exports/time-entries.csv?projectId=${a.projectId}`,
    headers: auth(managerToken),
  });
  assert.equal(response.statusCode, 200);
  assert.match(response.headers['content-type'] as string, /text\/csv/);
  assert.match(
    response.headers['content-disposition'] as string,
    /attachment; filename="airtime-time-entries.csv"/,
  );

  const body = response.body;
  assert.ok(body.startsWith('\uFEFF'), 'expected a UTF-8 BOM for Excel');
  assert.ok(body.includes('\r\n'), 'expected CRLF line endings');

  const lines = body.replace(/^\uFEFF/, '').split('\r\n').filter(Boolean);
  assert.equal(lines.length, 2, 'header plus one entry row');
  assert.equal(
    lines[0],
    'project,member,date,duration_minutes,billable_minutes,work_item,description,source,rate,currency,cost,cost_reporting_currency,reporting_currency,fx_rate,fx_date,fx_stale',
  );
  assert.ok(lines[1]!.startsWith('Project a,Member,'));
  assert.ok(lines[1]!.includes(',60,60,A-1,"Fix ""login"", again",manual,60,USD,60,60,USD,1,,false'));
});

test('CSV filtering by project excludes other projects', async () => {
  const { organisationId, manager, member } = await seed();
  const a = await createProjectState(organisationId, 'a');
  const b = await createProjectState(organisationId, 'b');
  const memberToken = await login(app, member.email, member.password);
  const managerToken = await login(app, manager.email, manager.password);

  for (const workItemId of [a.workItemId, b.workItemId]) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/time-entries',
      headers: auth(memberToken),
      payload: { workItemId, durationMinutes: 30 },
    });
    assert.equal(response.statusCode, 201);
  }

  const all = await app.inject({
    method: 'GET',
    url: '/api/exports/time-entries.csv',
    headers: auth(managerToken),
  });
  assert.equal(all.body.replace(/^\uFEFF/, '').split('\r\n').filter(Boolean).length, 3);

  const filtered = await app.inject({
    method: 'GET',
    url: `/api/exports/time-entries.csv?projectId=${b.projectId}`,
    headers: auth(managerToken),
  });
  const lines = filtered.body.replace(/^\uFEFF/, '').split('\r\n').filter(Boolean);
  assert.equal(lines.length, 2);
  assert.ok(lines[1]!.startsWith('Project b,'));
});

test('a member cannot export CSV', async () => {
  const { member } = await seed();
  const token = await login(app, member.email, member.password);
  const response = await app.inject({
    method: 'GET',
    url: '/api/exports/time-entries.csv',
    headers: auth(token),
  });
  assert.equal(response.statusCode, 403);
});
