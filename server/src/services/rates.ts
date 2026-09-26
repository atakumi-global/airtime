import { randomUUID } from 'node:crypto';
import type { Db } from '../db/pool.js';
import { writeAudit } from './audit.js';

export type RateScope = 'member' | 'project' | 'client';

export type RateRow = {
  id: string;
  organisation_id: string;
  scope: RateScope;
  member_id: string | null;
  project_id: string | null;
  client_id: string | null;
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
  clientId?: string | null;
  currency: string;
  hourlyAmount: number;
};

export async function listRates(
  db: Db,
  organisationId: string,
): Promise<RateRow[]> {
  return db.query<RateRow>(
    'SELECT * FROM rates WHERE organisation_id = $1 ORDER BY scope ASC, created_at ASC',
    [organisationId],
  );
}

function referenceColumn(input: UpsertRateInput): {
  column: 'member_id' | 'project_id' | 'client_id';
  value: string;
} {
  if (input.scope === 'member') {
    if (!input.memberId) {
      throw Object.assign(new Error('member rate requires memberId'), {
        statusCode: 400,
      });
    }
    return { column: 'member_id', value: input.memberId };
  }
  if (input.scope === 'project') {
    if (!input.projectId) {
      throw Object.assign(new Error('project rate requires projectId'), {
        statusCode: 400,
      });
    }
    return { column: 'project_id', value: input.projectId };
  }
  if (!input.clientId) {
    throw Object.assign(new Error('client rate requires clientId'), {
      statusCode: 400,
    });
  }
  return { column: 'client_id', value: input.clientId };
}

async function assertReferenceBelongsToOrg(
  db: Db,
  input: UpsertRateInput,
): Promise<void> {
  if (input.scope === 'member') {
    const rows = await db.query(
      'SELECT 1 FROM members WHERE id = $1 AND organisation_id = $2',
      [input.memberId, input.organisationId],
    );
    if (!rows[0]) {
      throw Object.assign(new Error('member not found'), { statusCode: 404 });
    }
  }
  if (input.scope === 'project') {
    const rows = await db.query(
      'SELECT 1 FROM projects WHERE id = $1 AND organisation_id = $2',
      [input.projectId, input.organisationId],
    );
    if (!rows[0]) {
      throw Object.assign(new Error('project not found'), { statusCode: 404 });
    }
  }
}

export async function upsertRate(
  db: Db,
  input: UpsertRateInput,
): Promise<RateRow> {
  await assertReferenceBelongsToOrg(db, input);
  const { column, value } = referenceColumn(input);

  return db.withTransaction(async (client) => {
    const existing = await client.query<RateRow>(
      `SELECT * FROM rates WHERE organisation_id = $1 AND ${column} = $2 FOR UPDATE`,
      [input.organisationId, value],
    );
    const before = existing.rows[0] ?? null;

    const rows = before
      ? await client.query<RateRow>(
          `UPDATE rates
              SET currency = $1, hourly_amount = $2, updated_at = now()
            WHERE id = $3
            RETURNING *`,
          [input.currency.toUpperCase(), input.hourlyAmount, before.id],
        )
      : await client.query<RateRow>(
          `INSERT INTO rates
             (id, organisation_id, scope, member_id, project_id, client_id, currency, hourly_amount)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING *`,
          [
            randomUUID(),
            input.organisationId,
            input.scope,
            input.memberId ?? null,
            input.projectId ?? null,
            input.clientId ?? null,
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
      'SELECT * FROM rates WHERE organisation_id = $1 AND id = $2 FOR UPDATE',
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
