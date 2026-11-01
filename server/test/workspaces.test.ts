import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { migrations } from '../src/db/migrations.js';
import { normaliseWorkspaceSlugs, WorkspaceSlugError } from '../src/plane/workspaces.js';
import { summariseWorkspaces } from '../src/routes/projects.js';
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

const TOKEN = 'plane_token_multi';

type FakeProject = {
  id: string;
  identifier: string;
  name: string;
  archived?: boolean;
  member?: boolean;
};

// Workspace slug -> projects. A slug that is missing answers 404, a slug in
// `forbidden` answers 403 and one in `broken` answers 500.
const planeState: {
  workspaces: Record<string, FakeProject[]>;
  forbidden: Set<string>;
  broken: Set<string>;
  requests: { method: string; url: string }[];
} = { workspaces: {}, forbidden: new Set(), broken: new Set(), requests: [] };

function resetPlane(): void {
  planeState.workspaces = {
    alpha: [
      { id: 'a-web', identifier: 'WEB', name: 'Website' },
      { id: 'a-old', identifier: 'OLD', name: 'Legacy', archived: true },
    ],
    beta: [{ id: 'b-web', identifier: 'WEB', name: 'Website' }],
  };
  planeState.forbidden = new Set();
  planeState.broken = new Set();
  planeState.requests.length = 0;
}

function startPlane(): { server: Server; baseUrl: () => string } {
  const server = createServer((request, response) => {
    planeState.requests.push({ method: request.method ?? '', url: request.url ?? '' });
    const send = (code: number, body: unknown): void => {
      response.writeHead(code, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    if (request.headers['x-api-key'] !== TOKEN) {
      send(401, { error: 'unauthorized' });
      return;
    }
    const url = request.url ?? '';
    const match = /^\/api\/v1\/workspaces\/([^/]+)\/projects\/(?:([^/]+)\/issues\/)?/.exec(url);
    if (!match) {
      send(404, { error: 'not_found' });
      return;
    }
    const slug = decodeURIComponent(match[1]!);
    if (planeState.forbidden.has(slug)) {
      send(403, { error: 'forbidden' });
      return;
    }
    if (planeState.broken.has(slug)) {
      send(500, { error: 'boom' });
      return;
    }
    const projects = planeState.workspaces[slug];
    if (!projects) {
      send(404, { error: 'not_found' });
      return;
    }
    if (match[2]) {
      send(200, {
        results: [
          {
            id: `${match[2]}-i1`,
            sequence_id: 1,
            name: `Task in ${slug}`,
            state_detail: { group: 'started' },
          },
        ],
        next_page_results: false,
      });
      return;
    }
    send(200, {
      results: projects.map((project) => ({
        id: project.id,
        identifier: project.identifier,
        name: project.name,
        archived_at: project.archived ? '2026-01-01T00:00:00Z' : null,
        is_member: project.member !== false,
        member_role: project.member === false ? null : 15,
      })),
      next_page_results: false,
    });
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
  resetPlane();
  seeded = await seed();
});

after(async () => {
  await app.close();
  await new Promise<void>((resolve) => plane.server.close(() => resolve()));
  await getDb().close();
});

async function save(
  who: 'member' | 'manager' | 'admin',
  workspaceSlugs: string[],
  withToken = true,
): Promise<{ token: string; response: Awaited<ReturnType<FastifyInstance['inject']>> }> {
  const account = seeded[who];
  const token = await login(app, account.email, account.password);
  const response = await app.inject({
    method: 'PUT',
    url: '/api/plane/connection',
    headers: auth(token),
    payload: {
      baseUrl: plane.baseUrl(),
      workspaceSlugs,
      ...(withToken ? { token: TOKEN } : {}),
    },
  });
  return { token, response };
}

async function projectList(
  token: string,
  query = '',
): Promise<Array<{ name: string; workspace_slug: string; archived: boolean; can_enter_time: boolean }>> {
  const response = await app.inject({
    method: 'GET',
    url: `/api/projects${query}`,
    headers: auth(token),
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json().projects;
}

test('slugs are trimmed, de-duplicated case-insensitively and empty ones rejected', () => {
  assert.deepEqual(normaliseWorkspaceSlugs([' Alpha ', 'alpha', 'ALPHA', 'beta']), ['Alpha', 'beta']);
  assert.throws(
    () => normaliseWorkspaceSlugs(['alpha', '   ']),
    (error) => error instanceof WorkspaceSlugError && error.code === 'empty_workspace_slug',
  );
  assert.throws(
    () => normaliseWorkspaceSlugs(['not a slug!']),
    (error) => error instanceof WorkspaceSlugError && error.code === 'invalid_workspace_slug',
  );
  assert.throws(
    () => normaliseWorkspaceSlugs([]),
    (error) => error instanceof WorkspaceSlugError && error.code === 'no_workspaces',
  );
  assert.throws(
    () => normaliseWorkspaceSlugs(Array.from({ length: 21 }, (_, index) => `ws${index}`)),
    (error) => error instanceof WorkspaceSlugError && error.code === 'too_many_workspaces',
  );
});

test('saving verifies every slug and syncs all of them, attributing each row to its workspace', async () => {
  const { response, token } = await save('member', ['alpha', 'beta']);
  assert.equal(response.statusCode, 200, response.body);
  const body = response.json();
  assert.deepEqual(
    body.connection.workspaces.map((w: { slug: string; status: string }) => [w.slug, w.status]),
    [
      ['alpha', 'verified'],
      ['beta', 'verified'],
    ],
  );
  assert.equal(body.sync.workspaces.length, 2);
  assert.equal(body.sync.projects, 3);

  const projects = await projectList(token);
  assert.deepEqual(
    projects.map((p) => `${p.name}@${p.workspace_slug}`).sort(),
    ['Legacy@alpha', 'Website@alpha', 'Website@beta'],
  );

  const items = await app.inject({
    method: 'GET',
    url: '/api/plane/work-items',
    headers: auth(token),
  });
  const workItems = items.json().workItems as Array<{ name: string; workspace_slug: string; project_archived: boolean }>;
  assert.deepEqual(
    workItems.map((item) => `${item.name}|${item.workspace_slug}`).sort(),
    ['Task in alpha|alpha', 'Task in alpha|alpha', 'Task in beta|beta'],
  );
  assert.ok(workItems.some((item) => item.project_archived));

  assert.ok(
    planeState.requests.every((request) => request.method === 'GET'),
    'Airtime must only read from Plane',
  );
});

test('a slug the token cannot read is stored as failed and the valid one still syncs', async () => {
  planeState.forbidden.add('beta');
  const { response, token } = await save('member', ['alpha', 'beta', 'nowhere']);
  assert.equal(response.statusCode, 200, response.body);
  const workspaces = response.json().connection.workspaces as Array<{
    slug: string;
    status: string;
    errorCategory: string | null;
    error: string | null;
  }>;
  const bySlug = Object.fromEntries(workspaces.map((w) => [w.slug, w]));
  assert.equal(bySlug.alpha!.status, 'verified');
  assert.equal(bySlug.beta!.status, 'failed');
  assert.equal(bySlug.beta!.errorCategory, 'unauthorised');
  assert.equal(bySlug.nowhere!.status, 'failed');
  assert.equal(bySlug.nowhere!.errorCategory, 'not_found');
  assert.ok(bySlug.beta!.error && !bySlug.beta!.error.includes(TOKEN), 'the message never echoes the token');

  const names = (await projectList(token)).map((p) => `${p.name}@${p.workspace_slug}`).sort();
  assert.deepEqual(names, ['Legacy@alpha', 'Website@alpha']);

  const stored = await getDb().query<{ c: number }>('SELECT count(*)::int AS c FROM plane_connections');
  assert.equal(stored[0]!.c, 1);
});

test('saving with no readable slug is refused and stores nothing', async () => {
  const { response } = await save('member', ['nowhere']);
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error, 'plane_verification_failed');
  assert.equal(response.json().workspaces[0].errorCategory, 'not_found');
  const rows = await getDb().query('SELECT id FROM plane_connections');
  assert.equal(rows.length, 0);
});

test('duplicate slugs store once and an empty slug is rejected', async () => {
  const { response } = await save('member', [' alpha ', 'ALPHA', 'Alpha']);
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().connection.workspaces.length, 1);
  const rows = await getDb().query('SELECT id FROM plane_connection_workspaces');
  assert.equal(rows.length, 1);

  const empty = await save('manager', ['alpha', '  ']);
  assert.equal(empty.response.statusCode, 400);
  assert.equal(empty.response.json().error, 'empty_workspace_slug');
  const stored = await getDb().query('SELECT id FROM plane_connections WHERE member_id = $1', [
    seeded.manager.id,
  ]);
  assert.equal(stored.length, 0, 'a rejected save stores nothing');
});

test('the stored token is kept when the list is edited without a token', async () => {
  const first = await save('member', ['alpha']);
  assert.equal(first.response.statusCode, 200);
  const second = await save('member', ['alpha', 'beta'], false);
  assert.equal(second.response.statusCode, 200, second.response.body);
  assert.equal(second.response.json().connection.workspaces.length, 2);
  const none = await save('manager', ['alpha'], false);
  assert.equal(none.response.statusCode, 400);
  assert.equal(none.response.json().error, 'token_required');
});

test('a member only sees the workspaces they are a member of in Plane', async () => {
  // The first member belongs to both workspaces; the second reads the same
  // organisation but is only a member of beta's project, and nothing of alpha.
  const first = await save('member', ['alpha', 'beta']);
  assert.equal(first.response.statusCode, 200);
  planeState.workspaces.alpha!.forEach((project) => {
    project.member = false;
  });
  const second = await save('manager', ['alpha', 'beta']);
  assert.equal(second.response.statusCode, 200);

  assert.deepEqual(
    (await projectList(second.token)).map((p) => `${p.name}@${p.workspace_slug}`),
    ['Website@beta'],
  );
  const admin = await save('admin', ['alpha', 'beta']);
  assert.equal((await projectList(admin.token)).length, 3, 'administrators see all projects');
});

test('the workspace filter narrows projects and the totals follow it', async () => {
  const { token } = await save('member', ['alpha', 'beta']);
  const filtered = await projectList(token, '?workspace=Beta&withBudget=true');
  assert.deepEqual(filtered.map((p) => p.workspace_slug), ['beta']);
  const response = await app.inject({
    method: 'GET',
    url: '/api/projects?withBudget=true',
    headers: auth(token),
  });
  const totals = response.json().workspaces as Array<{ workspace: string; projectCount: number }>;
  assert.deepEqual(
    totals.map((t) => [t.workspace, t.projectCount]),
    [
      ['alpha', 2],
      ['beta', 1],
    ],
  );
});

test('workspace totals equal the sum of their projects', () => {
  const summary = (spent: number, budget: number | null) =>
    ({
      spent,
      labourCost: spent - 1,
      convertedBudget: budget,
      billableMinutes: 60,
      expenses: { total: 1 },
    }) as unknown as Parameters<typeof summariseWorkspaces>[0][number]['summary'];
  const totals = summariseWorkspaces(
    [
      { workspace_slug: 'a', archived: false, summary: summary(100.5, 500) },
      { workspace_slug: 'a', archived: true, summary: summary(50.25, null) },
      { workspace_slug: 'b', archived: false, summary: summary(10, 20) },
    ],
    'USD',
  );
  assert.deepEqual(totals[0], {
    workspace: 'a',
    projectCount: 2,
    archivedProjectCount: 1,
    currency: 'USD',
    budget: 500,
    spent: 150.75,
    labourCost: 148.75,
    expenses: 2,
    billableMinutes: 120,
  });
  assert.equal(totals[1]!.spent, 10);
});

test('one failing workspace does not stop the others and is marked with its error', async () => {
  const { token } = await save('member', ['alpha', 'beta']);
  planeState.broken.add('alpha');
  const sync = await app.inject({ method: 'POST', url: '/api/plane/sync', headers: auth(token) });
  assert.equal(sync.statusCode, 200, sync.body);
  const results = sync.json().sync.workspaces as Array<{ slug: string; status: string; errorCategory: string }>;
  assert.equal(results.find((r) => r.slug === 'alpha')!.status, 'failed');
  assert.equal(results.find((r) => r.slug === 'alpha')!.errorCategory, 'network');
  assert.equal(results.find((r) => r.slug === 'beta')!.status, 'ok');

  const connection = await app.inject({ method: 'GET', url: '/api/plane/connection', headers: auth(token) });
  const workspaces = connection.json().connection.workspaces as Array<{ slug: string; status: string; error: string }>;
  assert.equal(workspaces.find((w) => w.slug === 'alpha')!.status, 'failed');
  assert.ok(workspaces.find((w) => w.slug === 'alpha')!.error);
  assert.equal(workspaces.find((w) => w.slug === 'beta')!.status, 'verified');

  // The failed read revoked nothing: the member keeps access to alpha's projects.
  assert.equal((await projectList(token)).length, 3);
  const run = await getDb().query<{ status: string }>(
    'SELECT status FROM plane_sync_runs ORDER BY started_at DESC LIMIT 1',
  );
  assert.equal(run[0]!.status, 'partial');
});

test('when every workspace fails the sync fails and the connection shows the error', async () => {
  const { token } = await save('member', ['alpha']);
  planeState.broken.add('alpha');
  const sync = await app.inject({ method: 'POST', url: '/api/plane/sync', headers: auth(token) });
  assert.equal(sync.statusCode, 502);
  const connection = await app.inject({ method: 'GET', url: '/api/plane/connection', headers: auth(token) });
  assert.equal(connection.json().connection.status, 'error');
});

test('verify all re-checks each slug and records the result', async () => {
  const { token } = await save('member', ['alpha', 'beta']);
  planeState.forbidden.add('beta');
  const response = await app.inject({
    method: 'POST',
    url: '/api/plane/workspaces/verify',
    headers: auth(token),
  });
  assert.equal(response.statusCode, 200, response.body);
  const workspaces = response.json().connection.workspaces as Array<{ slug: string; status: string }>;
  assert.deepEqual(
    workspaces.map((w) => [w.slug, w.status]),
    [
      ['alpha', 'verified'],
      ['beta', 'failed'],
    ],
  );
  assert.ok(planeState.requests.every((request) => request.method === 'GET'));
});

test('removing a slug hides its projects but keeps time, budgets and audit records', async () => {
  const { token } = await save('member', ['alpha', 'beta']);
  const items = await app.inject({ method: 'GET', url: '/api/plane/work-items', headers: auth(token) });
  const betaItem = (items.json().workItems as Array<{ plane_work_item_id: string; workspace_slug: string }>).find(
    (item) => item.workspace_slug === 'beta',
  )!;
  const entry = await app.inject({
    method: 'POST',
    url: '/api/time-entries',
    headers: auth(token),
    payload: { workItemId: betaItem.plane_work_item_id, date: '2026-09-20', durationMinutes: 30 },
  });
  assert.equal(entry.statusCode, 201, entry.body);
  const alphaProject = (await getDb().query<{ id: string }>(
    "SELECT id FROM projects WHERE workspace_slug = 'alpha' AND plane_project_id = 'a-web'",
  ))[0]!.id;
  await getDb().query(
    `INSERT INTO budgets (id, organisation_id, project_id, amount, currency)
     VALUES (gen_random_uuid(), $1, $2, 1000, 'USD')`,
    [seeded.organisationId, alphaProject],
  );
  const before = await getDb().query<{ c: number }>('SELECT count(*)::int AS c FROM audit_log');

  const removed = await save('member', ['beta'], false);
  assert.equal(removed.response.statusCode, 200, removed.response.body);
  assert.deepEqual(removed.response.json().removedWorkspaces, ['alpha']);

  const visible = (await projectList(token)).map((p) => `${p.name}@${p.workspace_slug}`);
  assert.deepEqual(visible, ['Website@beta']);
  const hiddenItems = await app.inject({ method: 'GET', url: '/api/plane/work-items', headers: auth(token) });
  assert.ok(
    (hiddenItems.json().workItems as Array<{ workspace_slug: string }>).every(
      (item) => item.workspace_slug === 'beta',
    ),
  );

  // Nothing recorded against alpha is deleted.
  const budgets = await getDb().query('SELECT id FROM budgets WHERE project_id = $1', [alphaProject]);
  assert.equal(budgets.length, 1);
  const projects = await getDb().query('SELECT id FROM projects WHERE workspace_slug = $1', ['alpha']);
  assert.equal(projects.length, 2);
  const entries = await getDb().query('SELECT id FROM time_entries');
  assert.equal(entries.length, 1);
  const after = await getDb().query<{ c: number }>('SELECT count(*)::int AS c FROM audit_log');
  assert.ok(after[0]!.c >= before[0]!.c);
});

test('time recorded in a workspace that is later removed stays readable as history', async () => {
  const { token } = await save('member', ['alpha', 'beta']);
  const items = await app.inject({ method: 'GET', url: '/api/plane/work-items', headers: auth(token) });
  const betaItem = (items.json().workItems as Array<{ plane_work_item_id: string; workspace_slug: string }>).find(
    (item) => item.workspace_slug === 'beta',
  )!;
  const entry = await app.inject({
    method: 'POST',
    url: '/api/time-entries',
    headers: auth(token),
    payload: { workItemId: betaItem.plane_work_item_id, date: '2026-09-20', durationMinutes: 30 },
  });
  assert.equal(entry.statusCode, 201);
  await save('member', ['alpha'], false);

  const entries = await app.inject({ method: 'GET', url: '/api/time-entries', headers: auth(token) });
  assert.equal(entries.json().entries.length, 1);
  assert.equal(entries.json().entries[0].workspace_slug, 'beta');
  const projects = await projectList(token);
  const beta = projects.find((p) => p.workspace_slug === 'beta')!;
  assert.equal(beta.can_enter_time, false, 'history only: no new time');
  const again = await app.inject({
    method: 'POST',
    url: '/api/time-entries',
    headers: auth(token),
    payload: { workItemId: betaItem.plane_work_item_id, date: '2026-09-21', durationMinutes: 30 },
  });
  assert.equal(again.statusCode, 403);
});

test('an archived project is flagged, stays readable and refuses new time', async () => {
  const { token } = await save('member', ['alpha']);
  const projects = await projectList(token);
  const legacy = projects.find((p) => p.name === 'Legacy')!;
  assert.equal(legacy.archived, true);
  assert.equal(legacy.can_enter_time, false);
  assert.equal(projects.find((p) => p.name === 'Website')!.can_enter_time, true);

  const items = await app.inject({ method: 'GET', url: '/api/plane/work-items', headers: auth(token) });
  const legacyItem = (items.json().workItems as Array<{ plane_work_item_id: string; project_archived: boolean; can_enter_time: boolean }>).find(
    (item) => item.project_archived,
  )!;
  assert.equal(legacyItem.can_enter_time, false);

  const manual = await app.inject({
    method: 'POST',
    url: '/api/time-entries',
    headers: auth(token),
    payload: { workItemId: legacyItem.plane_work_item_id, date: '2026-09-20', durationMinutes: 30 },
  });
  assert.equal(manual.statusCode, 409);
  assert.equal(manual.json().error, 'project_archived');
  const timer = await app.inject({
    method: 'POST',
    url: '/api/timer/start',
    headers: auth(token),
    payload: { workItemId: legacyItem.plane_work_item_id },
  });
  assert.equal(timer.statusCode, 409);

  // Time recorded before the project was archived stays listed afterwards.
  await getDb().query("UPDATE projects SET archived = false WHERE name = 'Legacy'");
  const ok = await app.inject({
    method: 'POST',
    url: '/api/time-entries',
    headers: auth(token),
    payload: { workItemId: legacyItem.plane_work_item_id, date: '2026-09-20', durationMinutes: 30 },
  });
  assert.equal(ok.statusCode, 201, 'before it was archived time could be entered');
  await getDb().query("UPDATE projects SET archived = true WHERE name = 'Legacy'");
  const entries = await app.inject({ method: 'GET', url: '/api/time-entries', headers: auth(token) });
  assert.equal(entries.json().entries.length, 1, 'recorded time is still listed');
});

test('entries, the timer and the CSV export carry the workspace', async () => {
  const { token } = await save('manager', ['alpha', 'beta']);
  const items = await app.inject({ method: 'GET', url: '/api/plane/work-items', headers: auth(token) });
  const betaItem = (items.json().workItems as Array<{ plane_work_item_id: string; workspace_slug: string }>).find(
    (item) => item.workspace_slug === 'beta',
  )!;

  const started = await app.inject({
    method: 'POST',
    url: '/api/timer/start',
    headers: auth(token),
    payload: { workItemId: betaItem.plane_work_item_id },
  });
  assert.equal(started.statusCode, 201, started.body);
  assert.equal(started.json().timer.workspace_slug, 'beta');
  const read = await app.inject({ method: 'GET', url: '/api/timer', headers: auth(token) });
  assert.equal(read.json().timer.workspace_slug, 'beta');
  const paused = await app.inject({ method: 'POST', url: '/api/timer/pause', headers: auth(token) });
  assert.equal(paused.json().timer.workspace_slug, 'beta');
  await app.inject({ method: 'POST', url: '/api/timer/stop', headers: auth(token) });

  const manual = await app.inject({
    method: 'POST',
    url: '/api/time-entries',
    headers: auth(token),
    payload: {
      workItemId: (
        items.json().workItems as Array<{
          plane_work_item_id: string;
          workspace_slug: string;
          project_archived: boolean;
        }>
      ).find((item) => item.workspace_slug === 'alpha' && !item.project_archived)!.plane_work_item_id,
      date: '2026-09-20',
      durationMinutes: 60,
    },
  });
  assert.equal(manual.statusCode, 201, manual.body);

  const entries = await app.inject({ method: 'GET', url: '/api/time-entries', headers: auth(token) });
  const workspaces = (entries.json().entries as Array<{ workspace_slug: string }>).map((e) => e.workspace_slug).sort();
  assert.deepEqual(workspaces, ['alpha', 'beta']);

  const csv = await app.inject({ method: 'GET', url: '/api/exports/time-entries.csv', headers: auth(token) });
  const lines = csv.body.replace(/^\uFEFF/, '').split('\r\n').filter(Boolean);
  assert.ok(lines[0]!.endsWith(',workspace'));
  assert.equal(lines.length, 3);
  assert.deepEqual(
    lines.slice(1).map((line) => line.split(',').pop()).sort(),
    ['alpha', 'beta'],
  );
});

test('each workspace has its own webhook and a delivery syncs only that workspace', async () => {
  const { token } = await save('member', ['alpha', 'beta']);
  const connection = await app.inject({ method: 'GET', url: '/api/plane/connection', headers: auth(token) });
  const hooks = Object.fromEntries(
    (connection.json().connection.workspaces as Array<{ slug: string; webhookPath: string }>).map((w) => [
      w.slug,
      w.webhookPath,
    ]),
  );
  assert.notEqual(hooks.alpha, hooks.beta);

  planeState.requests.length = 0;
  const delivery = await app.inject({
    method: 'POST',
    url: hooks.beta!,
    payload: { event: 'project', action: 'update', workspace_slug: 'beta', data: { id: 'b-web' } },
  });
  assert.equal(delivery.statusCode, 202, delivery.body);
  assert.deepEqual(
    delivery.json().sync.workspaces.map((w: { slug: string }) => w.slug),
    ['beta'],
  );
  assert.ok(
    planeState.requests.every((request) => request.url.includes('/workspaces/beta/')),
    'only the workspace that changed is read',
  );

  // The access picture is left alone by a one-workspace delivery.
  assert.equal((await projectList(token)).length, 3);

  const unknown = await app.inject({ method: 'POST', url: '/api/plane/webhook/nope', payload: {} });
  assert.equal(unknown.statusCode, 404);
});

test('a project renamed in Plane is reflected by the next sync of that workspace', async () => {
  const { token } = await save('member', ['alpha', 'beta']);
  planeState.workspaces.beta![0]!.name = 'Website v2';
  const sync = await app.inject({ method: 'POST', url: '/api/plane/sync', headers: auth(token) });
  assert.equal(sync.statusCode, 200);
  const names = (await projectList(token)).map((p) => `${p.name}@${p.workspace_slug}`).sort();
  assert.deepEqual(names, ['Legacy@alpha', 'Website v2@beta', 'Website@alpha']);
});

test('a single-workspace connection migrates into the slug list without losing data', async () => {
  const { token } = await save('member', ['alpha']);
  const db = getDb();
  // Rebuild the pre-migration shape: a slug and a webhook secret on the connection.
  await db.query(
    `UPDATE plane_connections SET workspace_slug = 'alpha', webhook_secret = 'legacysecret'`,
  );
  await db.query('DELETE FROM plane_connection_workspaces');
  await db.query('UPDATE work_items SET workspace_slug = NULL');

  const migration = migrations.find((m) => m.id === '013_connection_workspaces')!;
  await db.pool.query(migration.sql);

  const rows = await db.query<{ slug: string; status: string; webhook_secret: string }>(
    'SELECT slug, status, webhook_secret FROM plane_connection_workspaces',
  );
  assert.deepEqual(rows, [{ slug: 'alpha', status: 'verified', webhook_secret: 'legacysecret' }]);
  const items = await db.query<{ workspace_slug: string }>('SELECT workspace_slug FROM work_items');
  assert.ok(items.length > 0 && items.every((item) => item.workspace_slug === 'alpha'));

  // The old webhook path keeps working and the connection still lists its workspace.
  const hook = await app.inject({ method: 'POST', url: '/api/plane/webhook/legacysecret', payload: {} });
  assert.equal(hook.statusCode, 202, hook.body);
  const connection = await app.inject({ method: 'GET', url: '/api/plane/connection', headers: auth(token) });
  assert.equal(connection.json().connection.workspaces[0].slug, 'alpha');
  assert.equal((await projectList(token)).length, 2);
});
