import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/pool.js';

export function healthRoutes(app: FastifyInstance, deps: { db: Db }): void {
  app.get('/', async () => ({
    name: 'Airtime server',
    version: process.env.npm_package_version ?? '0.1.0',
    description:
      'Time tracking and budget management for self-hosted Plane. API only; the desktop client is work item AIRTIME-9.',
    health: '/health',
    endpoints: {
      login: '/auth/login',
      me: '/api/me',
      organisation: '/api/organisation',
      projects: '/api/projects',
      timeEntries: '/api/time-entries',
      timer: '/api/timer',
      rates: '/api/rates',
      fx: '/api/fx/rates',
      workItems: '/api/plane/work-items',
      exportCsv: '/api/exports/time-entries.csv',
      audit: '/api/audit',
    },
  }));

  app.get('/health', async (_request, reply) => {
    try {
      await deps.db.query('SELECT 1');
      return { status: 'ok', database: 'up' };
    } catch {
      return reply.code(503).send({ status: 'degraded', database: 'down' });
    }
  });
}
