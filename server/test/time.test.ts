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

async function createWorkItem(organisationId: string): Promise<{
  projectId: string;
  workItemId: string;
}> {
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
  return { projectId, workItemId: 'wi-1' };
}

test('starting a second timer stops the first and records it', async () => {
  const { organisationId, member } = await seed();
  await createWorkItem(organisationId);
  const token = await login(app, member.email, member.password);

  const first = await app.inject({
    method: 'POST',
    url: '/api/timer/start',
    headers: auth(token),
    payload: { workItemId: 'wi-1' },
  });
  assert.equal(first.statusCode, 201);

  const second = await app.inject({
    method: 'POST',
    url: '/api/timer/start',
    headers: auth(token),
    payload: { workItemId: 'wi-1', description: 'second' },
  });
  assert.equal(second.statusCode, 201);

  const entries = await app.inject({
    method: 'GET',
    url: '/api/time-entries',
    headers: auth(token),
  });
  assert.equal(entries.json().entries.length, 1);
  assert.equal(entries.json().entries[0].source, 'timer');
});

test('stopping a timer creates a billable entry with a 10 minute minimum', async () => {
  const { organisationId, member } = await seed();
  await createWorkItem(organisationId);
  const token = await login(app, member.email, member.password);

  await app.inject({
    method: 'POST',
    url: '/api/timer/start',
    headers: auth(token),
    payload: { workItemId: 'wi-1' },
  });
  const stopped = await app.inject({
    method: 'POST',
    url: '/api/timer/stop',
    headers: auth(token),
  });
  assert.equal(stopped.statusCode, 200);
  const entry = stopped.json().entry;
  assert.equal(entry.source, 'timer');
  assert.ok(entry.duration_minutes >= 1);
  assert.equal(entry.billable_minutes, 10);
  assert.ok(new Date(entry.ended_at) > new Date(entry.started_at));

  const running = await app.inject({
    method: 'GET',
    url: '/api/timer',
    headers: auth(token),
  });
  assert.equal(running.json().timer, null);

  const noTimer = await app.inject({
    method: 'POST',
    url: '/api/timer/stop',
    headers: auth(token),
  });
  assert.equal(noTimer.statusCode, 409);
});

test('a manual entry is stored and labelled manual', async () => {
  const { organisationId, member } = await seed();
  const { projectId } = await createWorkItem(organisationId);
  const token = await login(app, member.email, member.password);

  const response = await app.inject({
    method: 'POST',
    url: '/api/time-entries',
    headers: auth(token),
    payload: {
      workItemId: 'wi-1',
      date: '2026-09-20',
      durationMinutes: 30,
      description: 'back-fill',
    },
  });
  assert.equal(response.statusCode, 201);
  const entry = response.json().entry;
  assert.equal(entry.source, 'manual');
  assert.equal(entry.duration_minutes, 30);
  assert.equal(entry.billable_minutes, 30);
  assert.equal(entry.project_id, projectId);
});

test('invalid manual durations and reversed times are blocked', async () => {
  const { organisationId, member } = await seed();
  await createWorkItem(organisationId);
  const token = await login(app, member.email, member.password);

  const negative = await app.inject({
    method: 'POST',
    url: '/api/time-entries',
    headers: auth(token),
    payload: { workItemId: 'wi-1', date: '2026-09-20', durationMinutes: -5 },
  });
  assert.equal(negative.statusCode, 400);

  const reversed = await app.inject({
    method: 'POST',
    url: '/api/time-entries',
    headers: auth(token),
    payload: {
      workItemId: 'wi-1',
      startedAt: '2026-09-20T12:00:00.000Z',
      endedAt: '2026-09-20T11:00:00.000Z',
    },
  });
  assert.equal(reversed.statusCode, 400);
  assert.equal(reversed.json().error, 'end time must be after the start time');
});

test('editing an entry records the previous and new value with author and time', async () => {
  const { organisationId, member } = await seed();
  await createWorkItem(organisationId);
  const token = await login(app, member.email, member.password);

  const created = await app.inject({
    method: 'POST',
    url: '/api/time-entries',
    headers: auth(token),
    payload: { workItemId: 'wi-1', date: '2026-09-20', durationMinutes: 30 },
  });
  const entryId = created.json().entry.id;

  const updated = await app.inject({
    method: 'PATCH',
    url: `/api/time-entries/${entryId}`,
    headers: auth(token),
    payload: { durationMinutes: 45, description: 'corrected' },
  });
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.json().entry.duration_minutes, 45);

  const history = await app.inject({
    method: 'GET',
    url: `/api/time-entries/${entryId}/history`,
    headers: auth(token),
  });
  const events = history.json().history as {
    action: string;
    actor_member_id: string;
    before_state: { duration_minutes: number } | null;
    after_state: { duration_minutes: number } | null;
    created_at: string;
  }[];
  const edit = events.find((event) => event.action === 'updated');
  assert.ok(edit, 'expected an updated history event');
  assert.equal(edit.actor_member_id, member.id);
  assert.equal(edit.before_state?.duration_minutes, 30);
  assert.equal(edit.after_state?.duration_minutes, 45);
  assert.ok(edit.created_at);
});

test('deleting an entry records history and removes it from listings', async () => {
  const { organisationId, member } = await seed();
  await createWorkItem(organisationId);
  const token = await login(app, member.email, member.password);

  const created = await app.inject({
    method: 'POST',
    url: '/api/time-entries',
    headers: auth(token),
    payload: { workItemId: 'wi-1', date: '2026-09-20', durationMinutes: 30 },
  });
  const entryId = created.json().entry.id;

  const deleted = await app.inject({
    method: 'DELETE',
    url: `/api/time-entries/${entryId}`,
    headers: auth(token),
  });
  assert.equal(deleted.statusCode, 200);

  const listing = await app.inject({
    method: 'GET',
    url: '/api/time-entries',
    headers: auth(token),
  });
  assert.equal(listing.json().entries.length, 0);

  const history = await app.inject({
    method: 'GET',
    url: `/api/time-entries/${entryId}/history`,
    headers: auth(token),
  });
  assert.ok(
    history.json().history.some((event: { action: string }) => event.action === 'deleted'),
  );
});

test('a member cannot edit another member entry', async () => {
  const { organisationId, manager, member } = await seed();
  await createWorkItem(organisationId);
  const managerToken = await login(app, manager.email, manager.password);
  const memberToken = await login(app, member.email, member.password);

  const created = await app.inject({
    method: 'POST',
    url: '/api/time-entries',
    headers: auth(managerToken),
    payload: { workItemId: 'wi-1', date: '2026-09-20', durationMinutes: 30 },
  });
  const entryId = created.json().entry.id;

  const attempt = await app.inject({
    method: 'PATCH',
    url: `/api/time-entries/${entryId}`,
    headers: auth(memberToken),
    payload: { durationMinutes: 60 },
  });
  assert.equal(attempt.statusCode, 403);
});

test('a period with no entries returns an empty list', async () => {
  const { member } = await seed();
  const token = await login(app, member.email, member.password);

  const response = await app.inject({
    method: 'GET',
    url: '/api/time-entries?from=2026-01-01T00:00:00.000Z&to=2026-01-31T23:59:59.000Z',
    headers: auth(token),
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().entries, []);
});
