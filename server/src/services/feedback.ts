import { createHmac, randomUUID } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import type { Db } from '../db/pool.js';
import type { EntryRow } from './timeEntries.js';

let salt = '';

export function setFeedbackSalt(value: string): void {
  salt = value;
}

export function hashMember(memberId: string, value = salt): string {
  return createHmac('sha256', value).update(memberId).digest('hex');
}

export function sanitiseEntry(
  entry: EntryRow | null,
): Record<string, unknown> | null {
  if (!entry) {
    return null;
  }
  return {
    source: entry.source,
    duration_minutes: entry.duration_minutes,
    billable_minutes: entry.billable_minutes,
    started_at: entry.started_at,
    ended_at: entry.ended_at,
    work_item_id: entry.work_item_id,
    project_id: entry.project_id,
  };
}

export type RecordFeedbackInput = {
  organisationId: string;
  memberId: string;
  action: 'created' | 'updated' | 'deleted';
  before: EntryRow | null;
  after: EntryRow | null;
};

export async function recordFeedback(
  client: PoolClient,
  input: RecordFeedbackInput,
): Promise<void> {
  const member = await client.query<{ feedback_opt_in: boolean }>(
    'SELECT feedback_opt_in FROM members WHERE id = $1',
    [input.memberId],
  );
  if (!member.rows[0]?.feedback_opt_in) {
    return;
  }

  const source = (input.after ?? input.before)?.source ?? null;
  await client.query(
    `INSERT INTO feedback_events
       (id, organisation_id, member_hash, action, source, before_state, after_state)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      randomUUID(),
      input.organisationId,
      hashMember(input.memberId),
      input.action,
      source,
      JSON.stringify(sanitiseEntry(input.before)),
      JSON.stringify(sanitiseEntry(input.after)),
    ],
  );
}

export async function listFeedbackEvents(
  db: Db,
  organisationId: string,
  limit = 200,
): Promise<QueryResultRow[]> {
  return db.query(
    `SELECT id, member_hash, action, source, before_state, after_state, created_at
       FROM feedback_events
      WHERE organisation_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [organisationId, Math.min(Math.max(limit, 1), 1000)],
  );
}

export async function exportFeedbackDataset(
  db: Db,
  organisationId: string,
): Promise<QueryResultRow[]> {
  return db.query(
    `SELECT member_hash, action, source, before_state, after_state, created_at
       FROM feedback_events
      WHERE organisation_id = $1
      ORDER BY created_at ASC`,
    [organisationId],
  );
}
