import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/pool.js';
import {
  exportFeedbackDataset,
  listFeedbackEvents,
} from '../services/feedback.js';

export function feedbackRoutes(app: FastifyInstance, deps: { db: Db }): void {
  const { db } = deps;
  const adminOnly = app.requireRole('administrator');

  app.get('/api/feedback', { preHandler: adminOnly }, async (request) => {
    const query = request.query as { limit?: string };
    const limit = Number(query.limit ?? 200);
    const events = await listFeedbackEvents(
      db,
      request.member!.organisation_id,
      Number.isFinite(limit) ? limit : 200,
    );
    return { events };
  });

  app.get('/api/feedback/export', { preHandler: adminOnly }, async (request) => {
    const dataset = await exportFeedbackDataset(
      db,
      request.member!.organisation_id,
    );
    return { dataset };
  });
}
