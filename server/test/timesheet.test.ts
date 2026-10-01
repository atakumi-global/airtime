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

async function createProject(organisationId: string): Promise<string> {
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

async function setRate(
  token: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const response = await app.inject({
    method: 'PUT',
    url: '/api/rates',
    headers: auth(token),
    payload,
  });
  assert.equal(response.statusCode, 200);
}

async function addEntryAt(
  token: string,
  startedAt: string,
  endedAt: string,
): Promise<void> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/time-entries',
    headers: auth(token),
    payload: { workItemId: 'wi-1', startedAt, endedAt },
  });
  assert.equal(response.statusCode, 201);
}

async function summary(
  token: string,
  query: string,
): Promise<{
  entries: Array<Record<string, unknown>>;
  totals: Record<string, unknown>;
}> {
  const response = await app.inject({
    method: 'GET',
    url: `/api/time-entries/summary?${query}`,
    headers: auth(token),
  });
  assert.equal(response.statusCode, 200);
  return response.json();
}

test('range totals include only the period and cost each entry', async () => {
  const { organisationId, admin, member } = await seed();
  const projectId = await createProject(organisationId);
  const adminToken = await login(app, admin.email, admin.password);
  const memberToken = await login(app, member.email, member.password);
  await setRate(adminToken, {
    scope: 'project',
    projectId,
    currency: 'USD',
    hourlyAmount: 75,
  });

  await addEntryAt(
    memberToken,
    '2026-09-21T09:00:00.000Z',
    '2026-09-21T10:00:00.000Z',
  );
  await addEntryAt(
    memberToken,
    '2026-09-22T09:00:00.000Z',
    '2026-09-22T09:30:00.000Z',
  );
  await addEntryAt(
    memberToken,
    '2026-09-28T09:00:00.000Z',
    '2026-09-28T10:00:00.000Z',
  );

  const result = await summary(
    memberToken,
    'from=2026-09-21T00:00:00.000Z&to=2026-09-28T00:00:00.000Z',
  );

  assert.equal(result.entries.length, 2);
  assert.equal(result.totals.entryCount, 2);
  assert.equal(result.totals.totalMinutes, 90);
  assert.equal(result.totals.billableMinutes, 90);
  assert.equal(result.totals.cost, 112.5);
  assert.equal(result.totals.currency, 'USD');
  assert.equal(result.entries[0].cost_uncosted, false);
  assert.equal(result.entries[0].cost_currency, 'USD');
});

test('uncosted entries are counted separately and left out of the cost', async () => {
  const { organisationId, member } = await seed();
  await createProject(organisationId);
  const memberToken = await login(app, member.email, member.password);

  await addEntryAt(
    memberToken,
    '2026-09-21T09:00:00.000Z',
    '2026-09-21T10:00:00.000Z',
  );

  const result = await summary(
    memberToken,
    'from=2026-09-21T00:00:00.000Z&to=2026-09-28T00:00:00.000Z',
  );

  assert.equal(result.totals.cost, 0);
  assert.deepEqual(result.totals.uncosted, { entries: 1, minutes: 60 });
  assert.equal(result.entries[0].cost, null);
  assert.equal(result.entries[0].cost_uncosted, true);
});

test('a member sees their own entries and a manager can name a member', async () => {
  const { organisationId, admin, manager, member } = await seed();
  await createProject(organisationId);
  const memberToken = await login(app, member.email, member.password);
  const managerToken = await login(app, manager.email, manager.password);
  const adminToken = await login(app, admin.email, admin.password);

  await addEntryAt(
    memberToken,
    '2026-09-21T09:00:00.000Z',
    '2026-09-21T10:00:00.000Z',
  );
  await addEntryAt(
    managerToken,
    '2026-09-21T11:00:00.000Z',
    '2026-09-21T12:00:00.000Z',
  );

  const own = await summary(
    memberToken,
    'from=2026-09-21T00:00:00.000Z&to=2026-09-28T00:00:00.000Z',
  );
  assert.equal(own.entries.length, 1);
  assert.equal(own.totals.totalMinutes, 60);

  const all = await summary(
    adminToken,
    'from=2026-09-21T00:00:00.000Z&to=2026-09-28T00:00:00.000Z',
  );
  assert.equal(all.entries.length, 2);

  const named = await summary(
    managerToken,
    `memberId=${member.id}&from=2026-09-21T00:00:00.000Z&to=2026-09-28T00:00:00.000Z`,
  );
  assert.equal(named.entries.length, 1);
  assert.equal(named.entries[0].member_id, member.id);
});

test('an empty period returns no entries and zero totals', async () => {
  const { member } = await seed();
  const memberToken = await login(app, member.email, member.password);

  const result = await summary(
    memberToken,
    'from=2026-01-01T00:00:00.000Z&to=2026-01-08T00:00:00.000Z',
  );

  assert.deepEqual(result.entries, []);
  assert.equal(result.totals.entryCount, 0);
  assert.equal(result.totals.totalMinutes, 0);
  assert.equal(result.totals.cost, 0);
});
