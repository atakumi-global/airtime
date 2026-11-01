import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { Db } from '../db/pool.js';
import { writeAudit } from './audit.js';
import {
  assertCanWriteProject,
  fromClient,
  readableProjectSql,
  type Viewer,
} from './access.js';
import { ValidationError } from './timeEntries.js';
import { convertAmount, getLatestRates, type FxSnapshot } from './fx.js';
import { getPrimaryOrganisation } from './organisations.js';

export const EXPENSE_CATEGORIES = [
  'licences',
  'travel',
  'hardware',
  'subcontractors',
  'other',
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export type ExpenseRow = {
  id: string;
  organisation_id: string;
  project_id: string;
  work_item_id: string | null;
  expense_date: Date | string;
  amount: string;
  currency: string;
  category: ExpenseCategory;
  note: string | null;
  reporting_currency: string | null;
  amount_reporting: string | null;
  fx_rate: string | null;
  fx_date: Date | string | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
};

/** Column list that returns DATE columns as plain text, so no time zone shifts them. */
export const EXPENSE_COLUMNS = `id, organisation_id, project_id, work_item_id,
  expense_date::text AS expense_date, amount, currency, category, note,
  reporting_currency, amount_reporting, fx_rate, fx_date::text AS fx_date,
  created_by, created_at, updated_at, deleted_at`;

export type ExpenseHistoryEvent = {
  id: string;
  actor_member_id: string | null;
  action: string;
  before_state: unknown;
  after_state: unknown;
  created_at: Date;
};

/** The calendar date of a DATE column, whether pg returned a string or a Date. */
export function expenseDateText(value: Date | string): string {
  if (typeof value === 'string') {
    return value.slice(0, 10);
  }
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export type ExpenseConversion = {
  amount: number;
  rate: number;
  date: string | null;
  /** True when the rate comes from the snapshot stored with the expense. */
  recorded: boolean;
  stale: boolean;
};

/**
 * The expense in the reporting currency. The rate and date saved with the
 * expense are used while the reporting currency is unchanged; if it changed,
 * the amount is converted again with the latest rates.
 */
export function convertExpense(
  expense: ExpenseRow,
  reportingCurrency: string,
  snapshot: FxSnapshot,
): ExpenseConversion | null {
  const reporting = reportingCurrency.toUpperCase();
  if (
    expense.amount_reporting !== null &&
    expense.fx_rate !== null &&
    expense.reporting_currency?.toUpperCase() === reporting
  ) {
    return {
      amount: Number(expense.amount_reporting),
      rate: Number(expense.fx_rate),
      date: expense.fx_date ? expenseDateText(expense.fx_date) : null,
      recorded: true,
      stale: false,
    };
  }
  const conversion = convertAmount(
    Number(expense.amount),
    expense.currency,
    reporting,
    snapshot,
  );
  return conversion ? { ...conversion, recorded: false } : null;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function notFound(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 404 });
}

function unprocessable(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 422 });
}

type FxStamp = {
  reportingCurrency: string;
  amountReporting: number;
  rate: number;
  date: string | null;
};

/**
 * Convert an amount to the reporting currency with the latest stored rate and
 * return the rate and date to be recorded with the expense.
 */
async function stampFx(
  db: Db,
  amount: number,
  currency: string,
): Promise<FxStamp> {
  const organisation = await getPrimaryOrganisation(db);
  const reportingCurrency = (organisation?.reporting_currency ?? 'USD').toUpperCase();
  const snapshot = await getLatestRates(db);
  const conversion = convertAmount(amount, currency, reportingCurrency, snapshot);
  if (!conversion) {
    throw unprocessable('fx_rate_unavailable');
  }
  return {
    reportingCurrency,
    amountReporting: conversion.amount,
    rate: conversion.rate,
    date: conversion.date,
  };
}

async function assertWorkItemInProject(
  client: PoolClient,
  organisationId: string,
  projectId: string,
  workItemId: string,
): Promise<void> {
  const result = await client.query(
    `SELECT 1 FROM work_items
      WHERE organisation_id = $1 AND plane_work_item_id = $2 AND project_id = $3`,
    [organisationId, workItemId, projectId],
  );
  if (!result.rows[0]) {
    throw new ValidationError('work_item_not_in_project');
  }
}

export async function listExpenses(
  db: Db,
  organisationId: string,
  viewer: Viewer,
  filter: { projectId?: string; from?: string; to?: string } = {},
): Promise<ExpenseRow[]> {
  const params: unknown[] = [
    organisationId,
    filter.projectId ?? null,
    filter.from ?? null,
    filter.to ?? null,
  ];
  const readable = readableProjectSql(viewer, 'expenses.project_id', params);
  return db.query<ExpenseRow>(
    `SELECT ${EXPENSE_COLUMNS} FROM expenses
      WHERE organisation_id = $1
        AND deleted_at IS NULL
        AND ($2::uuid IS NULL OR project_id = $2)
        AND ($3::date IS NULL OR expense_date >= $3)
        AND ($4::date IS NULL OR expense_date <= $4)
        AND ${readable}
      ORDER BY expense_date DESC, created_at DESC`,
    params,
  );
}

/** An expense on a project the viewer may read; undefined when missing or hidden. */
export async function getExpense(
  db: Db,
  organisationId: string,
  expenseId: string,
  viewer: Viewer,
): Promise<ExpenseRow | undefined> {
  const params: unknown[] = [organisationId, expenseId];
  const readable = readableProjectSql(viewer, 'expenses.project_id', params);
  const rows = await db.query<ExpenseRow>(
    `SELECT ${EXPENSE_COLUMNS} FROM expenses
      WHERE organisation_id = $1 AND id = $2 AND ${readable}`,
    params,
  );
  return rows[0];
}

export type CreateExpenseInput = {
  organisationId: string;
  actorMemberId: string;
  viewer: Viewer;
  projectId: string;
  workItemId?: string | null;
  date: string;
  amount: number;
  currency: string;
  category: ExpenseCategory;
  note?: string | null;
};

export async function createExpense(
  db: Db,
  input: CreateExpenseInput,
): Promise<ExpenseRow> {
  const amount = roundMoney(input.amount);
  const currency = input.currency.toUpperCase();
  const fx = await stampFx(db, amount, currency);
  return db.withTransaction(async (client) => {
    const project = await client.query(
      'SELECT 1 FROM projects WHERE id = $1 AND organisation_id = $2',
      [input.projectId, input.organisationId],
    );
    if (!project.rows[0]) {
      throw notFound('project_not_found');
    }
    await assertCanWriteProject(
      fromClient(client),
      input.organisationId,
      input.viewer,
      input.projectId,
    );
    if (input.workItemId) {
      await assertWorkItemInProject(
        client,
        input.organisationId,
        input.projectId,
        input.workItemId,
      );
    }
    const result = await client.query<ExpenseRow>(
      `INSERT INTO expenses
         (id, organisation_id, project_id, work_item_id, expense_date, amount,
          currency, category, note, reporting_currency, amount_reporting,
          fx_rate, fx_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING ${EXPENSE_COLUMNS}`,
      [
        randomUUID(),
        input.organisationId,
        input.projectId,
        input.workItemId ?? null,
        input.date,
        amount,
        currency,
        input.category,
        input.note ?? null,
        fx.reportingCurrency,
        fx.amountReporting,
        fx.rate,
        fx.date,
        input.actorMemberId,
      ],
    );
    const after = result.rows[0]!;
    await writeAudit(client, {
      organisationId: input.organisationId,
      actorMemberId: input.actorMemberId,
      action: 'expense.created',
      entityType: 'expense',
      entityId: after.id,
      before: null,
      after,
    });
    return after;
  });
}

export type UpdateExpenseInput = {
  organisationId: string;
  actorMemberId: string;
  viewer: Viewer;
  expenseId: string;
  workItemId?: string | null;
  date?: string;
  amount?: number;
  currency?: string;
  category?: ExpenseCategory;
  note?: string | null;
};

export async function updateExpense(
  db: Db,
  input: UpdateExpenseInput,
): Promise<ExpenseRow | null> {
  const current = await getExpense(
    db,
    input.organisationId,
    input.expenseId,
    input.viewer,
  );
  if (!current || current.deleted_at) {
    return null;
  }
  const amount =
    input.amount === undefined ? Number(current.amount) : roundMoney(input.amount);
  const currency = (input.currency ?? current.currency).toUpperCase();
  // The rate and date are re-recorded only when the amount or currency change.
  const reconvert =
    input.amount !== undefined ||
    (input.currency !== undefined && currency !== current.currency);
  const fx = reconvert ? await stampFx(db, amount, currency) : null;

  return db.withTransaction(async (client) => {
    const locked = await client.query<ExpenseRow>(
      `SELECT ${EXPENSE_COLUMNS} FROM expenses
        WHERE organisation_id = $1 AND id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [input.organisationId, input.expenseId],
    );
    const before = locked.rows[0];
    if (!before) {
      return null;
    }
    await assertCanWriteProject(
      fromClient(client),
      input.organisationId,
      input.viewer,
      before.project_id,
    );
    const workItemId =
      input.workItemId === undefined ? before.work_item_id : input.workItemId;
    if (workItemId && input.workItemId !== undefined) {
      await assertWorkItemInProject(
        client,
        input.organisationId,
        before.project_id,
        workItemId,
      );
    }
    const result = await client.query<ExpenseRow>(
      `UPDATE expenses
          SET work_item_id = $1,
              expense_date = $2,
              amount = $3,
              currency = $4,
              category = $5,
              note = $6,
              reporting_currency = $7,
              amount_reporting = $8,
              fx_rate = $9,
              fx_date = $10,
              updated_at = now()
        WHERE id = $11
        RETURNING ${EXPENSE_COLUMNS}`,
      [
        workItemId,
        input.date ?? expenseDateText(before.expense_date),
        amount,
        currency,
        input.category ?? before.category,
        input.note === undefined ? before.note : input.note,
        fx ? fx.reportingCurrency : before.reporting_currency,
        fx ? fx.amountReporting : before.amount_reporting,
        fx ? fx.rate : before.fx_rate,
        fx ? fx.date : before.fx_date,
        before.id,
      ],
    );
    const after = result.rows[0]!;
    await writeAudit(client, {
      organisationId: input.organisationId,
      actorMemberId: input.actorMemberId,
      action: 'expense.updated',
      entityType: 'expense',
      entityId: after.id,
      before,
      after,
    });
    return after;
  });
}

export async function deleteExpense(
  db: Db,
  input: {
    organisationId: string;
    actorMemberId: string;
    viewer: Viewer;
    expenseId: string;
  },
): Promise<boolean> {
  return db.withTransaction(async (client) => {
    const locked = await client.query<ExpenseRow>(
      `SELECT ${EXPENSE_COLUMNS} FROM expenses
        WHERE organisation_id = $1 AND id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [input.organisationId, input.expenseId],
    );
    const before = locked.rows[0];
    if (!before) {
      return false;
    }
    await assertCanWriteProject(
      fromClient(client),
      input.organisationId,
      input.viewer,
      before.project_id,
    );
    const result = await client.query<ExpenseRow>(
      `UPDATE expenses SET deleted_at = now(), updated_at = now()
        WHERE id = $1 RETURNING ${EXPENSE_COLUMNS}`,
      [before.id],
    );
    await writeAudit(client, {
      organisationId: input.organisationId,
      actorMemberId: input.actorMemberId,
      action: 'expense.deleted',
      entityType: 'expense',
      entityId: before.id,
      before,
      after: result.rows[0]!,
    });
    return true;
  });
}

export async function listExpenseHistory(
  db: Db,
  organisationId: string,
  expenseId: string,
): Promise<ExpenseHistoryEvent[]> {
  return db.query<ExpenseHistoryEvent>(
    `SELECT id, actor_member_id, action, before_state, after_state, created_at
       FROM audit_log
      WHERE organisation_id = $1 AND entity_type = 'expense' AND entity_id = $2
      ORDER BY created_at ASC`,
    [organisationId, expenseId],
  );
}
