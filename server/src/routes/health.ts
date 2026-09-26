import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/pool.js';

export function healthRoutes(app: FastifyInstance, deps: { db: Db }): void {
  app.get('/health', async (_request, reply) => {
    try {
      await deps.db.query('SELECT 1');
      return { status: 'ok', database: 'up' };
    } catch {
      return reply.code(503).send({ status: 'degraded', database: 'down' });
    }
  });
}
