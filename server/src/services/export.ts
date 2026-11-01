import type { Db } from '../db/pool.js';
import type { EntryRow } from './timeEntries.js';
import { buildRateIndex, costEntry } from './costing.js';
import { convertAmount, getLatestRates } from './fx.js';
import { getPrimaryOrganisation } from './organisations.js';
import { readableOrUnassignedSql, readableProjectSql, type Viewer } from './access.js';
import { convertExpense, expenseDateText, type ExpenseRow } from './expenses.js';

export type ExportFilter = {
  memberId?: string;
  projectId?: string;
  from?: string;
  to?: string;
};

type ExportRow = EntryRow & {
  member_name: string;
  project_name: string | null;
  project_identifier: string | null;
  project_client_id: string | null;
  work_item_identifier: string | null;
  work_item_name: string | null;
};

type ExpenseExportRow = ExpenseRow & {
  creator_name: string | null;
  project_name: string | null;
  work_item_identifier: string | null;
};

export function csvField(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  let text = String(value);
  // Text starting with a formula trigger is prefixed with a single quote so
  // spreadsheets show it as text. Numbers are not user text and stay as they are.
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function dateOnly(value: Date): string {
  return new Date(value).toISOString().slice(0, 10);
}

export async function buildTimeEntriesCsv(
  db: Db,
  organisationId: string,
  viewer: Viewer,
  filter: ExportFilter,
): Promise<string> {
  const entryParams: unknown[] = [
    organisationId,
    filter.memberId ?? null,
    filter.projectId ?? null,
    filter.from ?? null,
    filter.to ?? null,
  ];
  const entryReadable = readableOrUnassignedSql(viewer, 'e.project_id', entryParams);
  const rows = await db.query<ExportRow>(
    `SELECT e.*,
            m.display_name AS member_name,
            p.name AS project_name,
            p.identifier AS project_identifier,
            p.client_id AS project_client_id,
            w.identifier AS work_item_identifier,
            w.name AS work_item_name
       FROM time_entries e
       JOIN members m ON m.id = e.member_id
       LEFT JOIN projects p ON p.id = e.project_id
       LEFT JOIN work_items w
              ON w.organisation_id = e.organisation_id
             AND w.plane_work_item_id = e.work_item_id
      WHERE e.organisation_id = $1
        AND e.deleted_at IS NULL
        AND ($2::uuid IS NULL OR e.member_id = $2)
        AND ($3::uuid IS NULL OR e.project_id = $3)
        AND ($4::timestamptz IS NULL OR e.ended_at >= $4)
        AND ($5::timestamptz IS NULL OR e.started_at <= $5)
        AND ${entryReadable}
      ORDER BY e.started_at ASC`,
    entryParams,
  );

  const organisation = await getPrimaryOrganisation(db);
  const reportingCurrency = organisation?.reporting_currency ?? 'USD';
  const snapshot = await getLatestRates(db);
  const index = await buildRateIndex(db, organisationId);

  const header = [
    'project',
    'member',
    'date',
    'duration_minutes',
    'billable_minutes',
    'work_item',
    'description',
    'source',
    'rate',
    'currency',
    'cost',
    'cost_reporting_currency',
    'reporting_currency',
    'fx_rate',
    'fx_date',
    'fx_stale',
    'type',
    'category',
  ];

  const lines = [header.join(',')];
  for (const row of rows) {
    const costed = costEntry(index, row, row.project_client_id);
    let costReporting: number | '' = '';
    let fxRate: number | '' = '';
    let fxDate = '';
    let fxStale = '';
    if (costed.cost !== null && costed.currency !== null) {
      const conversion = convertAmount(
        costed.cost,
        costed.currency,
        reportingCurrency,
        snapshot,
      );
      if (conversion) {
        costReporting = conversion.amount;
        fxRate = conversion.rate;
        fxDate = conversion.date ?? '';
        fxStale = String(conversion.stale);
      }
    }

    lines.push(
      [
        row.project_name ?? '',
        row.member_name,
        dateOnly(row.started_at),
        row.duration_minutes,
        row.billable_minutes,
        row.work_item_identifier ?? row.work_item_id ?? '',
        row.description ?? '',
        row.source,
        costed.rateApplied ?? '',
        costed.currency ?? '',
        costed.cost ?? '',
        costReporting,
        reportingCurrency,
        fxRate,
        fxDate,
        fxStale,
        'time',
        '',
      ]
        .map(csvField)
        .join(','),
    );
  }

  const expenseParams: unknown[] = [
    organisationId,
    filter.projectId ?? null,
    filter.from ?? null,
    filter.to ?? null,
  ];
  const expenseReadable = readableProjectSql(viewer, 'x.project_id', expenseParams);
  // Expenses are not tied to a member's time, so a member filter excludes them.
  const expenseRows = filter.memberId
    ? []
    : await db.query<ExpenseExportRow>(
        `SELECT x.id, x.organisation_id, x.project_id, x.work_item_id,
                x.expense_date::text AS expense_date, x.amount, x.currency,
                x.category, x.note, x.reporting_currency, x.amount_reporting,
                x.fx_rate, x.fx_date::text AS fx_date, x.created_by,
                x.created_at, x.updated_at, x.deleted_at,
                m.display_name AS creator_name,
                p.name AS project_name,
                w.identifier AS work_item_identifier
           FROM expenses x
           JOIN projects p ON p.id = x.project_id
           LEFT JOIN members m ON m.id = x.created_by
           LEFT JOIN work_items w
                  ON w.organisation_id = x.organisation_id
                 AND w.plane_work_item_id = x.work_item_id
          WHERE x.organisation_id = $1
            AND x.deleted_at IS NULL
            AND ($2::uuid IS NULL OR x.project_id = $2)
            AND ($3::timestamptz IS NULL
                 OR x.expense_date >= (($3::timestamptz) AT TIME ZONE 'UTC')::date)
            AND ($4::timestamptz IS NULL
                 OR x.expense_date <= (($4::timestamptz) AT TIME ZONE 'UTC')::date)
            AND ${expenseReadable}
          ORDER BY x.expense_date ASC, x.created_at ASC`,
        expenseParams,
      );

  for (const row of expenseRows) {
    const conversion = convertExpense(row, reportingCurrency, snapshot);
    lines.push(
      [
        row.project_name ?? '',
        row.creator_name ?? '',
        expenseDateText(row.expense_date),
        '',
        '',
        row.work_item_identifier ?? row.work_item_id ?? '',
        row.note ?? '',
        'expense',
        '',
        row.currency,
        Number(row.amount),
        conversion ? conversion.amount : '',
        reportingCurrency,
        conversion ? conversion.rate : '',
        conversion ? conversion.date ?? '' : '',
        conversion ? String(conversion.stale) : '',
        'expense',
        row.category,
      ]
        .map(csvField)
        .join(','),
    );
  }

  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
