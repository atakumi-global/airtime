import { randomUUID } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import type { Db } from '../db/pool.js';

export type AuditInput = {
  organisationId: string;
  actorMemberId: string;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
};

export type AuditRow = {
  id: string;
  organisation_id: string;
  actor_member_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before_state: unknown;
  after_state: unknown;
  created_at: Date;
};

export async function writeAudit(
  client: PoolClient,
  input: AuditInput,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_log
       (id, organisation_id, actor_member_id, action, entity_type, entity_id, before_state, after_state)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      randomUUID(),
      input.organisationId,
      input.actorMemberId,
      input.action,
      input.entityType,
      input.entityId,
      input.before === undefined ? null : JSON.stringify(input.before),
      input.after === undefined ? null : JSON.stringify(input.after),
    ],
  );
}

export async function listAudit(
  db: Db,
  organisationId: string,
  limit = 100,
): Promise<QueryResultRow[]> {
  return db.query(
    `SELECT id, actor_member_id, action, entity_type, entity_id,
            before_state, after_state, created_at
       FROM audit_log
      WHERE organisation_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [organisationId, Math.min(Math.max(limit, 1), 500)],
  );
}
