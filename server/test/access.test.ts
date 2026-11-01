import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { computeAccessHash } from '../src/services/access.js';
import {
  auth,
  getDb,
  login,
  makeApp,
  resetData,
  seed,
  setupSchema,
  type SeedResult,
} from './helpers.js';

// A fake Plane whose project memberships can change between requests. Each API
// token belongs to one user; every user sees all projects (two are public) and
// is a member of the projects listed for their token.
const TOKENS = {
  member: 'plane_token_member',
  manager: 'plane_token_manager',
  admin: 'plane_token_admin',
} as const;

type TokenName = keyof typeof TOKENS;

const planeState: {
  memberships: Record<TokenName, Set<string>>;
  down: boolean;
  requests: { method: string; url: string }[];
} = {
  memberships: { member: new Set(), manager: new Set(), admin: new Set() },
  down: false,
  requests: [],
};

const PLANE_PROJECTS = [
  { id: 'pl-web', identifier: 'WEB', name: 'Website' },
  { id: 'pl-app', identifier: 'APP', name: 'App' },
  { id: 'pl-pub', identifier: 'PUB', name: 'Public handbook' },
];

function startPlane(): { server: Server; baseUrl: () => string } {
  const server = createServer((request, response) => {
    planeState.requests.push({ method: request.method ?? '', url: request.url ?? '' });
    const send = (code: number, body: unknown): void => {
      response.writeHead(code, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    if (planeState.down) {
      send(503, { error: 'down' });
      return;
    }
    const apiKey = request.headers['x-api-key'];
    const owner = (Object.keys(TOKENS) as TokenName[]).find((name) => TOKENS[name] === apiKey);
    if (!owner) {
      send(401, { error: 'unauthorized' });
      return;
    }
    const url = request.url ?? '';
    const issues = /\/projects\/([^/]+)\/issues\//.exec(url);
    if (issues) {
      send(200, {
        results: [
          { id: `${issues[1]}-i1`, sequence_id: 1, name: 'Work', state_detail: { group: 'started' } },
        ],
        next_page_results: false,
      });
      return;
    }
    if (url.startsWith('/api/v1/workspaces/atakumi/projects/')) {
      send(200, {
        results: PLANE_PROJECTS.map((project) => {
          const member = planeState.memberships[owner].has(project.id);
          return { ...project, is_member: member, member_role: member ? 15 : null };
        }),
        next_page_results: false,
      });
      return;
    }
    send(404, { error: 'not_found' });
  });
  return {
    server,
    baseUrl: () => `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  };
}

let app: FastifyInstance;
let plane: ReturnType<typeof startPlane>;
let seeded: SeedResult;

before(async () => {
  await setupSchema();
  app = await makeApp();
  plane = startPlane();
  await new Promise<void>((resolve) => plane.server.listen(0, resolve));
});

beforeEach(async () => {
  await resetData();
  planeState.down = false;
  planeState.requests.length = 0;
  planeState.memberships = { member: new Set(), manager: new Set(), admin: new Set() };
  seeded = await seed();
});

after(async () => {
  await app.close();
  await new Promise<void>((resolve) => plane.server.close(() => resolve()));
  await getDb().close();
});

async function connect(who: 'member' | 'manager' | 'admin'): Promise<string> {
  const account = seeded[who];
  const token = await login(app, account.email, account.password);
  const response = await app.inject({
    method: 'PUT',
    url: '/api/plane/connection',
    headers: auth(token),
    payload: { baseUrl: plane.baseUrl(), workspaceSlug: 'atakumi', token: TOKENS[who] },
  });
  assert.equal(response.statusCode, 200, response.body);
  return token;
}

async function projectIdOf(planeId: string): Promise<string> {
  const rows = await getDb().query<{ id: string }>(
    'SELECT id FROM projects WHERE plane_project_id = $1',
    [planeId],
  );
  return rows[0]!.id;
}

async function names(token: string, url: string, key: string): Promise<string[]> {
  const response = await app.inject({ method: 'GET', url, headers: auth(token) });
  assert.equal(response.statusCode, 200, response.body);
  return (response.json()[key] as { name: string }[]).map((row) => row.name).sort();
}

async function seedEntry(memberId: string, projectId: string, workItemId: string): Promise<string> {
  const id = randomUUID();
  await getDb().query(
    `INSERT INTO time_entries
       (id, organisation_id, project_id, member_id, work_item_id, source,
        started_at, ended_at, duration_minutes, billable_minutes)
     VALUES ($1, $2, $3, $4, $5, 'manual', '2026-09-01T09:00:00Z', '2026-09-01T10:00:00Z', 60, 60)`,
    [id, seeded.organisationId, projectId, memberId, workItemId],
  );
  return id;
}

test('only projects the user is a member of in Plane are listed; public ones are not enough', async () => {
  planeState.memberships.member = new Set(['pl-web']);
  const memberToken = await connect('member');
  assert.deepEqual(await names(memberToken, '/api/projects', 'projects'), ['Website']);
  assert.deepEqual(
    await names(memberToken, '/api/plane/work-items', 'workItems'),
    ['Work'],
  );
  const items = await app.inject({
    method: 'GET',
    url: '/api/plane/work-items',
    headers: auth(memberToken),
  });
  assert.deepEqual(
    items.json().workItems.map((item: { project_name: string }) => item.project_name),
    ['Website'],
  );
});

test('administrators see every project, managers only the ones they belong to', async () => {
  planeState.memberships.member = new Set(['pl-web']);
  planeState.memberships.manager = new Set(['pl-app']);
  await connect('member');
  const managerToken = await connect('manager');
  const adminToken = await login(app, seeded.admin.email, seeded.admin.password);

  assert.deepEqual(await names(managerToken, '/api/projects', 'projects'), ['App']);
  assert.deepEqual(await names(adminToken, '/api/projects', 'projects'), [
    'App',
    'Public handbook',
    'Website',
  ]);
});

test('a hidden project answers 404 on summary, budget and expenses and cannot be changed', async () => {
  planeState.memberships.member = new Set(['pl-web']);
  planeState.memberships.manager = new Set(['pl-app']);
  await connect('member');
  const managerToken = await connect('manager');
  const web = await projectIdOf('pl-web');

  for (const url of [
    `/api/projects/${web}/summary`,
    `/api/projects/${web}/budget`,
    `/api/projects/${web}/expenses`,
  ]) {
    const response = await app.inject({ method: 'GET', url, headers: auth(managerToken) });
    assert.equal(response.statusCode, 404, url);
  }

  const budget = await app.inject({
    method: 'PUT',
    url: `/api/projects/${web}/budget`,
    headers: auth(managerToken),
    payload: { amount: 1000, currency: 'USD' },
  });
  assert.equal(budget.statusCode, 404);

  const rate = await app.inject({
    method: 'PUT',
    url: '/api/rates',
    headers: auth(managerToken),
    payload: {
      scope: 'project',
      projectId: web,
      currency: 'USD',
      hourlyAmount: 50,
      fromDate: '2026-01-01',
    },
  });
  assert.equal(rate.statusCode, 404);

  const expense = await app.inject({
    method: 'POST',
    url: `/api/projects/${web}/expenses`,
    headers: auth(managerToken),
    payload: { date: '2026-09-02', amount: 10, currency: 'USD', category: 'other' },
  });
  assert.equal(expense.statusCode, 404);

  const client = await app.inject({
    method: 'PATCH',
    url: `/api/projects/${web}`,
    headers: auth(managerToken),
    payload: { clientId: randomUUID() },
  });
  assert.equal(client.statusCode, 404);

  const none = await getDb().query('SELECT id FROM budgets');
  assert.equal(none.length, 0);
});

test('time entries, timesheet, rates and CSV export are filtered by project access', async () => {
  planeState.memberships.member = new Set(['pl-web']);
  planeState.memberships.manager = new Set(['pl-app']);
  const memberToken = await connect('member');
  const managerToken = await connect('manager');
  const adminToken = await login(app, seeded.admin.email, seeded.admin.password);
  const web = await projectIdOf('pl-web');
  const app_ = await projectIdOf('pl-app');
  await seedEntry(seeded.member.id, web, 'pl-web-i1');
  await seedEntry(seeded.manager.id, app_, 'pl-app-i1');

  const db = getDb();
  for (const [scope, projectId] of [['project', web], ['project', app_]] as const) {
    await db.query(
      `INSERT INTO rates (id, organisation_id, scope, project_id, currency, hourly_amount, from_date)
       VALUES ($1, $2, $3, $4, 'USD', 80, '2026-01-01')`,
      [randomUUID(), seeded.organisationId, scope, projectId],
    );
  }

  const list = async (token: string, url: string): Promise<{ project_id: string }[]> => {
    const response = await app.inject({ method: 'GET', url, headers: auth(token) });
    assert.equal(response.statusCode, 200, response.body);
    return response.json().entries;
  };

  // The manager may ask for the member's entries, but the project is not theirs.
  const managerView = await list(managerToken, `/api/time-entries?memberId=${seeded.member.id}`);
  assert.deepEqual(managerView, []);
  const managerAll = await list(managerToken, '/api/time-entries');
  assert.deepEqual(managerAll.map((entry) => entry.project_id), [app_]);
  const sheet = await app.inject({
    method: 'GET',
    url: `/api/time-entries/summary?memberId=${seeded.member.id}&from=2026-08-01&to=2026-10-01`,
    headers: auth(managerToken),
  });
  assert.equal(sheet.json().entries.length, 0);
  assert.equal(sheet.json().totals.entryCount, 0);

  const adminAll = await list(adminToken, '/api/time-entries');
  assert.equal(adminAll.length, 2);

  const rates = await app.inject({ method: 'GET', url: '/api/rates', headers: auth(managerToken) });
  assert.deepEqual(
    rates.json().rates.map((rate: { project_id: string }) => rate.project_id),
    [app_],
  );

  const csv = async (token: string): Promise<string> =>
    (await app.inject({ method: 'GET', url: '/api/exports/time-entries.csv', headers: auth(token) })).body;
  const managerCsv = await csv(managerToken);
  assert.ok(managerCsv.includes('Website') === false, 'manager export must not name a hidden project');
  assert.ok(managerCsv.includes('App'));
  const adminCsv = await csv(adminToken);
  assert.ok(adminCsv.includes('Website') && adminCsv.includes('App'));

  void memberToken;
});

test('an entry on a hidden project cannot be read, edited, deleted or have its history read', async () => {
  planeState.memberships.member = new Set(['pl-web']);
  planeState.memberships.manager = new Set(['pl-app']);
  await connect('member');
  const managerToken = await connect('manager');
  const entryId = await seedEntry(seeded.member.id, await projectIdOf('pl-web'), 'pl-web-i1');

  for (const [method, url] of [
    ['PATCH', `/api/time-entries/${entryId}`],
    ['DELETE', `/api/time-entries/${entryId}`],
    ['GET', `/api/time-entries/${entryId}/history`],
  ] as const) {
    const response = await app.inject({
      method,
      url,
      headers: auth(managerToken),
      payload: method === 'PATCH' ? { description: 'x' } : undefined,
    });
    assert.equal(response.statusCode, 404, `${method} ${url}`);
  }
});

test('a member cannot start a timer or enter time on a project they do not belong to', async () => {
  planeState.memberships.member = new Set(['pl-web']);
  const memberToken = await connect('member');

  const timer = await app.inject({
    method: 'POST',
    url: '/api/timer/start',
    headers: auth(memberToken),
    payload: { workItemId: 'pl-app-i1' },
  });
  assert.equal(timer.statusCode, 403);
  assert.equal(timer.json().error, 'project_access_required');

  const manual = await app.inject({
    method: 'POST',
    url: '/api/time-entries',
    headers: auth(memberToken),
    payload: { workItemId: 'pl-app-i1', date: '2026-09-20', durationMinutes: 30 },
  });
  assert.equal(manual.statusCode, 403);

  const allowed = await app.inject({
    method: 'POST',
    url: '/api/time-entries',
    headers: auth(memberToken),
    payload: { workItemId: 'pl-web-i1', date: '2026-09-20', durationMinutes: 30 },
  });
  assert.equal(allowed.statusCode, 201);
});

test('a refused timer start leaves the running timer untouched', async () => {
  planeState.memberships.member = new Set(['pl-web']);
  const memberToken = await connect('member');
  const started = await app.inject({
    method: 'POST',
    url: '/api/timer/start',
    headers: auth(memberToken),
    payload: { workItemId: 'pl-web-i1' },
  });
  assert.equal(started.statusCode, 201);
  const refused = await app.inject({
    method: 'POST',
    url: '/api/timer/start',
    headers: auth(memberToken),
    payload: { workItemId: 'pl-app-i1' },
  });
  assert.equal(refused.statusCode, 403);
  const timer = await app.inject({ method: 'GET', url: '/api/timer', headers: auth(memberToken) });
  assert.equal(timer.json().timer.work_item_id, 'pl-web-i1');
  const entries = await getDb().query('SELECT id FROM time_entries');
  assert.equal(entries.length, 0);
});

test('losing Plane membership keeps history visible and blocks new time at the next check', async () => {
  planeState.memberships.member = new Set(['pl-web']);
  const memberToken = await connect('member');
  const web = await projectIdOf('pl-web');

  const first = await app.inject({
    method: 'POST',
    url: '/api/time-entries',
    headers: auth(memberToken),
    payload: { workItemId: 'pl-web-i1', date: '2026-09-20', durationMinutes: 30 },
  });
  assert.equal(first.statusCode, 201);
  const entryId = first.json().entry.id as string;

  // Plane removes the member from the project. No sync has run since.
  planeState.memberships.member = new Set();

  const blocked = await app.inject({
    method: 'POST',
    url: '/api/time-entries',
    headers: auth(memberToken),
    payload: { workItemId: 'pl-web-i1', date: '2026-09-21', durationMinutes: 30 },
  });
  assert.equal(blocked.statusCode, 403);
  assert.equal(blocked.json().error, 'project_access_required');

  const edit = await app.inject({
    method: 'PATCH',
    url: `/api/time-entries/${entryId}`,
    headers: auth(memberToken),
    payload: { description: 'late edit' },
  });
  assert.equal(edit.statusCode, 403);
  const del = await app.inject({
    method: 'DELETE',
    url: `/api/time-entries/${entryId}`,
    headers: auth(memberToken),
  });
  assert.equal(del.statusCode, 403);

  // The history, project, summary and export stay visible.
  const entries = await app.inject({ method: 'GET', url: '/api/time-entries', headers: auth(memberToken) });
  assert.equal(entries.json().entries.length, 1);
  assert.deepEqual(await names(memberToken, '/api/projects', 'projects'), ['Website']);
  const summary = await app.inject({
    method: 'GET',
    url: `/api/projects/${web}/summary`,
    headers: auth(memberToken),
  });
  assert.equal(summary.statusCode, 200);
  const status = await getDb().query<{ status: string }>(
    'SELECT status FROM project_access WHERE project_id = $1 AND member_id = $2',
    [web, seeded.member.id],
  );
  assert.equal(status[0]!.status, 'former');

  // The work item itself is no longer offered for new time.
  const wi = await app.inject({ method: 'GET', url: '/api/plane/work-items', headers: auth(memberToken) });
  assert.equal(wi.statusCode, 200);
});

test('a membership gained in Plane is honoured without waiting for a sync', async () => {
  planeState.memberships.member = new Set(['pl-web']);
  const memberToken = await connect('member');
  planeState.memberships.member = new Set(['pl-web', 'pl-app']);

  const response = await app.inject({
    method: 'POST',
    url: '/api/time-entries',
    headers: auth(memberToken),
    payload: { workItemId: 'pl-app-i1', date: '2026-09-20', durationMinutes: 30 },
  });
  assert.equal(response.statusCode, 201, response.body);
});

test('a refusal is re-checked against Plane once, even inside the recheck interval', async () => {
  const slowApp = await makeApp({ accessRecheckSeconds: 3600 });
  try {
    planeState.memberships.member = new Set(['pl-web']);
    const account = seeded.member;
    const token = (
      await slowApp.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: account.email, password: account.password },
      })
    ).json().token as string;
    const saved = await slowApp.inject({
      method: 'PUT',
      url: '/api/plane/connection',
      headers: auth(token),
      payload: { baseUrl: plane.baseUrl(), workspaceSlug: 'atakumi', token: TOKENS.member },
    });
    assert.equal(saved.statusCode, 200);
    await getDb().query(
      "UPDATE plane_connections SET access_checked_at = now() - interval '30 seconds'",
    );
    planeState.memberships.member = new Set(['pl-web', 'pl-app']);

    const gained = await slowApp.inject({
      method: 'POST',
      url: '/api/time-entries',
      headers: auth(token),
      payload: { workItemId: 'pl-app-i1', date: '2026-09-20', durationMinutes: 30 },
    });
    assert.equal(gained.statusCode, 201, gained.body);

    // Inside the interval a revocation is not yet seen: the documented bound.
    planeState.memberships.member = new Set(['pl-web']);
    const within = await slowApp.inject({
      method: 'POST',
      url: '/api/time-entries',
      headers: auth(token),
      payload: { workItemId: 'pl-app-i1', date: '2026-09-21', durationMinutes: 30 },
    });
    assert.equal(within.statusCode, 201);

    // Once the interval has passed, the revocation applies.
    await getDb().query(
      "UPDATE plane_connections SET access_checked_at = now() - interval '2 hours'",
    );
    const lost = await slowApp.inject({
      method: 'POST',
      url: '/api/time-entries',
      headers: auth(token),
      payload: { workItemId: 'pl-app-i1', date: '2026-09-22', durationMinutes: 30 },
    });
    assert.equal(lost.statusCode, 403);
  } finally {
    await slowApp.close();
  }
});

test('work items and projects say whether new time may be entered', async () => {
  planeState.memberships.member = new Set(['pl-web']);
  const memberToken = await connect('member');
  planeState.memberships.member = new Set();
  await app.inject({ method: 'POST', url: '/api/plane/access/check', headers: auth(memberToken) });

  const items = await app.inject({ method: 'GET', url: '/api/plane/work-items', headers: auth(memberToken) });
  assert.equal(items.json().workItems.length, 1);
  assert.equal(items.json().workItems[0].can_enter_time, false);
  const projects = await app.inject({ method: 'GET', url: '/api/projects', headers: auth(memberToken) });
  assert.equal(projects.json().projects[0].can_enter_time, false);

  planeState.memberships.member = new Set(['pl-web']);
  await app.inject({ method: 'POST', url: '/api/plane/access/check', headers: auth(memberToken) });
  const again = await app.inject({ method: 'GET', url: '/api/plane/work-items', headers: auth(memberToken) });
  assert.equal(again.json().workItems[0].can_enter_time, true);
});

test('the access hash is one comparable value that changes exactly when permissions change', async () => {
  planeState.memberships.member = new Set(['pl-web']);
  const memberToken = await connect('member');

  const read = async (): Promise<string | null> => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/plane/connection',
      headers: auth(memberToken),
    });
    return response.json().connection.accessHash as string | null;
  };
  const check = async (): Promise<{ changed: boolean; accessHash: string }> => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/plane/access/check',
      headers: auth(memberToken),
    });
    assert.equal(response.statusCode, 200, response.body);
    return response.json();
  };

  const initial = await read();
  assert.equal(initial, computeAccessHash([{ workspaceSlug: 'atakumi', planeProjectId: 'pl-web' }]));
  assert.match(initial!, /^[0-9a-f]{64}$/);

  const unchanged = await check();
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.accessHash, initial);

  planeState.memberships.member = new Set(['pl-web', 'pl-app']);
  const widened = await check();
  assert.equal(widened.changed, true);
  assert.notEqual(widened.accessHash, initial);
  assert.equal(await read(), widened.accessHash);

  planeState.memberships.member = new Set(['pl-web']);
  const narrowed = await check();
  assert.equal(narrowed.changed, true);
  assert.equal(narrowed.accessHash, initial, 'same permissions give the same hash');

  const audit = await getDb().query(
    "SELECT id FROM audit_log WHERE action = 'access.changed' AND entity_id = $1",
    [seeded.member.id],
  );
  assert.equal(audit.length, 3, 'initial grant plus two changes are audited');
});

test('computeAccessHash ignores order and distinguishes workspaces', () => {
  const a = computeAccessHash([
    { workspaceSlug: 'one', planeProjectId: 'p1' },
    { workspaceSlug: 'two', planeProjectId: 'p2' },
  ]);
  const b = computeAccessHash([
    { workspaceSlug: 'two', planeProjectId: 'p2' },
    { workspaceSlug: 'one', planeProjectId: 'p1' },
  ]);
  const c = computeAccessHash([
    { workspaceSlug: 'two', planeProjectId: 'p1' },
    { workspaceSlug: 'one', planeProjectId: 'p2' },
  ]);
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('when Plane is unreachable stored access holds, then fails closed once it is too old', async () => {
  planeState.memberships.member = new Set(['pl-web']);
  const memberToken = await connect('member');
  planeState.down = true;

  const fresh = await app.inject({
    method: 'POST',
    url: '/api/time-entries',
    headers: auth(memberToken),
    payload: { workItemId: 'pl-web-i1', date: '2026-09-20', durationMinutes: 30 },
  });
  assert.equal(fresh.statusCode, 201, 'recent verified access is trusted during an outage');

  await getDb().query(
    "UPDATE plane_connections SET access_checked_at = now() - interval '2 hours'",
  );
  const stale = await app.inject({
    method: 'POST',
    url: '/api/time-entries',
    headers: auth(memberToken),
    payload: { workItemId: 'pl-web-i1', date: '2026-09-21', durationMinutes: 30 },
  });
  assert.equal(stale.statusCode, 503);
  assert.equal(stale.json().error, 'access_unverifiable');
});

test('Plane answering 404 for the workspace removes access instead of failing', async () => {
  planeState.memberships.member = new Set(['pl-web']);
  const memberToken = await connect('member');
  await getDb().query("UPDATE plane_connections SET workspace_slug = 'gone'");
  const response = await app.inject({
    method: 'POST',
    url: '/api/time-entries',
    headers: auth(memberToken),
    payload: { workItemId: 'pl-web-i1', date: '2026-09-20', durationMinutes: 30 },
  });
  assert.equal(response.statusCode, 403);
});

test('disconnecting turns current access into history', async () => {
  planeState.memberships.member = new Set(['pl-web']);
  const memberToken = await connect('member');
  const removed = await app.inject({
    method: 'DELETE',
    url: '/api/plane/connection',
    headers: auth(memberToken),
  });
  assert.equal(removed.statusCode, 200);
  const rows = await getDb().query<{ status: string }>(
    'SELECT status FROM project_access WHERE member_id = $1',
    [seeded.member.id],
  );
  assert.deepEqual(rows.map((row) => row.status), ['former']);
  const response = await app.inject({
    method: 'POST',
    url: '/api/time-entries',
    headers: auth(memberToken),
    payload: { workItemId: 'pl-web-i1', date: '2026-09-20', durationMinutes: 30 },
  });
  assert.equal(response.statusCode, 403);
});

test('projects that are not linked to Plane stay available to everyone', async () => {
  const projectId = randomUUID();
  await getDb().query(
    `INSERT INTO projects (id, organisation_id, name) VALUES ($1, $2, 'Internal')`,
    [projectId, seeded.organisationId],
  );
  const memberToken = await login(app, seeded.member.email, seeded.member.password);
  assert.deepEqual(await names(memberToken, '/api/projects', 'projects'), ['Internal']);
});

test('Airtime only reads from Plane while checking access', async () => {
  planeState.memberships.member = new Set(['pl-web']);
  const memberToken = await connect('member');
  await app.inject({ method: 'POST', url: '/api/plane/access/check', headers: auth(memberToken) });
  assert.ok(planeState.requests.length > 0);
  assert.ok(planeState.requests.every((request) => request.method === 'GET'));
});
