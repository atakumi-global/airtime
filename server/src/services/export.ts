import type { Db } from '../db/pool.js';
import type { EntryRow } from './timeEntries.js';
import { buildRateIndex, costEntry } from './costing.js';
import { convertAmount, getLatestRates } from './fx.js';
import { getPrimaryOrganisation } from './organisations.js';

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

export function csvField(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  const text = String(value);
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
  filter: ExportFilter,
): Promise<string> {
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
      ORDER BY e.started_at ASC`,
    [
      organisationId,
      filter.memberId ?? null,
      filter.projectId ?? null,
      filter.from ?? null,
      filter.to ?? null,
    ],
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
  ];

  const lines = [header.join(',')];
  for (const row of rows) {
    const costed = costEntry(index, row, row.project_client_id);
    let costReporting = '';
    let fxRate = '';
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
        costReporting = String(conversion.amount);
        fxRate = String(conversion.rate);
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
      ]
        .map(csvField)
        .join(','),
    );
  }

  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
