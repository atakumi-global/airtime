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

async function createProject(
  organisationId: string,
  clientId: string | null,
  targetDate: string | null = null,
): Promise<string> {
  const db = getDb();
  const projectId = randomUUID();
  await db.query(
    `INSERT INTO projects (id, organisation_id, plane_project_id, name, identifier, client_id, target_date)
     VALUES ($1, $2, 'plane-p1', 'Website', 'WEB', $3, $4)`,
    [projectId, organisationId, clientId, targetDate],
  );
  await db.query(
    `INSERT INTO work_items
       (id, organisation_id, project_id, plane_work_item_id, identifier, name, is_open)
     VALUES ($1, $2, $3, 'wi-1', 'WEB-1', 'Fix login', true)`,
    [randomUUID(), organisationId, projectId],
  );
  return projectId;
}

async function createBareProject(organisationId: string): Promise<string> {
  const db = getDb();
  const projectId = randomUUID();
  await db.query(
    `INSERT INTO projects (id, organisation_id, plane_project_id, name)
     VALUES ($1, $2, $3, 'Second project')`,
    [projectId, organisationId, `plane-${projectId}`],
  );
  return projectId;
}

async function setRate(
  token: string,
  payload: Record<string, unknown>,
): Promise<{ id: string }> {
  const response = await app.inject({
    method: 'PUT',
    url: '/api/rates',
    headers: auth(token),
    payload,
  });
  assert.equal(response.statusCode, 200);
  return response.json().rate;
}

async function addEntry(
  token: string,
  durationMinutes: number,
): Promise<void> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/time-entries',
    headers: auth(token),
    payload: { workItemId: 'wi-1', durationMinutes },
  });
  assert.equal(response.statusCode, 201);
}

async function summary(
  token: string,
  projectId: string,
): Promise<Record<string, unknown>> {
  const response = await app.inject({
    method: 'GET',
    url: `/api/projects/${projectId}/summary`,
    headers: auth(token),
  });
  assert.equal(response.statusCode, 200);
  return response.json().summary;
}

test('the most specific rate wins: member, then project, then client', async () => {
  const { organisationId, admin, member } = await seed();
  const clientId = randomUUID();
  const projectId = await createProject(organisationId, clientId);
  const token = await login(app, admin.email, admin.password);
  const memberToken = await login(app, member.email, member.password);
  await addEntry(memberToken, 60);

  await setRate(token, {
    scope: 'client',
    clientId,
    currency: 'USD',
    hourlyAmount: 50,
  });
  let result = await summary(token, projectId);
  assert.equal(result.spent, 50);

  await setRate(token, {
    scope: 'project',
    projectId,
    currency: 'USD',
    hourlyAmount: 100,
  });
  result = await summary(token, projectId);
  assert.equal(result.spent, 100);

  await setRate(token, {
    scope: 'member',
    memberId: member.id,
    currency: 'USD',
    hourlyAmount: 200,
  });
  result = await summary(token, projectId);
  assert.equal(result.spent, 200);

  const memberView = await login(app, member.email, member.password);
  result = await summary(memberView, projectId);
  assert.equal(result.spent, 200);
});

test('uncosted entries are shown separately and excluded from spend', async () => {
  const { organisationId, admin } = await seed();
  const projectId = await createProject(organisationId, null);
  const token = await login(app, admin.email, admin.password);
  await addEntry(token, 60);

  const result = await summary(token, projectId);
  assert.equal(result.spent, 0);
  assert.deepEqual(result.uncosted, { entries: 1, hours: 1 });
  assert.equal(result.billableMinutes, 60);
  assert.deepEqual(result.costByScope, { member: 0, project: 0, client: 0 });
  assert.deepEqual(result.weeklyCost, []);
  assert.equal(result.flag, 'none');
});

test('the cost build-up reports billable hours, the rate level used and the weekly series', async () => {
  const { organisationId, admin } = await seed();
  const clientId = randomUUID();
  const projectId = await createProject(organisationId, clientId);
  const token = await login(app, admin.email, admin.password);

  await setRate(token, {
    scope: 'client',
    clientId,
    currency: 'USD',
    hourlyAmount: 60,
  });
  await addEntry(token, 60);

  const clientRate = await summary(token, projectId);
  assert.equal(clientRate.billableMinutes, 60);
  assert.deepEqual(clientRate.costByScope, { member: 0, project: 0, client: 60 });
  const weekly = clientRate.weeklyCost as Array<{ weekStart: string; cost: number }>;
  assert.equal(weekly.length, 1);
  assert.equal(weekly[0]!.cost, 60);
  assert.equal(new Date(weekly[0]!.weekStart).getUTCDay(), 1);

  await setRate(token, {
    scope: 'project',
    projectId,
    currency: 'USD',
    hourlyAmount: 100,
  });
  const projectRate = await summary(token, projectId);
  assert.deepEqual(projectRate.costByScope, { member: 0, project: 100, client: 0 });

  await setRate(token, {
    scope: 'member',
    memberId: admin.id,
    currency: 'USD',
    hourlyAmount: 200,
  });
  const memberRate = await summary(token, projectId);
  assert.deepEqual(memberRate.costByScope, { member: 200, project: 0, client: 0 });
});

test('budget reports spend, remaining, percent and overrun flags', async () => {
  const { organisationId, admin } = await seed();
  const projectId = await createProject(organisationId, null);
  const token = await login(app, admin.email, admin.password);

  await setRate(token, {
    scope: 'project',
    projectId,
    currency: 'USD',
    hourlyAmount: 120,
  });
  await addEntry(token, 60);

  const budget = await app.inject({
    method: 'PUT',
    url: `/api/projects/${projectId}/budget`,
    headers: auth(token),
    payload: { amount: 100, currency: 'USD' },
  });
  assert.equal(budget.statusCode, 200);

  const over = await summary(token, projectId);
  assert.equal(over.spent, 120);
  assert.equal(over.remaining, -20);
  assert.equal(over.percentUsed, 120);
  assert.equal(over.flag, 'over');
  assert.equal(typeof over.burnRatePerDay, 'number');
  assert.equal(typeof over.projectedOverrun, 'number');

  const warningBudget = await app.inject({
    method: 'PUT',
    url: `/api/projects/${projectId}/budget`,
    headers: auth(token),
    payload: { amount: 1000, currency: 'USD' },
  });
  assert.equal(warningBudget.statusCode, 200);

  const warning = await summary(token, projectId);
  assert.equal(warning.remaining, 880);
  assert.equal(warning.flag, 'ok');
});

test('the projection uses the Plane project end date, falling back to the default horizon', async () => {
  const { organisationId, admin } = await seed();
  const token = await login(app, admin.email, admin.password);

  const endDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const datedProject = await createProject(organisationId, null, endDate);
  await addEntry(token, 60);
  await app.inject({
    method: 'PUT',
    url: `/api/projects/${datedProject}/budget`,
    headers: auth(token),
    payload: { amount: 1000, currency: 'USD' },
  });
  const dated = await summary(token, datedProject);
  assert.equal(dated.projectionBasis, 'project_end_date');
  assert.ok(
    (dated.projectionHorizonDays as number) >= 9 &&
      (dated.projectionHorizonDays as number) <= 10,
    `expected about 10 days, got ${dated.projectionHorizonDays}`,
  );

  const undatedProject = await createBareProject(organisationId);
  await app.inject({
    method: 'PUT',
    url: `/api/projects/${undatedProject}/budget`,
    headers: auth(token),
    payload: { amount: 1000, currency: 'USD' },
  });
  const undated = await summary(token, undatedProject);
  assert.equal(undated.projectionBasis, 'default_horizon');
  assert.equal(undated.projectionHorizonDays, 30);
});

test('price and the two targets produce profit, margin and target health', async () => {
  const { organisationId, admin } = await seed();
  const projectId = await createProject(organisationId, null);
  const token = await login(app, admin.email, admin.password);

  await setRate(token, {
    scope: 'project',
    projectId,
    currency: 'USD',
    hourlyAmount: 120,
  });
  await addEntry(token, 60);

  const saved = await app.inject({
    method: 'PUT',
    url: `/api/projects/${projectId}/budget`,
    headers: auth(token),
    payload: {
      amount: 1000,
      currency: 'USD',
      price: 2000,
      profitTargetPercent: 35,
      marginTargetAmount: 300,
    },
  });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json().budget.price, '2000.00');
  assert.equal(saved.json().budget.profit_target_percent, '35.0000');
  assert.equal(saved.json().budget.margin_target_amount, '300.00');

  const result = await summary(token, projectId);
  assert.equal(result.spent, 120);
  assert.equal(result.price, 2000);
  assert.equal(result.profit, 1880);
  assert.equal(result.profitTargetPercent, 35);
  assert.equal(result.profitTargetAmount, 700);
  assert.equal(result.profitTargetMet, true);
  assert.equal(result.margin, 880);
  assert.equal(result.marginTargetAmount, 300);
  assert.equal(result.marginTargetMet, true);
  assert.equal(result.flag, 'ok');

  const belowTarget = await app.inject({
    method: 'PUT',
    url: `/api/projects/${projectId}/budget`,
    headers: auth(token),
    payload: {
      amount: 1000,
      currency: 'USD',
      price: 2000,
      profitTargetPercent: 99,
      marginTargetAmount: 900,
    },
  });
  assert.equal(belowTarget.statusCode, 200);

  const below = await summary(token, projectId);
  assert.equal(below.profit, 1880);
  assert.equal(below.profitTargetMet, false);
  assert.equal(below.marginTargetMet, false);
  assert.equal(below.flag, 'warning');
});

test('profit and its target are unknown until a price is set', async () => {
  const { organisationId, admin } = await seed();
  const projectId = await createProject(organisationId, null);
  const token = await login(app, admin.email, admin.password);

  await app.inject({
    method: 'PUT',
    url: `/api/projects/${projectId}/budget`,
    headers: auth(token),
    payload: {
      amount: 1000,
      currency: 'USD',
      profitTargetPercent: 35,
      marginTargetAmount: 300,
    },
  });

  const result = await summary(token, projectId);
  assert.equal(result.price, null);
  assert.equal(result.profit, null);
  assert.equal(result.profitTargetPercent, 35);
  assert.equal(result.profitTargetAmount, null);
  assert.equal(result.profitTargetMet, null);
  assert.equal(result.margin, 1000);
  assert.equal(result.marginTargetMet, true);
});

test('project list can include budget summaries for flagging', async () => {
  const { organisationId, admin } = await seed();
  const projectId = await createProject(organisationId, null);
  const token = await login(app, admin.email, admin.password);

  await setRate(token, {
    scope: 'project',
    projectId,
    currency: 'USD',
    hourlyAmount: 100,
  });
  await addEntry(token, 60);
  await app.inject({
    method: 'PUT',
    url: `/api/projects/${projectId}/budget`,
    headers: auth(token),
    payload: { amount: 50, currency: 'USD' },
  });

  const response = await app.inject({
    method: 'GET',
    url: '/api/projects?withBudget=true',
    headers: auth(token),
  });
  assert.equal(response.statusCode, 200);
  const project = response
    .json()
    .projects.find((item: { id: string }) => item.id === projectId);
  assert.ok(project);
  assert.equal(project.summary.flag, 'over');
  assert.equal(project.summary.spent, 100);
});
