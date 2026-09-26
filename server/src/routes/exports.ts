import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/pool.js';
import { buildTimeEntriesCsv } from '../services/export.js';

export function exportRoutes(app: FastifyInstance, deps: { db: Db }): void {
  const { db } = deps;
  const managerOnly = app.requireRole('manager', 'administrator');

  app.get(
    '/api/exports/time-entries.csv',
    { preHandler: managerOnly },
    async (request, reply) => {
      const query = request.query as {
        from?: string;
        to?: string;
        projectId?: string;
        memberId?: string;
      };
      const csv = await buildTimeEntriesCsv(db, request.member!.organisation_id, {
        from: query.from,
        to: query.to,
        projectId: query.projectId,
        memberId: query.memberId,
      });
      reply.header('content-type', 'text/csv; charset=utf-8');
      reply.header(
        'content-disposition',
        'attachment; filename="airtime-time-entries.csv"',
      );
      return reply.send(csv);
    },
  );
}
