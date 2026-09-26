import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/pool.js';
import { getLatestRates, refreshRates } from '../services/fx.js';

export type FxRouteDeps = {
  db: Db;
  providerUrl: string;
};

export function fxRoutes(app: FastifyInstance, deps: FxRouteDeps): void {
  const { db, providerUrl } = deps;
  const anyMember = app.authenticate;
  const adminOnly = app.requireRole('administrator');

  app.get('/api/fx/rates', { preHandler: anyMember }, async () => {
    const snapshot = await getLatestRates(db);
    return {
      base: 'EUR',
      date: snapshot.date,
      stale: snapshot.stale,
      fetchedAt: snapshot.fetchedAt,
      rates: Object.fromEntries(snapshot.rates),
    };
  });

  app.post('/api/fx/refresh', { preHandler: adminOnly }, async (_request, reply) => {
    try {
      const result = await refreshRates(db, providerUrl);
      return { refreshed: true, ...result };
    } catch (error) {
      return reply.code(502).send({
        error: 'fx_refresh_failed',
        message: error instanceof Error ? error.message : 'refresh failed',
      });
    }
  });
}
