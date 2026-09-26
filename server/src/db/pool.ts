import pg from 'pg';
import type { Pool, PoolClient, QueryResultRow } from 'pg';

export type Db = {
  pool: Pool;
  query: <R extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ) => Promise<R[]>;
  withTransaction: <T>(fn: (client: PoolClient) => Promise<T>) => Promise<T>;
  close: () => Promise<void>;
};

export function createDb(connectionString: string): Db {
  const pool = new pg.Pool({ connectionString, max: 10 });

  return {
    pool,
    query: async <R extends QueryResultRow = QueryResultRow>(
      text: string,
      params: unknown[] = [],
    ): Promise<R[]> => {
      const result = await pool.query<R>(text, params);
      return result.rows;
    },
    withTransaction: async <T>(fn: (client: PoolClient) => Promise<T>): Promise<T> => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    close: async () => {
      await pool.end();
    },
  };
}
