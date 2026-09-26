import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/pool.js';
import { listAudit } from '../services/audit.js';

export function auditRoutes(app: FastifyInstance, deps: { db: Db }): void {
  const { db } = deps;
  const adminOnly = app.requireRole('administrator');

  app.get('/api/audit', { preHandler: adminOnly }, async (request) => {
    const query = request.query as { limit?: string };
    const limit = Number(query.limit ?? 100);
    const entries = await listAudit(
      db,
      request.member!.organisation_id,
      Number.isFinite(limit) ? limit : 100,
    );
    return { entries };
  });
}
