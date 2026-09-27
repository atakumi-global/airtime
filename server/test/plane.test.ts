import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { decryptToken, parseEncryptionKey } from '../src/crypto/tokens.js';
import { listActiveConnections } from '../src/services/connections.js';
import {
  auth,
  getDb,
  login,
  makeApp,
  resetData,
  seed,
  setupSchema,
} from './helpers.js';

const VALID_TOKEN = 'plane_api_test_token';
const OTHER_TOKEN = 'plane_api_other_token';

type Recorded = { method: string; url: string };

function startPlaneServer(): {
  server: Server;
  requests: Recorded[];
  baseUrl: () => string;
} {
  const requests: Recorded[] = [];
  const server = createServer((request, response) => {
    requests.push({ method: request.method ?? '', url: request.url ?? '' });
    const send = (code: number, body: unknown): void => {
      response.writeHead(code, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };

    if (request.method !== 'GET') {
      send(405, { error: 'read_only' });
      return;
    }
    if (request.headers['x-api-key'] !== VALID_TOKEN) {
      send(401, { error: 'unauthorized' });
      return;
    }

    const url = request.url ?? '';
    if (url.startsWith('/api/v1/workspaces/atakumi/projects/p1/issues/')) {
      send(200, {
        results: [
          {
            id: 'i1',
            sequence_id: 1,
            name: 'Fix login',
            state_detail: { group: 'backlog' },
            updated_at: '2026-09-01T10:00:00Z',
          },
          {
            id: 'i2',
            sequence_id: 2,
            name: 'Ship it',
            state_detail: { group: 'completed' },
            completed_at: '2026-09-02T10:00:00Z',
            updated_at: '2026-09-02T10:00:00Z',
          },
        ],
        next_page_results: false,
      });
      return;
    }
    if (url.startsWith('/api/v1/workspaces/atakumi/projects/p2/issues/')) {
      send(200, { results: [], next_page_results: false });
      return;
    }
    if (url.startsWith('/api/v1/workspaces/atakumi/projects/')) {
      send(200, {
        results: [
          { id: 'p1', identifier: 'WEB', name: 'Website' },
          { id: 'p2', identifier: 'APP', name: 'App' },
        ],
        next_page_results: false,
      });
      return;
    }
    send(404, { error: 'not_found' });
  });

  return {
    server,
    requests,
    baseUrl: () => `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  };
}

let app: FastifyInstance;
let plane: ReturnType<typeof startPlaneServer>;

before(async () => {
  await setupSchema();
  app = await makeApp();
  plane = startPlaneServer();
  await new Promise<void>((resolve) => plane.server.listen(0, resolve));
});

beforeEach(async () => {
  await resetData();
  plane.requests.length = 0;
});

after(async () => {
  await app.close();
  await new Promise<void>((resolve) => plane.server.close(() => resolve()));
  await getDb().close();
});

async function connect(token: string, managerEmail: string): Promise<string> {
  const userToken = await login(app, managerEmail, 'password123');
  await app.inject({
    method: 'PUT',
    url: '/api/plane/connection',
    headers: auth(userToken),
    payload: {
      baseUrl: plane.baseUrl(),
      workspaceSlug: 'atakumi',
      token,
    },
  });
  return userToken;
}

test('saving a valid connection verifies, stores the token encrypted and syncs', async () => {
  const { manager } = await seed();
  const userToken = await login(app, manager.email, manager.password);

  const response = await app.inject({
    method: 'PUT',
    url: '/api/plane/connection',
    headers: auth(userToken),
    payload: {
      baseUrl: plane.baseUrl(),
      workspaceSlug: 'atakumi',
      token: VALID_TOKEN,
    },
  });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.workspace.slug, 'atakumi');
  assert.equal(body.workspace.projectCount, 2);
  assert.equal(body.sync.projects, 2);
  assert.equal(body.sync.workItems, 2);

  const rows = await getDb().query<{ encrypted_token: string }>(
    'SELECT encrypted_token FROM plane_connections',
  );
  assert.equal(rows.length, 1);
  assert.ok(
    !rows[0]!.encrypted_token.includes(VALID_TOKEN),
    'raw token must not be stored',
  );
  const decrypted = decryptToken(
    rows[0]!.encrypted_token,
    parseEncryptionKey('a'.repeat(64)),
  );
  assert.equal(decrypted, VALID_TOKEN);

  assert.ok(
    plane.requests.every((request) => request.method === 'GET'),
    'Airtime must never write to Plane',
  );
});

test('an invalid token is rejected and stores nothing', async () => {
  const { manager } = await seed();
  const userToken = await login(app, manager.email, manager.password);

  const response = await app.inject({
    method: 'PUT',
    url: '/api/plane/connection',
    headers: auth(userToken),
    payload: {
      baseUrl: plane.baseUrl(),
      workspaceSlug: 'atakumi',
      token: OTHER_TOKEN,
    },
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error, 'plane_verification_failed');

  const rows = await getDb().query('SELECT id FROM plane_connections');
  assert.equal(rows.length, 0);
});

test('only open work items are listed after sync', async () => {
  const { manager } = await seed();
  const userToken = await connect(VALID_TOKEN, manager.email);

  const response = await app.inject({
    method: 'GET',
    url: '/api/plane/work-items',
    headers: auth(userToken),
  });
  assert.equal(response.statusCode, 200);
  const items = response.json().workItems as {
    identifier: string;
    name: string;
    project_name: string;
  }[];
  assert.equal(items.length, 1);
  assert.equal(items[0]!.identifier, 'WEB-1');
  assert.equal(items[0]!.name, 'Fix login');
  assert.equal(items[0]!.project_name, 'Website');
});

test('a webhook triggers a sync for its connection', async () => {
  const { manager } = await seed();
  const userToken = await connect(VALID_TOKEN, manager.email);

  const connection = await app.inject({
    method: 'GET',
    url: '/api/plane/connection',
    headers: auth(userToken),
  });
  const webhookPath = connection.json().connection.webhookPath as string;
  assert.ok(webhookPath.startsWith('/api/plane/webhook/'));

  const response = await app.inject({
    method: 'POST',
    url: webhookPath,
    payload: { event: 'issue.updated', data: { id: 'i1' } },
  });
  assert.equal(response.statusCode, 202);
  assert.equal(response.json().sync.workItems, 2);
});

test('removing a member stops their Plane sync and keeps their entries', async () => {
  const { admin, member } = await seed();
  const memberToken = await connect(VALID_TOKEN, member.email);

  const entry = await app.inject({
    method: 'POST',
    url: '/api/time-entries',
    headers: auth(memberToken),
    payload: { workItemId: 'i1', date: '2026-09-20', durationMinutes: 30 },
  });
  assert.equal(entry.statusCode, 201);

  const connection = await app.inject({
    method: 'GET',
    url: '/api/plane/connection',
    headers: auth(memberToken),
  });
  const webhookPath = connection.json().connection.webhookPath as string;

  const adminToken = await login(app, admin.email, admin.password);
  const removed = await app.inject({
    method: 'DELETE',
    url: `/api/members/${member.id}`,
    headers: auth(adminToken),
  });
  assert.equal(removed.statusCode, 200);

  const db = getDb();
  const connections = await db.query(
    'SELECT id FROM plane_connections WHERE member_id = $1',
    [member.id],
  );
  assert.equal(connections.length, 0, 'connection must be deleted');
  assert.equal(
    (await listActiveConnections(db)).length,
    0,
    'poll sync must have nothing to sync',
  );

  const webhook = await app.inject({
    method: 'POST',
    url: webhookPath,
    payload: { event: 'issue.updated', data: { id: 'i1' } },
  });
  assert.equal(webhook.statusCode, 404);

  const manual = await app.inject({
    method: 'POST',
    url: '/api/plane/sync',
    headers: auth(memberToken),
  });
  assert.equal(manual.statusCode, 401);

  const remaining = await db.query(
    'SELECT count(*)::int AS count FROM time_entries WHERE member_id = $1',
    [member.id],
  );
  assert.equal(remaining[0]!.count, 1);
});

test('poll and webhook skip a connection whose member is not active', async () => {
  const { manager } = await seed();
  const managerToken = await connect(VALID_TOKEN, manager.email);

  const db = getDb();
  const rows = await db.query<{ webhook_secret: string }>(
    'SELECT webhook_secret FROM plane_connections WHERE member_id = $1',
    [manager.id],
  );
  const webhookSecret = rows[0]!.webhook_secret;

  await db.query(`UPDATE members SET status = 'removed' WHERE id = $1`, [
    manager.id,
  ]);

  assert.equal(
    (await listActiveConnections(db)).length,
    0,
    'removed member connection must not be polled',
  );

  const webhook = await app.inject({
    method: 'POST',
    url: `/api/plane/webhook/${webhookSecret}`,
    payload: { event: 'issue.updated', data: { id: 'i1' } },
  });
  assert.equal(webhook.statusCode, 404);

  const manual = await app.inject({
    method: 'POST',
    url: '/api/plane/sync',
    headers: auth(managerToken),
  });
  assert.equal(manual.statusCode, 401);
});
