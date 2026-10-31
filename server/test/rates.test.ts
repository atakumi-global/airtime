import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { migrations } from '../src/db/migrations.js';
import { effectiveRate, type DatedRate } from '../src/services/costing.js';
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

async function createProject(organisationId: string, suffix = '1'): Promise<string> {
  const db = getDb();
  const projectId = randomUUID();
  await db.query(
    `INSERT INTO projects (id, organisation_id, plane_project_id, name, identifier)
     VALUES ($1, $2, $3, $4, $5)`,
    [projectId, organisationId, `plane-${suffix}`, `Project ${suffix}`, `P${suffix}`],
  );
  await db.query(
    `INSERT INTO work_items
       (id, organisation_id, project_id, plane_work_item_id, identifier, name, is_open)
     VALUES ($1, $2, $3, $4, $5, 'Work', true)`,
    [randomUUID(), organisationId, projectId, `wi-${suffix}`, `P${suffix}-1`],
  );
  return projectId;
}

async function putRate(
  token: string,
  payload: Record<string, unknown>,
): Promise<{ statusCode: number; json: () => { rate: Record<string, string>; error?: string } }> {
  return app.inject({
    method: 'PUT',
    url: '/api/rates',
    headers: auth(token),
    payload,
  });
}

async function addEntryAt(
  token: string,
  workItemId: string,
  startedAt: string,
  minutes = 60,
): Promise<void> {
  const endedAt = new Date(new Date(startedAt).getTime() + minutes * 60_000).toISOString();
  const response = await app.inject({
    method: 'POST',
    url: '/api/time-entries',
    headers: auth(token),
    payload: { workItemId, startedAt, endedAt },
  });
  assert.equal(response.statusCode, 201);
}

async function totalCost(token: string): Promise<number> {
  const response = await app.inject({
    method: 'GET',
    url: '/api/time-entries/summary?from=2020-01-01T00:00:00.000Z&to=2030-01-01T00:00:00.000Z',
    headers: auth(token),
  });
  assert.equal(response.statusCode, 200);
  return response.json().totals.cost as number;
}

async function entryCosts(token: string): Promise<number[]> {
  const response = await app.inject({
    method: 'GET',
    url: '/api/time-entries/summary?from=2020-01-01T00:00:00.000Z&to=2030-01-01T00:00:00.000Z',
    headers: auth(token),
  });
  const entries = response.json().entries as Array<{ cost: number; started_at: string }>;
  return entries
    .sort((a, b) => a.started_at.localeCompare(b.started_at))
    .map((entry) => entry.cost);
}

async function useNzdReporting(): Promise<void> {
  await getDb().query("UPDATE organisations SET reporting_currency = 'NZD'");
}

test('a fresh organisation has a default hourly rate of 200 NZD', async () => {
  const { admin } = await seed();
  const token = await login(app, admin.email, admin.password);
  const response = await app.inject({
    method: 'GET',
    url: '/api/organisation',
    headers: auth(token),
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().organisation.defaultHourlyRate, 200);
});

test('an administrator changes the default rate and the change is audited', async () => {
  const { admin } = await seed();
  const token = await login(app, admin.email, admin.password);
  const patched = await app.inject({
    method: 'PATCH',
    url: '/api/organisation',
    headers: auth(token),
    payload: { defaultHourlyRate: 250 },
  });
  assert.equal(patched.statusCode, 200);
  assert.equal(patched.json().organisation.defaultHourlyRate, 250);
  assert.equal(patched.json().organisation.reportingCurrency, 'USD');

  const read = await app.inject({
    method: 'GET',
    url: '/api/organisation',
    headers: auth(token),
  });
  assert.equal(read.json().organisation.defaultHourlyRate, 250);

  const audit = await app.inject({ method: 'GET', url: '/api/audit', headers: auth(token) });
  const entry = audit
    .json()
    .entries.find(
      (item: { action: string }) => item.action === 'organisation.default_hourly_rate_changed',
    );
  assert.ok(entry, 'expected a default rate audit entry');
  assert.equal(entry.actor_member_id, admin.id);
  assert.deepEqual(entry.before_state, { defaultHourlyRate: 200, currency: 'NZD' });
  assert.deepEqual(entry.after_state, { defaultHourlyRate: 250, currency: 'NZD' });
});

test('a manager or member cannot change the default rate', async () => {
  const { manager, member } = await seed();
  for (const user of [manager, member]) {
    const token = await login(app, user.email, user.password);
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/organisation',
      headers: auth(token),
      payload: { defaultHourlyRate: 10 },
    });
    assert.equal(response.statusCode, 403);
  }
});

test('the default rate cannot be cleared or set to an invalid value', async () => {
  const { admin } = await seed();
  const token = await login(app, admin.email, admin.password);
  const bodies: unknown[] = [
    { defaultHourlyRate: null },
    { defaultHourlyRate: '' },
    { defaultHourlyRate: -1 },
    { defaultHourlyRate: 'abc' },
    {},
  ];
  for (const payload of bodies) {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/organisation',
      headers: auth(token),
      payload: payload as Record<string, unknown>,
    });
    assert.equal(response.statusCode, 400, JSON.stringify(payload));
    assert.equal(response.json().error, 'invalid_request');
  }
  const read = await app.inject({ method: 'GET', url: '/api/organisation', headers: auth(token) });
  assert.equal(read.json().organisation.defaultHourlyRate, 200);
});

test('a default rate of 0 is valid and costs time at zero', async () => {
  const { organisationId, admin } = await seed();
  await createProject(organisationId);
  const token = await login(app, admin.email, admin.password);
  await useNzdReporting();
  const patched = await app.inject({
    method: 'PATCH',
    url: '/api/organisation',
    headers: auth(token),
    payload: { defaultHourlyRate: 0 },
  });
  assert.equal(patched.statusCode, 200);
  await addEntryAt(token, 'wi-1', '2026-03-01T09:00:00.000Z');
  assert.equal(await totalCost(token), 0);
});

test('a changed default rate recosts past time with no specific rate', async () => {
  const { organisationId, admin } = await seed();
  await createProject(organisationId);
  const token = await login(app, admin.email, admin.password);
  await useNzdReporting();
  await addEntryAt(token, 'wi-1', '2026-03-01T09:00:00.000Z');
  assert.equal(await totalCost(token), 200);
  await app.inject({
    method: 'PATCH',
    url: '/api/organisation',
    headers: auth(token),
    payload: { defaultHourlyRate: 250 },
  });
  assert.equal(await totalCost(token), 250);
});

test('effective dates: the latest from-date on or before the entry date applies', async () => {
  const { organisationId, admin, member } = await seed();
  await createProject(organisationId);
  const token = await login(app, admin.email, admin.password);
  const memberToken = await login(app, member.email, member.password);
  await useNzdReporting();

  for (const [fromDate, hourlyAmount] of [
    ['2026-01-01', 100],
    ['2026-07-01', 120],
  ] as const) {
    const saved = await putRate(token, {
      scope: 'member',
      memberId: member.id,
      currency: 'NZD',
      fromDate,
      hourlyAmount,
    });
    assert.equal(saved.statusCode, 200);
    assert.equal(saved.json().rate.from_date, fromDate);
  }

  await addEntryAt(memberToken, 'wi-1', '2026-06-30T09:00:00.000Z');
  await addEntryAt(memberToken, 'wi-1', '2026-07-01T09:00:00.000Z');
  await addEntryAt(memberToken, 'wi-1', '2027-03-05T09:00:00.000Z');
  // Before any member rate: falls through to the default rate.
  await addEntryAt(memberToken, 'wi-1', '2025-12-31T09:00:00.000Z');

  assert.deepEqual(await entryCosts(memberToken), [200, 100, 120, 120]);

  const listed = await app.inject({ method: 'GET', url: '/api/rates', headers: auth(token) });
  assert.equal(listed.json().rates.length, 2);
});

test('the UTC calendar date of started_at decides which rate applies', async () => {
  const { organisationId, admin, member } = await seed();
  await createProject(organisationId);
  const token = await login(app, admin.email, admin.password);
  const memberToken = await login(app, member.email, member.password);
  await useNzdReporting();
  await putRate(token, {
    scope: 'member',
    memberId: member.id,
    currency: 'NZD',
    fromDate: '2026-07-01',
    hourlyAmount: 50,
  });
  await addEntryAt(memberToken, 'wi-1', '2026-06-30T23:30:00.000Z', 30);
  await addEntryAt(memberToken, 'wi-1', '2026-07-01T00:00:00.000Z', 30);
  // 30 minutes: 200/2 at the default rate, then 50/2 at the member rate.
  assert.deepEqual(await entryCosts(memberToken), [100, 25]);
});

test('a future-dated rate does not apply to earlier entries', async () => {
  const { organisationId, admin, member } = await seed();
  await createProject(organisationId);
  const token = await login(app, admin.email, admin.password);
  const memberToken = await login(app, member.email, member.password);
  await useNzdReporting();
  await putRate(token, {
    scope: 'member',
    memberId: member.id,
    currency: 'NZD',
    fromDate: '2999-01-01',
    hourlyAmount: 1,
  });
  await addEntryAt(memberToken, 'wi-1', '2026-03-01T09:00:00.000Z');
  assert.equal(await totalCost(memberToken), 200);
});

test('a member rate that starts later falls through to the project rate, then the default', async () => {
  const { organisationId, admin, member } = await seed();
  const projectId = await createProject(organisationId);
  const token = await login(app, admin.email, admin.password);
  const memberToken = await login(app, member.email, member.password);
  await useNzdReporting();
  await putRate(token, {
    scope: 'member',
    memberId: member.id,
    currency: 'NZD',
    fromDate: '2026-07-01',
    hourlyAmount: 300,
  });
  await addEntryAt(memberToken, 'wi-1', '2026-06-30T09:00:00.000Z');
  assert.equal(await totalCost(memberToken), 200);

  await putRate(token, {
    scope: 'project',
    projectId,
    currency: 'NZD',
    fromDate: '2026-01-01',
    hourlyAmount: 90,
  });
  assert.equal(await totalCost(memberToken), 90);
});

test('a project + member rate falls through when it starts after the entry', async () => {
  const { organisationId, admin, member } = await seed();
  const projectId = await createProject(organisationId);
  const token = await login(app, admin.email, admin.password);
  const memberToken = await login(app, member.email, member.password);
  await useNzdReporting();
  await putRate(token, {
    scope: 'project_member',
    projectId,
    memberId: member.id,
    currency: 'NZD',
    fromDate: '2026-09-01',
    hourlyAmount: 10,
  });
  await putRate(token, {
    scope: 'project',
    projectId,
    currency: 'NZD',
    fromDate: '2026-01-01',
    hourlyAmount: 90,
  });
  await addEntryAt(memberToken, 'wi-1', '2026-08-31T09:00:00.000Z');
  await addEntryAt(memberToken, 'wi-1', '2026-09-02T09:00:00.000Z');
  await putRate(token, {
    scope: 'project_member',
    projectId,
    memberId: member.id,
    currency: 'NZD',
    fromDate: '2026-09-02',
    hourlyAmount: 20,
  });
  assert.deepEqual(await entryCosts(memberToken), [90, 20]);
});

test('a project + member rate only applies to that member on that project', async () => {
  const { organisationId, admin, manager, member } = await seed();
  const projectId = await createProject(organisationId, '1');
  await createProject(organisationId, '2');
  const token = await login(app, admin.email, admin.password);
  const memberToken = await login(app, member.email, member.password);
  const managerToken = await login(app, manager.email, manager.password);
  await useNzdReporting();
  await putRate(token, {
    scope: 'project_member',
    projectId,
    memberId: member.id,
    currency: 'NZD',
    fromDate: '2026-01-01',
    hourlyAmount: 40,
  });
  await addEntryAt(memberToken, 'wi-1', '2026-03-01T09:00:00.000Z');
  await addEntryAt(memberToken, 'wi-2', '2026-03-02T09:00:00.000Z');
  await addEntryAt(managerToken, 'wi-1', '2026-03-03T09:00:00.000Z');
  assert.deepEqual(await entryCosts(token), [40, 200, 200]);
});

test('back-dating, editing and deleting a rate recost saved entries on the next read', async () => {
  const { organisationId, admin, member } = await seed();
  await createProject(organisationId);
  const token = await login(app, admin.email, admin.password);
  const memberToken = await login(app, member.email, member.password);
  await useNzdReporting();
  await addEntryAt(memberToken, 'wi-1', '2026-03-01T09:00:00.000Z');
  assert.equal(await totalCost(token), 200);

  const created = await putRate(token, {
    scope: 'member',
    memberId: member.id,
    currency: 'NZD',
    fromDate: '2026-01-01',
    hourlyAmount: 100,
  });
  assert.equal(await totalCost(token), 100);

  const edited = await putRate(token, {
    scope: 'member',
    memberId: member.id,
    currency: 'NZD',
    fromDate: '2026-01-01',
    hourlyAmount: 110,
  });
  assert.equal(edited.json().rate.id, created.json().rate.id, 'same key updates the row');
  assert.equal(await totalCost(token), 110);
  const rows = await getDb().query('SELECT 1 FROM rates');
  assert.equal(rows.length, 1);

  const removed = await app.inject({
    method: 'DELETE',
    url: `/api/rates/${created.json().rate.id}`,
    headers: auth(token),
  });
  assert.equal(removed.statusCode, 200);
  assert.equal(await totalCost(token), 200);

  const audit = await app.inject({ method: 'GET', url: '/api/audit', headers: auth(token) });
  const actions = audit.json().entries.map((item: { action: string }) => item.action);
  for (const action of ['rate.created', 'rate.updated', 'rate.deleted']) {
    assert.ok(actions.includes(action), `expected ${action}`);
  }
});

test('the CSV export uses the same dated resolution', async () => {
  const { organisationId, admin, member } = await seed();
  await createProject(organisationId);
  const token = await login(app, admin.email, admin.password);
  const memberToken = await login(app, member.email, member.password);
  await useNzdReporting();
  await putRate(token, {
    scope: 'member',
    memberId: member.id,
    currency: 'NZD',
    fromDate: '2026-07-01',
    hourlyAmount: 120,
  });
  await addEntryAt(memberToken, 'wi-1', '2026-06-30T09:00:00.000Z');
  await addEntryAt(memberToken, 'wi-1', '2026-07-01T09:00:00.000Z');
  const csv = await app.inject({
    method: 'GET',
    url: '/api/exports/time-entries.csv',
    headers: auth(token),
  });
  assert.equal(csv.statusCode, 200);
  const lines = csv.body.trim().split('\r\n');
  assert.equal(lines.length, 3);
  assert.match(lines[1]!, /,200,NZD,200,/);
  assert.match(lines[2]!, /,120,NZD,120,/);
});

test('rate validation: dates, amounts, scope and references', async () => {
  const { organisationId, admin } = await seed();
  const projectId = await createProject(organisationId);
  const token = await login(app, admin.email, admin.password);
  const base = {
    scope: 'member',
    memberId: admin.id,
    currency: 'NZD',
    fromDate: '2026-01-01',
    hourlyAmount: 10,
  };
  const invalid: Array<Record<string, unknown>> = [
    { ...base, fromDate: undefined },
    { ...base, fromDate: 'not-a-date' },
    { ...base, fromDate: '2026-02-30' },
    { ...base, fromDate: '2026-1-1' },
    { ...base, hourlyAmount: -1 },
    { ...base, hourlyAmount: '10' },
    { ...base, scope: 'client', clientId: randomUUID(), memberId: undefined },
    { ...base, scope: 'project_member', memberId: undefined, projectId },
    { ...base, scope: 'project_member', projectId: undefined },
    { ...base, scope: 'project', memberId: undefined, projectId: undefined },
  ];
  for (const payload of invalid) {
    const response = await putRate(token, payload);
    assert.equal(response.statusCode, 400, JSON.stringify(payload));
    assert.equal(response.json().error, 'invalid_request');
  }

  const foreignMember = await putRate(token, { ...base, memberId: randomUUID() });
  assert.equal(foreignMember.statusCode, 404);
  const foreignProject = await putRate(token, {
    ...base,
    scope: 'project',
    memberId: undefined,
    projectId: randomUUID(),
  });
  assert.equal(foreignProject.statusCode, 404);
  const foreignPair = await putRate(token, {
    ...base,
    scope: 'project_member',
    projectId: randomUUID(),
  });
  assert.equal(foreignPair.statusCode, 404);

  const zero = await putRate(token, { ...base, hourlyAmount: 0 });
  assert.equal(zero.statusCode, 200);
  assert.equal(Number(zero.json().rate.hourly_amount), 0);
});

test('a rate for another organisation member or project is a 404', async () => {
  const { admin } = await seed();
  const db = getDb();
  const otherOrg = randomUUID();
  await db.query("INSERT INTO organisations (id, name) VALUES ($1, 'Other')", [otherOrg]);
  const otherProject = randomUUID();
  await db.query(
    "INSERT INTO projects (id, organisation_id, plane_project_id, name) VALUES ($1, $2, 'x', 'X')",
    [otherProject, otherOrg],
  );
  const token = await login(app, admin.email, admin.password);
  const response = await putRate(token, {
    scope: 'project',
    projectId: otherProject,
    currency: 'NZD',
    fromDate: '2026-01-01',
    hourlyAmount: 1,
  });
  assert.equal(response.statusCode, 404);
});

test('deleting an unknown rate is a 404 rate_not_found', async () => {
  const { admin } = await seed();
  const token = await login(app, admin.email, admin.password);
  for (const id of [randomUUID(), 'not-a-uuid']) {
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/rates/${id}`,
      headers: auth(token),
    });
    assert.equal(response.statusCode, 404);
    assert.equal(response.json().error, 'rate_not_found');
  }
});

test('a plain member cannot read, write or delete rates', async () => {
  const { member } = await seed();
  const token = await login(app, member.email, member.password);
  const read = await app.inject({ method: 'GET', url: '/api/rates', headers: auth(token) });
  assert.equal(read.statusCode, 403);
  const write = await putRate(token, {
    scope: 'member',
    memberId: member.id,
    currency: 'NZD',
    fromDate: '2026-01-01',
    hourlyAmount: 1,
  });
  assert.equal(write.statusCode, 403);
  const remove = await app.inject({
    method: 'DELETE',
    url: `/api/rates/${randomUUID()}`,
    headers: auth(token),
  });
  assert.equal(remove.statusCode, 403);
});

test('two project + member rates with different from-dates are both stored and listed newest first', async () => {
  const { organisationId, admin, manager } = await seed();
  const projectId = await createProject(organisationId);
  const token = await login(app, manager.email, manager.password);
  for (const [fromDate, hourlyAmount] of [
    ['2026-01-01', 10],
    ['2026-06-01', 20],
  ] as const) {
    const saved = await putRate(token, {
      scope: 'project_member',
      projectId,
      memberId: admin.id,
      currency: 'NZD',
      fromDate,
      hourlyAmount,
    });
    assert.equal(saved.statusCode, 200);
  }
  const listed = await app.inject({ method: 'GET', url: '/api/rates', headers: auth(token) });
  const rates = listed.json().rates as Array<{ from_date: string; scope: string }>;
  assert.deepEqual(
    rates.map((rate) => [rate.scope, rate.from_date]),
    [
      ['project_member', '2026-06-01'],
      ['project_member', '2026-01-01'],
    ],
  );
});

test('effectiveRate finds the latest rate on or before a date', () => {
  const make = (fromDate: string, hourlyAmount: number): DatedRate => ({
    fromDate,
    rate: { currency: 'NZD', hourlyAmount },
  });
  const rates = [make('2026-01-01', 1), make('2026-03-01', 2), make('2026-05-01', 3)];
  assert.equal(effectiveRate(undefined, '2026-04-01'), null);
  assert.equal(effectiveRate([], '2026-04-01'), null);
  assert.equal(effectiveRate(rates, '2025-12-31'), null);
  assert.equal(effectiveRate(rates, '2026-01-01')?.hourlyAmount, 1);
  assert.equal(effectiveRate(rates, '2026-02-28')?.hourlyAmount, 1);
  assert.equal(effectiveRate(rates, '2026-03-01')?.hourlyAmount, 2);
  assert.equal(effectiveRate(rates, '2030-01-01')?.hourlyAmount, 3);
});

test('migration 010 dates existing rates, drops client rates and adds the default rate', async () => {
  const url = process.env.TEST_DATABASE_URL!;
  const schema = `mig_${randomUUID().replace(/-/g, '')}`;
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${schema}`);
  const client = new pg.Client({ connectionString: url, options: `-c search_path=${schema}` });
  await client.connect();
  try {
    const target = migrations.findIndex((migration) => migration.id === '010_rate_dates');
    assert.ok(target > 0, 'migration 010 exists');
    for (const migration of migrations.slice(0, target)) {
      await client.query(migration.sql);
    }
    const organisationId = randomUUID();
    const memberId = randomUUID();
    const projectId = randomUUID();
    await client.query("INSERT INTO organisations (id, name) VALUES ($1, 'Org')", [organisationId]);
    await client.query(
      `INSERT INTO members (id, organisation_id, email, display_name, role)
       VALUES ($1, $2, 'a@b.test', 'A', 'member')`,
      [memberId, organisationId],
    );
    await client.query(
      "INSERT INTO projects (id, organisation_id, plane_project_id, name) VALUES ($1, $2, 'p', 'P')",
      [projectId, organisationId],
    );
    const insert = (scope: string, member: string | null, project: string | null, client_: string | null, createdAt: string) =>
      client.query(
        `INSERT INTO rates (id, organisation_id, scope, member_id, project_id, client_id, currency, hourly_amount, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'USD', 10, $7)`,
        [randomUUID(), organisationId, scope, member, project, client_, createdAt],
      );
    await insert('member', memberId, null, null, '2026-03-04T23:30:00Z');
    await insert('project', null, projectId, null, '2026-05-06T01:00:00Z');
    await insert('client', null, null, randomUUID(), '2026-05-06T01:00:00Z');

    await client.query(migrations[target]!.sql);

    const rates = await client.query(
      `SELECT scope, to_char(from_date, 'YYYY-MM-DD') AS from_date FROM rates ORDER BY scope`,
    );
    assert.deepEqual(rates.rows, [
      { scope: 'member', from_date: '2026-03-04' },
      { scope: 'project', from_date: '2026-05-06' },
    ]);
    const columns = await client.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'rates'`,
      [schema],
    );
    assert.ok(!columns.rows.some((row) => row.column_name === 'client_id'));
    const organisation = await client.query('SELECT default_hourly_rate FROM organisations');
    assert.equal(Number(organisation.rows[0].default_hourly_rate), 200);
    await assert.rejects(
      client.query(
        `INSERT INTO rates (id, organisation_id, scope, client_id, currency, hourly_amount, from_date)
         VALUES ($1, $2, 'client', $1, 'USD', 1, '2026-01-01')`,
        [randomUUID(), organisationId],
      ),
    );
  } finally {
    await client.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
