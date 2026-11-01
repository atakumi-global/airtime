import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { auth, getDb, login, makeApp, resetData, seed, setupSchema, grantProjectAccess } from './helpers.js';

let app: FastifyInstance;
const today = new Date().toISOString().slice(0, 10);

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

async function seedFx(): Promise<void> {
  const db = getDb();
  // EUR base: 1 EUR = 1.2 USD = 0.8 GBP, so 1 GBP = 1.5 USD.
  await db.query(
    `INSERT INTO fx_rates (currency, rate_date, eur_rate) VALUES ('USD', $1, 1.2), ('GBP', $1, 0.8)`,
    [today],
  );
}

async function createProject(
  organisationId: string,
  suffix = 'a',
): Promise<{ projectId: string; workItemId: string }> {
  const db = getDb();
  const projectId = randomUUID();
  const workItemId = `wi-${suffix}`;
  await db.query(
    `INSERT INTO projects (id, organisation_id, plane_project_id, name, identifier)
     VALUES ($1, $2, $3, $4, $5)`,
    [projectId, organisationId, `plane-${suffix}`, `Project ${suffix}`, suffix.toUpperCase()],
  );
  await grantProjectAccess(organisationId, projectId);
  await db.query(
    `INSERT INTO work_items
       (id, organisation_id, project_id, plane_work_item_id, identifier, name, is_open)
     VALUES ($1, $2, $3, $4, $5, 'Task', true)`,
    [randomUUID(), organisationId, projectId, workItemId, `${suffix.toUpperCase()}-1`],
  );
  return { projectId, workItemId };
}

async function summary(token: string, projectId: string) {
  const response = await app.inject({
    method: 'GET',
    url: `/api/projects/${projectId}/summary`,
    headers: auth(token),
  });
  assert.equal(response.statusCode, 200);
  return response.json().summary;
}

test('adding an expense updates cost and remaining budget immediately', async () => {
  const { organisationId, manager } = await seed();
  const { projectId } = await createProject(organisationId);
  const token = await login(app, manager.email, manager.password);

  await app.inject({
    method: 'PUT',
    url: `/api/projects/${projectId}/budget`,
    headers: auth(token),
    payload: { amount: 1000, currency: 'USD', price: 1500 },
  });
  const before = await summary(token, projectId);
  assert.equal(before.spent, 0);
  assert.equal(before.remaining, 1000);

  const created = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/expenses`,
    headers: auth(token),
    payload: {
      date: today,
      amount: 250,
      currency: 'USD',
      category: 'licences',
      note: 'Design tool seats',
    },
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().expense.category, 'licences');

  const after = await summary(token, projectId);
  assert.equal(after.spent, 250);
  assert.equal(after.labourCost, 0);
  assert.equal(after.expenses.total, 250);
  assert.equal(after.expenses.count, 1);
  assert.equal(after.expenses.byCategory.licences, 250);
  assert.equal(after.remaining, 750);
  assert.equal(after.margin, 750);
  assert.equal(after.profit, 1250);
  assert.equal(after.percentUsed, 25);
});

test('expenses add to labour cost in the project list summary', async () => {
  const { organisationId, manager } = await seed();
  const { projectId } = await createProject(organisationId);
  const token = await login(app, manager.email, manager.password);
  await app.inject({
    method: 'PUT',
    url: `/api/projects/${projectId}/budget`,
    headers: auth(token),
    payload: { amount: 500, currency: 'USD' },
  });
  await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/expenses`,
    headers: auth(token),
    payload: { date: today, amount: 100, currency: 'USD', category: 'travel' },
  });
  const list = await app.inject({
    method: 'GET',
    url: '/api/projects?withBudget=true',
    headers: auth(token),
  });
  assert.equal(list.statusCode, 200);
  const project = list.json().projects.find((p: { id: string }) => p.id === projectId);
  assert.equal(project.summary.spent, 100);
  assert.equal(project.summary.remaining, 400);
});

test('a foreign currency expense converts with the rate and date recorded', async () => {
  const { organisationId, manager } = await seed();
  const { projectId } = await createProject(organisationId);
  const token = await login(app, manager.email, manager.password);
  await seedFx();
  await app.inject({
    method: 'PUT',
    url: `/api/projects/${projectId}/budget`,
    headers: auth(token),
    payload: { amount: 1000, currency: 'USD' },
  });

  const created = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/expenses`,
    headers: auth(token),
    payload: { date: today, amount: 100, currency: 'gbp', category: 'hardware' },
  });
  assert.equal(created.statusCode, 201);
  const expense = created.json().expense;
  assert.equal(expense.currency, 'GBP');
  assert.equal(expense.reporting_currency, 'USD');
  assert.equal(Number(expense.amount_reporting), 150);
  assert.equal(Number(expense.fx_rate), 1.5);
  assert.equal(String(expense.fx_date).slice(0, 10), today);

  // The recorded snapshot is kept when later rates differ.
  await getDb().query(`UPDATE fx_rates SET eur_rate = 0.5 WHERE currency = 'GBP'`);
  const result = await summary(token, projectId);
  assert.equal(result.spent, 150);
  assert.equal(result.expenses.currencyTotals.GBP, 100);
  assert.equal(result.remaining, 850);
});

test('a foreign currency expense without an available rate is rejected', async () => {
  const { organisationId, manager } = await seed();
  const { projectId } = await createProject(organisationId);
  const token = await login(app, manager.email, manager.password);
  const response = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/expenses`,
    headers: auth(token),
    payload: { date: today, amount: 10, currency: 'GBP', category: 'other' },
  });
  assert.equal(response.statusCode, 422);
  assert.equal(response.json().error, 'fx_rate_unavailable');
});

test('edit and delete keep history with before, after, author and timestamp', async () => {
  const { organisationId, manager, admin } = await seed();
  const { projectId } = await createProject(organisationId);
  const managerToken = await login(app, manager.email, manager.password);
  const adminToken = await login(app, admin.email, admin.password);

  const created = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/expenses`,
    headers: auth(managerToken),
    payload: { date: today, amount: 80, currency: 'USD', category: 'travel', note: 'Train' },
  });
  const id = created.json().expense.id as string;

  const edited = await app.inject({
    method: 'PATCH',
    url: `/api/expenses/${id}`,
    headers: auth(adminToken),
    payload: { amount: 120, note: 'Train and taxi' },
  });
  assert.equal(edited.statusCode, 200);
  assert.equal(Number(edited.json().expense.amount), 120);
  assert.equal(Number(edited.json().expense.amount_reporting), 120);

  const removed = await app.inject({
    method: 'DELETE',
    url: `/api/expenses/${id}`,
    headers: auth(managerToken),
  });
  assert.equal(removed.statusCode, 200);

  const history = await app.inject({
    method: 'GET',
    url: `/api/expenses/${id}/history`,
    headers: auth(managerToken),
  });
  assert.equal(history.statusCode, 200);
  const events = history.json().history as Array<{
    action: string;
    actor_member_id: string;
    before_state: { amount: string; note: string } | null;
    after_state: { amount: string; note: string } | null;
    created_at: string;
  }>;
  assert.deepEqual(
    events.map((event) => event.action),
    ['expense.created', 'expense.updated', 'expense.deleted'],
  );
  assert.equal(events[0]!.before_state, null);
  assert.equal(events[0]!.actor_member_id, manager.id);
  assert.equal(events[1]!.actor_member_id, admin.id);
  assert.equal(Number(events[1]!.before_state!.amount), 80);
  assert.equal(events[1]!.before_state!.note, 'Train');
  assert.equal(Number(events[1]!.after_state!.amount), 120);
  assert.equal(events[1]!.after_state!.note, 'Train and taxi');
  assert.equal(events[2]!.actor_member_id, manager.id);
  assert.equal(Number(events[2]!.before_state!.amount), 120);
  assert.ok(events.every((event) => !Number.isNaN(Date.parse(event.created_at))));

  // The deleted expense no longer counts and can not be edited.
  const state = await summary(managerToken, projectId);
  assert.equal(state.spent, 0);
  const again = await app.inject({
    method: 'PATCH',
    url: `/api/expenses/${id}`,
    headers: auth(managerToken),
    payload: { amount: 5 },
  });
  assert.equal(again.statusCode, 404);
});

test('the export includes expenses with category and cost', async () => {
  const { organisationId, manager } = await seed();
  const { projectId } = await createProject(organisationId);
  const other = await createProject(organisationId, 'b');
  const token = await login(app, manager.email, manager.password);
  await seedFx();

  for (const [project, amount, currency, category, note] of [
    [projectId, 100, 'GBP', 'hardware', '=cmd()'],
    [projectId, 40, 'USD', 'travel', 'Taxi'],
    [other.projectId, 9, 'USD', 'other', 'Elsewhere'],
  ] as const) {
    const response = await app.inject({
      method: 'POST',
      url: `/api/projects/${project}/expenses`,
      headers: auth(token),
      payload: { date: today, amount, currency, category, note },
    });
    assert.equal(response.statusCode, 201);
  }

  const response = await app.inject({
    method: 'GET',
    url: `/api/exports/time-entries.csv?projectId=${projectId}&from=${today}T00:00:00.000Z&to=${today}T23:59:59.999Z`,
    headers: auth(token),
  });
  assert.equal(response.statusCode, 200);
  const lines = response.body.replace(/^\uFEFF/, '').split('\r\n').filter(Boolean);
  assert.equal(lines.length, 3);
  assert.ok(lines[0]!.endsWith(',type,category,workspace'));
  const gbp = lines.find((line) => line.includes('hardware'))!;
  assert.ok(gbp.startsWith(`Project a,Manager,${today},,,,'=cmd(),expense,,GBP,100,150,USD,1.5,${today},false,expense,hardware,`));
  const usd = lines.find((line) => line.includes('travel'))!;
  assert.ok(usd.includes(',expense,,USD,40,40,USD,1,'));
  assert.ok(!response.body.includes('Elsewhere'));

  const outside = await app.inject({
    method: 'GET',
    url: `/api/exports/time-entries.csv?from=2000-01-01T00:00:00.000Z&to=2000-01-31T00:00:00.000Z`,
    headers: auth(token),
  });
  assert.equal(outside.body.replace(/^\uFEFF/, '').split('\r\n').filter(Boolean).length, 1);
});

test('members can read expenses but not change them', async () => {
  const { organisationId, manager, member } = await seed();
  const { projectId } = await createProject(organisationId);
  const managerToken = await login(app, manager.email, manager.password);
  const memberToken = await login(app, member.email, member.password);
  const created = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/expenses`,
    headers: auth(managerToken),
    payload: { date: today, amount: 10, currency: 'USD', category: 'other' },
  });
  const id = created.json().expense.id as string;

  const read = await app.inject({
    method: 'GET',
    url: `/api/projects/${projectId}/expenses`,
    headers: auth(memberToken),
  });
  assert.equal(read.statusCode, 200);
  assert.equal(read.json().expenses.length, 1);

  const post = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/expenses`,
    headers: auth(memberToken),
    payload: { date: today, amount: 10, currency: 'USD', category: 'other' },
  });
  assert.equal(post.statusCode, 403);
  const patch = await app.inject({
    method: 'PATCH',
    url: `/api/expenses/${id}`,
    headers: auth(memberToken),
    payload: { amount: 1 },
  });
  assert.equal(patch.statusCode, 403);
  const del = await app.inject({
    method: 'DELETE',
    url: `/api/expenses/${id}`,
    headers: auth(memberToken),
  });
  assert.equal(del.statusCode, 403);
  const history = await app.inject({
    method: 'GET',
    url: `/api/expenses/${id}/history`,
    headers: auth(memberToken),
  });
  assert.equal(history.statusCode, 403);
  const unauthenticated = await app.inject({ method: 'GET', url: '/api/expenses' });
  assert.equal(unauthenticated.statusCode, 401);
});

test('expenses attach to a work item of the same project only and validate input', async () => {
  const { organisationId, manager } = await seed();
  const a = await createProject(organisationId);
  const b = await createProject(organisationId, 'b');
  const token = await login(app, manager.email, manager.password);
  const base = { date: today, amount: 10, currency: 'USD', category: 'other' };

  const ok = await app.inject({
    method: 'POST',
    url: `/api/projects/${a.projectId}/expenses`,
    headers: auth(token),
    payload: { ...base, workItemId: a.workItemId },
  });
  assert.equal(ok.statusCode, 201);
  assert.equal(ok.json().expense.work_item_id, a.workItemId);

  const wrong = await app.inject({
    method: 'POST',
    url: `/api/projects/${a.projectId}/expenses`,
    headers: auth(token),
    payload: { ...base, workItemId: b.workItemId },
  });
  assert.equal(wrong.statusCode, 400);

  for (const payload of [
    { ...base, amount: 0 },
    { ...base, amount: -5 },
    { ...base, category: 'lunch' },
    { ...base, currency: 'DOLLARS' },
    { ...base, date: '2025-02-30' },
    { ...base, note: 'x'.repeat(501) },
  ]) {
    const response = await app.inject({
      method: 'POST',
      url: `/api/projects/${a.projectId}/expenses`,
      headers: auth(token),
      payload,
    });
    assert.equal(response.statusCode, 400, JSON.stringify(payload));
  }

  const missing = await app.inject({
    method: 'POST',
    url: `/api/projects/${randomUUID()}/expenses`,
    headers: auth(token),
    payload: base,
  });
  assert.equal(missing.statusCode, 404);
});

test('an expense from another organisation is not visible', async () => {
  const { organisationId, manager } = await seed();
  const { projectId } = await createProject(organisationId);
  const token = await login(app, manager.email, manager.password);
  const created = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/expenses`,
    headers: auth(token),
    payload: { date: today, amount: 10, currency: 'USD', category: 'other' },
  });
  const id = created.json().expense.id as string;
  const db = getDb();
  const otherOrg = randomUUID();
  await db.query(`INSERT INTO organisations (id, name) VALUES ($1, 'Other')`, [otherOrg]);
  await db.query(`UPDATE expenses SET organisation_id = $1 WHERE id = $2`, [otherOrg, id]);
  const response = await app.inject({
    method: 'PATCH',
    url: `/api/expenses/${id}`,
    headers: auth(token),
    payload: { amount: 1 },
  });
  assert.equal(response.statusCode, 404);
});
