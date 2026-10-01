import { randomUUID } from 'node:crypto';
import type { Db } from '../db/pool.js';
import { writeAudit } from './audit.js';

export type BudgetRow = {
  id: string;
  organisation_id: string;
  project_id: string;
  amount: string;
  currency: string;
  price: string | null;
  profit_target_percent: string | null;
  margin_target_amount: string | null;
  created_at: Date;
  updated_at: Date;
};

export async function getBudget(
  db: Db,
  organisationId: string,
  projectId: string,
): Promise<BudgetRow | undefined> {
  const rows = await db.query<BudgetRow>(
    'SELECT * FROM budgets WHERE organisation_id = $1 AND project_id = $2',
    [organisationId, projectId],
  );
  return rows[0];
}

export type UpsertBudgetInput = {
  organisationId: string;
  actorMemberId: string;
  projectId: string;
  amount: number;
  currency: string;
  price?: number | null;
  profitTargetPercent?: number | null;
  marginTargetAmount?: number | null;
};

export async function upsertBudget(
  db: Db,
  input: UpsertBudgetInput,
): Promise<BudgetRow> {
  return db.withTransaction(async (client) => {
    const project = await client.query(
      'SELECT 1 FROM projects WHERE id = $1 AND organisation_id = $2',
      [input.projectId, input.organisationId],
    );
    if (!project.rows[0]) {
      throw Object.assign(new Error('project not found'), { statusCode: 404 });
    }

    const existing = await client.query<BudgetRow>(
      'SELECT * FROM budgets WHERE organisation_id = $1 AND project_id = $2 FOR UPDATE',
      [input.organisationId, input.projectId],
    );
    const before = existing.rows[0] ?? null;

    const fields = [
      input.amount,
      input.currency.toUpperCase(),
      input.price ?? null,
      input.profitTargetPercent ?? null,
      input.marginTargetAmount ?? null,
    ];
    const rows = before
      ? await client.query<BudgetRow>(
          `UPDATE budgets
              SET amount = $1,
                  currency = $2,
                  price = $3,
                  profit_target_percent = $4,
                  margin_target_amount = $5,
                  updated_at = now()
            WHERE id = $6
            RETURNING *`,
          [...fields, before.id],
        )
      : await client.query<BudgetRow>(
          `INSERT INTO budgets
             (id, organisation_id, project_id, amount, currency,
              price, profit_target_percent, margin_target_amount)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING *`,
          [
            randomUUID(),
            input.organisationId,
            input.projectId,
            ...fields,
          ],
        );
    const after = rows.rows[0]!;

    await writeAudit(client, {
      organisationId: input.organisationId,
      actorMemberId: input.actorMemberId,
      action: before ? 'budget.updated' : 'budget.created',
      entityType: 'budget',
      entityId: after.id,
      before,
      after,
    });

    return after;
  });
}

export async function deleteBudget(
  db: Db,
  input: { organisationId: string; actorMemberId: string; projectId: string },
): Promise<boolean> {
  return db.withTransaction(async (client) => {
    const existing = await client.query<BudgetRow>(
      'SELECT * FROM budgets WHERE organisation_id = $1 AND project_id = $2 FOR UPDATE',
      [input.organisationId, input.projectId],
    );
    const before = existing.rows[0];
    if (!before) {
      return false;
    }
    await client.query('DELETE FROM budgets WHERE id = $1', [before.id]);
    await writeAudit(client, {
      organisationId: input.organisationId,
      actorMemberId: input.actorMemberId,
      action: 'budget.deleted',
      entityType: 'budget',
      entityId: before.id,
      before,
      after: null,
    });
    return true;
  });
}
