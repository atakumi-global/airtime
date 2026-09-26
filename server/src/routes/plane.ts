import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/pool.js';
import { normalizeBaseUrl, PlaneClient } from '../plane/client.js';
import { syncConnection } from '../plane/sync.js';
import {
  deleteConnection,
  getConnectionByWebhookSecret,
  getConnectionForMember,
  toPublicConnection,
  upsertConnection,
} from '../services/connections.js';
import { listWorkItems } from '../services/workItems.js';

const connectionSchema = z.object({
  baseUrl: z.string().url(),
  workspaceSlug: z.string().min(1),
  token: z.string().min(1),
});

export type PlaneRouteDeps = {
  db: Db;
  encryptionKey: Buffer | null;
};

export function planeRoutes(app: FastifyInstance, deps: PlaneRouteDeps): void {
  const { db, encryptionKey } = deps;
  const anyMember = app.authenticate;

  const keyOr503 = (reply: FastifyReply): Buffer | null => {
    if (!encryptionKey) {
      void reply.code(503).send({ error: 'token_encryption_not_configured' });
      return null;
    }
    return encryptionKey;
  };

  app.get('/api/plane/connection', { preHandler: anyMember }, async (request) => {
    const connection = await getConnectionForMember(
      db,
      request.member!.organisation_id,
      request.member!.id,
    );
    return { connection: connection ? toPublicConnection(connection) : null };
  });

  app.put('/api/plane/connection', { preHandler: anyMember }, async (request, reply) => {
    const key = keyOr503(reply);
    if (!key) return;

    const parsed = connectionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request' });
    }

    const baseUrl = normalizeBaseUrl(parsed.data.baseUrl);
    const client = new PlaneClient({
      baseUrl,
      workspaceSlug: parsed.data.workspaceSlug,
      token: parsed.data.token,
    });

    let projectCount: number;
    try {
      ({ projectCount } = await client.verify());
    } catch {
      return reply.code(400).send({ error: 'plane_verification_failed' });
    }

    const connection = await upsertConnection(db, {
      organisationId: request.member!.organisation_id,
      memberId: request.member!.id,
      baseUrl,
      workspaceSlug: parsed.data.workspaceSlug,
      token: parsed.data.token,
      key,
    });

    let sync: { projects: number; workItems: number } | null = null;
    let warning: string | null = null;
    try {
      sync = await syncConnection(db, connection, key, 'connect');
    } catch (error) {
      warning = error instanceof Error ? error.message : 'sync_failed';
    }

    return {
      connection: toPublicConnection(connection),
      workspace: {
        slug: connection.workspace_slug,
        baseUrl: connection.base_url,
        projectCount,
      },
      sync,
      warning,
    };
  });

  app.delete('/api/plane/connection', { preHandler: anyMember }, async (request) => {
    const removed = await deleteConnection(
      db,
      request.member!.organisation_id,
      request.member!.id,
    );
    return { ok: removed };
  });

  app.post('/api/plane/sync', { preHandler: anyMember }, async (request, reply) => {
    const key = keyOr503(reply);
    if (!key) return;

    const connection = await getConnectionForMember(
      db,
      request.member!.organisation_id,
      request.member!.id,
    );
    if (!connection) {
      return reply.code(404).send({ error: 'connection_not_found' });
    }

    try {
      const summary = await syncConnection(db, connection, key, 'manual');
      return { sync: summary };
    } catch (error) {
      return reply.code(502).send({
        error: 'plane_sync_failed',
        message: error instanceof Error ? error.message : 'sync_failed',
      });
    }
  });

  app.get(
    '/api/plane/work-items',
    { preHandler: anyMember },
    async (request) => {
      const query = request.query as {
        projectId?: string;
        includeClosed?: string;
      };
      const workItems = await listWorkItems(
        db,
        request.member!.organisation_id,
        {
          projectId: query.projectId,
          includeClosed: query.includeClosed === 'true',
        },
      );
      return { workItems };
    },
  );

  app.post(
    '/api/plane/webhook/:secret',
    async (request, reply) => {
      const key = keyOr503(reply);
      if (!key) return;

      const { secret } = request.params as { secret: string };
      const connection = await getConnectionByWebhookSecret(db, secret);
      if (!connection) {
        return reply.code(404).send({ error: 'connection_not_found' });
      }

      try {
        const summary = await syncConnection(db, connection, key, 'webhook');
        return reply.code(202).send({ sync: summary });
      } catch (error) {
        return reply.code(502).send({
          error: 'plane_sync_failed',
          message: error instanceof Error ? error.message : 'sync_failed',
        });
      }
    },
  );
}
