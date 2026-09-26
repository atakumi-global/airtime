import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/pool.js';
import { listActiveConnections } from '../services/connections.js';
import { syncConnection } from './sync.js';

export function startSyncScheduler(
  db: Db,
  key: Buffer,
  intervalSeconds: number,
  log: FastifyBaseLogger,
): () => void {
  const runOnce = async (): Promise<void> => {
    let connections;
    try {
      connections = await listActiveConnections(db);
    } catch (error) {
      log.warn({ err: error }, 'poll sync: could not list connections');
      return;
    }
    for (const connection of connections) {
      try {
        await syncConnection(db, connection, key, 'poll');
      } catch (error) {
        log.warn(
          { err: error, connectionId: connection.id },
          'poll sync failed',
        );
      }
    }
  };

  const timer = setInterval(() => {
    void runOnce();
  }, intervalSeconds * 1000);
  timer.unref();

  return () => clearInterval(timer);
}
