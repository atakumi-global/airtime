import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { hashMember } from '../src/services/feedback.js';
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

async function createWorkItem(organisationId: string): Promise<void> {
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
}

async function setOptIn(
  app: FastifyInstance,
  token: string,
  optIn: boolean,
): Promise<void> {
  const response = await app.inject({
    method: 'PATCH',
    url: '/api/me/feedback',
    headers: auth(token),
    payload: { optIn },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().member.feedbackOptIn, optIn);
}

async function createEntry(token: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/time-entries',
    headers: auth(token),
    payload: { workItemId: 'wi-1', durationMinutes: 30, description: 'secret note' },
  });
  assert.equal(response.statusCode, 201);
  return response.json().entry.id as string;
}

test('no feedback is written while a member is opted out', async () => {
  const { organisationId, member } = await seed();
  await createWorkItem(organisationId);
  const token = await login(app, member.email, member.password);
  await createEntry(token);

  const rows = await getDb().query('SELECT id FROM feedback_events');
  assert.equal(rows.length, 0);
});

test('opted-in creates, edits and deletes are stored anonymised with before and after', async () => {
  const { organisationId, member } = await seed();
  await createWorkItem(organisationId);
  const token = await login(app, member.email, member.password);
  await setOptIn(app, token, true);

  const entryId = await createEntry(token);
  await app.inject({
    method: 'PATCH',
    url: `/api/time-entries/${entryId}`,
    headers: auth(token),
    payload: { durationMinutes: 45 },
  });
  await app.inject({
    method: 'DELETE',
    url: `/api/time-entries/${entryId}`,
    headers: auth(token),
  });

  const rows = await getDb().query<{
    action: string;
    source: string;
    member_hash: string;
    before_state: Record<string, unknown> | null;
    after_state: Record<string, unknown> | null;
  }>('SELECT action, source, member_hash, before_state, after_state FROM feedback_events ORDER BY created_at ASC');

  assert.equal(rows.length, 3);
  assert.deepEqual(
    rows.map((row) => row.action),
    ['created', 'updated', 'deleted'],
  );
  assert.equal(rows[0]!.member_hash, hashMember(member.id, 'test-jwt-secret'));
  assert.notEqual(rows[0]!.member_hash, member.id);

  const created = rows[0]!;
  assert.equal(created.before_state, null);
  assert.equal(created.after_state?.source, 'manual');
  assert.equal(created.after_state?.duration_minutes, 30);
  assert.ok(!('member_id' in (created.after_state ?? {})));
  assert.ok(!('description' in (created.after_state ?? {})));
  assert.ok(!('id' in (created.after_state ?? {})));

  const updated = rows[1]!;
  assert.equal(updated.before_state?.duration_minutes, 30);
  assert.equal(updated.after_state?.duration_minutes, 45);

  const deleted = rows[2]!;
  assert.equal(deleted.after_state, null);
  assert.equal(deleted.before_state?.duration_minutes, 45);
});

test('opting out stops further feedback records', async () => {
  const { organisationId, member } = await seed();
  await createWorkItem(organisationId);
  const token = await login(app, member.email, member.password);
  await setOptIn(app, token, true);
  await createEntry(token);
  await setOptIn(app, token, false);
  await createEntry(token);

  const rows = await getDb().query('SELECT id FROM feedback_events');
  assert.equal(rows.length, 1);
});

test('an administrator can export the anonymised dataset', async () => {
  const { organisationId, admin, member } = await seed();
  await createWorkItem(organisationId);
  const memberToken = await login(app, member.email, member.password);
  const adminToken = await login(app, admin.email, admin.password);
  await setOptIn(app, memberToken, true);
  await createEntry(memberToken);

  const denied = await app.inject({
    method: 'GET',
    url: '/api/feedback/export',
    headers: auth(memberToken),
  });
  assert.equal(denied.statusCode, 403);

  const response = await app.inject({
    method: 'GET',
    url: '/api/feedback/export',
    headers: auth(adminToken),
  });
  assert.equal(response.statusCode, 200);
  const dataset = response.json().dataset as Record<string, unknown>[];
  assert.equal(dataset.length, 1);
  assert.ok(!JSON.stringify(dataset).includes(member.id));
  assert.ok(!JSON.stringify(dataset).includes('secret note'));
  assert.equal(dataset[0]!.action, 'created');
});
