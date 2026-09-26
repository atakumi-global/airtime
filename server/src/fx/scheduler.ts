import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/pool.js';
import { refreshRates, shouldRefresh } from '../services/fx.js';

export function startFxScheduler(
  db: Db,
  providerUrl: string,
  refreshHours: number,
  log: FastifyBaseLogger,
): () => void {
  const runOnce = async (): Promise<void> => {
    try {
      if (!(await shouldRefresh(db, refreshHours))) {
        return;
      }
      const result = await refreshRates(db, providerUrl);
      log.info({ date: result.date, stored: result.stored }, 'refreshed FX rates');
    } catch (error) {
      log.warn({ err: error }, 'FX refresh failed; keeping the last rates');
    }
  };

  void runOnce();
  const intervalMs = Math.max(60, refreshHours * 0.5) * 60 * 60 * 1000;
  const timer = setInterval(() => {
    void runOnce();
  }, intervalMs);
  timer.unref();

  return () => clearInterval(timer);
}
