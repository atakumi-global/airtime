import type { Db } from '../db/pool.js';
import type { EntryRow } from './timeEntries.js';

export type RateIndex = {
  member: Map<string, RateLookup>;
  project: Map<string, RateLookup>;
  client: Map<string, RateLookup>;
};

export type RateLookup = { currency: string; hourlyAmount: number };

type RateRowLite = {
  scope: 'member' | 'project' | 'client';
  member_id: string | null;
  project_id: string | null;
  client_id: string | null;
  currency: string;
  hourly_amount: string;
};

export type CostedEntry = {
  cost: number | null;
  currency: string | null;
  rateApplied: number | null;
  uncosted: boolean;
};

export async function buildRateIndex(db: Db, organisationId: string): Promise<RateIndex> {
  const rows = await db.query<RateRowLite>(
    'SELECT scope, member_id, project_id, client_id, currency, hourly_amount FROM rates WHERE organisation_id = $1',
    [organisationId],
  );
  const index: RateIndex = {
    member: new Map(),
    project: new Map(),
    client: new Map(),
  };
  for (const row of rows) {
    const lookup: RateLookup = {
      currency: row.currency,
      hourlyAmount: Number(row.hourly_amount),
    };
    if (row.scope === 'member' && row.member_id) {
      index.member.set(row.member_id, lookup);
    } else if (row.scope === 'project' && row.project_id) {
      index.project.set(row.project_id, lookup);
    } else if (row.scope === 'client' && row.client_id) {
      index.client.set(row.client_id, lookup);
    }
  }
  return index;
}

export function resolveRate(
  index: RateIndex,
  entry: Pick<EntryRow, 'member_id' | 'project_id'>,
  projectClientId: string | null | undefined,
): RateLookup | null {
  const memberRate = index.member.get(entry.member_id);
  if (memberRate) {
    return memberRate;
  }
  if (entry.project_id) {
    const projectRate = index.project.get(entry.project_id);
    if (projectRate) {
      return projectRate;
    }
  }
  if (projectClientId) {
    const clientRate = index.client.get(projectClientId);
    if (clientRate) {
      return clientRate;
    }
  }
  return null;
}

export function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function costEntry(
  index: RateIndex,
  entry: EntryRow,
  projectClientId: string | null | undefined,
): CostedEntry {
  const rate = resolveRate(index, entry, projectClientId);
  if (!rate) {
    return { cost: null, currency: null, rateApplied: null, uncosted: true };
  }
  const cost = round4((rate.hourlyAmount * entry.billable_minutes) / 60);
  return {
    cost,
    currency: rate.currency,
    rateApplied: rate.hourlyAmount,
    uncosted: false,
  };
}

export async function loadEntriesForProject(
  db: Db,
  organisationId: string,
  projectId: string,
): Promise<EntryRow[]> {
  return db.query<EntryRow>(
    'SELECT * FROM time_entries WHERE organisation_id = $1 AND project_id = $2 AND deleted_at IS NULL',
    [organisationId, projectId],
  );
}

export async function getProjectBudgetSummary(
  db: Db,
  organisationId: string,
  project: { id: string; client_id: string | null; target_date: Date | string | null },
  fallbackHorizonDays: number,
): Promise<BudgetSummary> {
  const budgetRows = await db.query<{ amount: string; currency: string }>(
    'SELECT amount, currency FROM budgets WHERE organisation_id = $1 AND project_id = $2',
    [organisationId, project.id],
  );
  const entries = await loadEntriesForProject(db, organisationId, project.id);
  const index = await buildRateIndex(db, organisationId);
  return summarise(
    budgetRows[0] ?? null,
    entries,
    index,
    project.client_id,
    horizonForProject(project.target_date, fallbackHorizonDays),
  );
}

export async function getProjectSummaries(
  db: Db,
  organisationId: string,
): Promise<{
  budgets: Map<string, { amount: string; currency: string }>;
  entriesByProject: Map<string, EntryRow[]>;
  clientByProject: Map<string, string | null>;
  targetDateByProject: Map<string, Date | string | null>;
  index: RateIndex;
}> {
  const budgets = new Map<string, { amount: string; currency: string }>();
  const budgetRows = await db.query<{
    project_id: string;
    amount: string;
    currency: string;
  }>(
    'SELECT project_id, amount, currency FROM budgets WHERE organisation_id = $1',
    [organisationId],
  );
  for (const row of budgetRows) {
    budgets.set(row.project_id, { amount: row.amount, currency: row.currency });
  }

  const entriesByProject = new Map<string, EntryRow[]>();
  const entryRows = await db.query<EntryRow>(
    'SELECT * FROM time_entries WHERE organisation_id = $1 AND project_id IS NOT NULL AND deleted_at IS NULL',
    [organisationId],
  );
  for (const entry of entryRows) {
    const list = entriesByProject.get(entry.project_id!);
    if (list) {
      list.push(entry);
    } else {
      entriesByProject.set(entry.project_id!, [entry]);
    }
  }

  const clientByProject = new Map<string, string | null>();
  const targetDateByProject = new Map<string, Date | string | null>();
  const projectRows = await db.query<{
    id: string;
    client_id: string | null;
    target_date: Date | string | null;
  }>('SELECT id, client_id, target_date FROM projects WHERE organisation_id = $1', [
    organisationId,
  ]);
  for (const row of projectRows) {
    clientByProject.set(row.id, row.client_id);
    targetDateByProject.set(row.id, row.target_date);
  }

  const index = await buildRateIndex(db, organisationId);
  return {
    budgets,
    entriesByProject,
    clientByProject,
    targetDateByProject,
    index,
  };
}

export function summariseProject(
  projectId: string,
  data: Awaited<ReturnType<typeof getProjectSummaries>>,
  fallbackHorizonDays: number,
): BudgetSummary {
  return summarise(
    data.budgets.get(projectId) ?? null,
    data.entriesByProject.get(projectId) ?? [],
    data.index,
    data.clientByProject.get(projectId) ?? null,
    horizonForProject(
      data.targetDateByProject.get(projectId) ?? null,
      fallbackHorizonDays,
    ),
  );
}

export type ProjectionBasis = 'project_end_date' | 'default_horizon';

export type ProjectionHorizon = {
  days: number;
  basis: ProjectionBasis;
};

export function horizonForProject(
  targetDate: Date | string | null | undefined,
  fallbackDays: number,
): ProjectionHorizon {
  if (targetDate) {
    const target = new Date(targetDate);
    if (!Number.isNaN(target.getTime())) {
      const days = Math.max(
        0,
        Math.ceil((target.getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
      );
      return { days, basis: 'project_end_date' };
    }
  }
  return { days: fallbackDays, basis: 'default_horizon' };
}

export type BudgetSummary = {
  budget: { amount: number; currency: string } | null;
  spent: number;
  remaining: number | null;
  percentUsed: number | null;
  currency: string | null;
  uncosted: { entries: number; hours: number };
  otherCurrencies: Record<string, number>;
  burnRatePerDay: number | null;
  projectedOverrun: number | null;
  projectionHorizonDays: number | null;
  projectionBasis: ProjectionBasis | null;
  flag: 'ok' | 'warning' | 'over' | 'none';
};

export function summarise(
  budget: { amount: string; currency: string } | null,
  entries: EntryRow[],
  index: RateIndex,
  projectClientId: string | null | undefined,
  horizon: ProjectionHorizon,
): BudgetSummary {
  let spent = 0;
  let uncostedEntries = 0;
  let uncostedMinutes = 0;
  const otherCurrencies: Record<string, number> = {};
  let earliest: number | null = null;

  for (const entry of entries) {
    const started = new Date(entry.started_at).getTime();
    earliest = earliest === null ? started : Math.min(earliest, started);
    const costed = costEntry(index, entry, projectClientId);
    if (costed.cost === null || costed.currency === null) {
      uncostedEntries += 1;
      uncostedMinutes += entry.billable_minutes;
      continue;
    }
    if (!budget || costed.currency === budget.currency) {
      spent += costed.cost;
    } else {
      otherCurrencies[costed.currency] =
        round4((otherCurrencies[costed.currency] ?? 0) + costed.cost);
    }
  }
  spent = round4(spent);

  const uncosted = {
    entries: uncostedEntries,
    hours: round4(uncostedMinutes / 60),
  };

  if (!budget) {
    return {
      budget: null,
      spent,
      remaining: null,
      percentUsed: null,
      currency: null,
      uncosted,
      otherCurrencies,
      burnRatePerDay: null,
      projectedOverrun: null,
      projectionHorizonDays: null,
      projectionBasis: null,
      flag: 'none',
    };
  }

  const amount = Number(budget.amount);
  const remaining = round4(amount - spent);
  const percentUsed = amount > 0 ? round4((spent / amount) * 100) : null;

  const elapsedDays =
    earliest === null
      ? 0
      : Math.max(1, (Date.now() - earliest) / (1000 * 60 * 60 * 24));
  const burnRatePerDay = elapsedDays > 0 ? round4(spent / elapsedDays) : null;
  const projectedTotal =
    burnRatePerDay === null ? null : spent + burnRatePerDay * horizon.days;
  const projectedOverrun =
    projectedTotal === null ? null : round4(projectedTotal - amount);

  let flag: BudgetSummary['flag'] = 'ok';
  if (spent > amount) {
    flag = 'over';
  } else if (amount > 0 && remaining < amount * 0.1) {
    flag = 'warning';
  }

  return {
    budget: { amount, currency: budget.currency },
    spent,
    remaining,
    percentUsed,
    currency: budget.currency,
    uncosted,
    otherCurrencies,
    burnRatePerDay,
    projectedOverrun,
    projectionHorizonDays: horizon.days,
    projectionBasis: horizon.basis,
    flag,
  };
}
