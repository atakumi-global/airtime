import { randomUUID } from 'node:crypto';
import type { Db } from '../db/pool.js';
import { writeAudit } from './audit.js';

export type RateScope = 'member' | 'project' | 'project_member';

export type RateRow = {
  id: string;
  organisation_id: string;
  scope: RateScope;
  member_id: string | null;
  project_id: string | null;
  from_date: string;
  currency: string;
  hourly_amount: string;
  created_at: Date;
  updated_at: Date;
};

export type UpsertRateInput = {
  organisationId: string;
  actorMemberId: string;
  scope: RateScope;
  memberId?: string | null;
  projectId?: string | null;
  fromDate: string;
  currency: string;
  hourlyAmount: number;
};

// `from_date` is a plain calendar date; it is selected as text so the driver never
// shifts it through the server time zone.
const RATE_COLUMNS = `id, organisation_id, scope, member_id, project_id,
  to_char(from_date, 'YYYY-MM-DD') AS from_date, currency, hourly_amount,
  created_at, updated_at`;

export async function listRates(
  db: Db,
  organisationId: string,
): Promise<RateRow[]> {
  return db.query<RateRow>(
    `SELECT ${RATE_COLUMNS} FROM rates WHERE organisation_id = $1
      ORDER BY scope ASC, from_date DESC, created_at ASC`,
    [organisationId],
  );
}

function httpError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

function requireReferences(input: UpsertRateInput): {
  memberId: string | null;
  projectId: string | null;
} {
  if (input.scope === 'member') {
    if (!input.memberId) {
      throw httpError('member rate requires memberId', 400);
    }
    return { memberId: input.memberId, projectId: null };
  }
  if (input.scope === 'project') {
    if (!input.projectId) {
      throw httpError('project rate requires projectId', 400);
    }
    return { memberId: null, projectId: input.projectId };
  }
  if (input.scope === 'project_member') {
    if (!input.memberId || !input.projectId) {
      throw httpError('project_member rate requires memberId and projectId', 400);
    }
    return { memberId: input.memberId, projectId: input.projectId };
  }
  throw httpError('unsupported rate scope', 400);
}

async function assertReferencesBelongToOrg(
  db: Db,
  organisationId: string,
  refs: { memberId: string | null; projectId: string | null },
): Promise<void> {
  if (refs.memberId) {
    const rows = await db.query(
      'SELECT 1 FROM members WHERE id = $1 AND organisation_id = $2',
      [refs.memberId, organisationId],
    );
    if (!rows[0]) {
      throw httpError('member not found', 404);
    }
  }
  if (refs.projectId) {
    const rows = await db.query(
      'SELECT 1 FROM projects WHERE id = $1 AND organisation_id = $2',
      [refs.projectId, organisationId],
    );
    if (!rows[0]) {
      throw httpError('project not found', 404);
    }
  }
}

export async function upsertRate(
  db: Db,
  input: UpsertRateInput,
): Promise<RateRow> {
  const refs = requireReferences(input);
  await assertReferencesBelongToOrg(db, input.organisationId, refs);

  return db.withTransaction(async (client) => {
    // Same scope, same target and same from-date is the same rate: update it.
    const existing = await client.query<RateRow>(
      `SELECT ${RATE_COLUMNS} FROM rates
        WHERE organisation_id = $1
          AND scope = $2
          AND member_id IS NOT DISTINCT FROM $3::uuid
          AND project_id IS NOT DISTINCT FROM $4::uuid
          AND from_date = $5::date
        FOR UPDATE`,
      [input.organisationId, input.scope, refs.memberId, refs.projectId, input.fromDate],
    );
    const before = existing.rows[0] ?? null;

    const rows = before
      ? await client.query<RateRow>(
          `UPDATE rates
              SET currency = $1, hourly_amount = $2, updated_at = now()
            WHERE id = $3
            RETURNING ${RATE_COLUMNS}`,
          [input.currency.toUpperCase(), input.hourlyAmount, before.id],
        )
      : await client.query<RateRow>(
          `INSERT INTO rates
             (id, organisation_id, scope, member_id, project_id, from_date, currency, hourly_amount)
           VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8)
           RETURNING ${RATE_COLUMNS}`,
          [
            randomUUID(),
            input.organisationId,
            input.scope,
            refs.memberId,
            refs.projectId,
            input.fromDate,
            input.currency.toUpperCase(),
            input.hourlyAmount,
          ],
        );
    const after = rows.rows[0]!;

    await writeAudit(client, {
      organisationId: input.organisationId,
      actorMemberId: input.actorMemberId,
      action: before ? 'rate.updated' : 'rate.created',
      entityType: 'rate',
      entityId: after.id,
      before,
      after,
    });

    return after;
  });
}

export async function deleteRate(
  db: Db,
  input: { organisationId: string; actorMemberId: string; rateId: string },
): Promise<boolean> {
  return db.withTransaction(async (client) => {
    const existing = await client.query<RateRow>(
      `SELECT ${RATE_COLUMNS} FROM rates WHERE organisation_id = $1 AND id = $2 FOR UPDATE`,
      [input.organisationId, input.rateId],
    );
    const before = existing.rows[0];
    if (!before) {
      return false;
    }
    await client.query('DELETE FROM rates WHERE id = $1', [input.rateId]);
    await writeAudit(client, {
      organisationId: input.organisationId,
      actorMemberId: input.actorMemberId,
      action: 'rate.deleted',
      entityType: 'rate',
      entityId: input.rateId,
      before,
      after: null,
    });
    return true;
  });
}
