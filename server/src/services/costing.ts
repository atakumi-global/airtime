import type { Db } from '../db/pool.js';
import { listEntries, type EntryRow } from './timeEntries.js';
import {
  convertAmount,
  getLatestRates,
  type FxSnapshot,
} from './fx.js';
import { getPrimaryOrganisation } from './organisations.js';

export type RateIndex = {
  member: Map<string, RateLookup>;
  project: Map<string, RateLookup>;
  client: Map<string, RateLookup>;
};

export type RateLookup = { currency: string; hourlyAmount: number };

export type RateScope = 'member' | 'project' | 'client';

export type ResolvedRate = { scope: RateScope; rate: RateLookup };

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
  scope: RateScope | null;
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
): ResolvedRate | null {
  const memberRate = index.member.get(entry.member_id);
  if (memberRate) {
    return { scope: 'member', rate: memberRate };
  }
  if (entry.project_id) {
    const projectRate = index.project.get(entry.project_id);
    if (projectRate) {
      return { scope: 'project', rate: projectRate };
    }
  }
  if (projectClientId) {
    const clientRate = index.client.get(projectClientId);
    if (clientRate) {
      return { scope: 'client', rate: clientRate };
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
  const resolved = resolveRate(index, entry, projectClientId);
  if (!resolved) {
    return {
      cost: null,
      currency: null,
      rateApplied: null,
      uncosted: true,
      scope: null,
    };
  }
  const cost = round4(
    (resolved.rate.hourlyAmount * entry.billable_minutes) / 60,
  );
  return {
    cost,
    currency: resolved.rate.currency,
    rateApplied: resolved.rate.hourlyAmount,
    uncosted: false,
    scope: resolved.scope,
  };
}

export type TimesheetEntry = Omit<EntryRow, 'cost' | 'currency' | 'rate_applied'> & {
  cost: number | null;
  cost_currency: string | null;
  cost_uncosted: boolean;
};

export type TimesheetTotals = {
  entryCount: number;
  totalMinutes: number;
  billableMinutes: number;
  cost: number;
  currency: string;
  currencyTotals: Record<string, number>;
  conversions: Record<string, ConversionInfo>;
  fxStale: boolean;
  fxDate: string | null;
  uncosted: { entries: number; minutes: number };
  unconverted: { entries: number; minutes: number };
};

export type Timesheet = {
  entries: TimesheetEntry[];
  totals: TimesheetTotals;
};

export async function getTimesheet(
  db: Db,
  organisationId: string,
  filter: { memberId?: string; from?: string; to?: string } = {},
): Promise<Timesheet> {
  const entries = await listEntries(db, organisationId, filter);
  const index = await buildRateIndex(db, organisationId);

  const clientByProject = new Map<string, string | null>();
  const projectIds = [
    ...new Set(
      entries
        .map((entry) => entry.project_id)
        .filter((projectId): projectId is string => projectId !== null),
    ),
  ];
  if (projectIds.length > 0) {
    const projectRows = await db.query<{ id: string; client_id: string | null }>(
      'SELECT id, client_id FROM projects WHERE organisation_id = $1 AND id = ANY($2::uuid[])',
      [organisationId, projectIds],
    );
    for (const row of projectRows) {
      clientByProject.set(row.id, row.client_id);
    }
  }

  const organisation = await getPrimaryOrganisation(db);
  const reporting = (organisation?.reporting_currency ?? 'USD').toUpperCase();
  const snapshot = await getLatestRates(db);

  let totalMinutes = 0;
  let billableMinutes = 0;
  let cost = 0;
  let uncostedEntries = 0;
  let uncostedMinutes = 0;
  let unconvertedEntries = 0;
  let unconvertedMinutes = 0;
  let fxStale = false;
  const currencyTotals: Record<string, number> = {};
  const conversions: Record<string, ConversionInfo> = {};
  const costedEntries: TimesheetEntry[] = [];

  for (const entry of entries) {
    totalMinutes += entry.duration_minutes;
    billableMinutes += entry.billable_minutes;
    const costed = costEntry(
      index,
      entry,
      entry.project_id ? clientByProject.get(entry.project_id) ?? null : null,
    );
    costedEntries.push({
      ...entry,
      cost: costed.cost,
      cost_currency: costed.currency,
      cost_uncosted: costed.uncosted,
    });
    if (costed.cost === null || costed.currency === null) {
      uncostedEntries += 1;
      uncostedMinutes += entry.billable_minutes;
      continue;
    }
    currencyTotals[costed.currency] = round4(
      (currencyTotals[costed.currency] ?? 0) + costed.cost,
    );
    const conversion = convertAmount(
      costed.cost,
      costed.currency,
      reporting,
      snapshot,
    );
    if (!conversion) {
      unconvertedEntries += 1;
      unconvertedMinutes += entry.billable_minutes;
      continue;
    }
    cost += conversion.amount;
    if (costed.currency.toUpperCase() !== reporting) {
      conversions[costed.currency.toUpperCase()] = {
        rate: conversion.rate,
        date: conversion.date,
        stale: conversion.stale,
      };
      if (conversion.stale) {
        fxStale = true;
      }
    }
  }

  return {
    entries: costedEntries,
    totals: {
      entryCount: entries.length,
      totalMinutes,
      billableMinutes,
      cost: round4(cost),
      currency: reporting,
      currencyTotals,
      conversions,
      fxStale,
      fxDate: snapshot.date,
      uncosted: { entries: uncostedEntries, minutes: uncostedMinutes },
      unconverted: { entries: unconvertedEntries, minutes: unconvertedMinutes },
    },
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
  const budgetRows = await db.query<BudgetFinancials>(
    `SELECT amount, currency, price, profit_target_percent, margin_target_amount
       FROM budgets
      WHERE organisation_id = $1 AND project_id = $2`,
    [organisationId, project.id],
  );
  const entries = await loadEntriesForProject(db, organisationId, project.id);
  const index = await buildRateIndex(db, organisationId);
  const organisation = await getPrimaryOrganisation(db);
  const snapshot = await getLatestRates(db);
  return summarise(
    budgetRows[0] ?? null,
    entries,
    index,
    project.client_id,
    horizonForProject(project.target_date, fallbackHorizonDays),
    {
      reportingCurrency: organisation?.reporting_currency ?? 'USD',
      snapshot,
    },
  );
}

export async function getProjectSummaries(
  db: Db,
  organisationId: string,
): Promise<{
  budgets: Map<string, BudgetFinancials>;
  entriesByProject: Map<string, EntryRow[]>;
  clientByProject: Map<string, string | null>;
  targetDateByProject: Map<string, Date | string | null>;
  index: RateIndex;
  fx: FxContext;
}> {
  const budgets = new Map<string, BudgetFinancials>();
  const budgetRows = await db.query<
    BudgetFinancials & { project_id: string }
  >(
    `SELECT project_id, amount, currency, price, profit_target_percent, margin_target_amount
       FROM budgets
      WHERE organisation_id = $1`,
    [organisationId],
  );
  for (const row of budgetRows) {
    budgets.set(row.project_id, {
      amount: row.amount,
      currency: row.currency,
      price: row.price,
      profit_target_percent: row.profit_target_percent,
      margin_target_amount: row.margin_target_amount,
    });
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
  const organisation = await getPrimaryOrganisation(db);
  const snapshot = await getLatestRates(db);
  return {
    budgets,
    entriesByProject,
    clientByProject,
    targetDateByProject,
    index,
    fx: {
      reportingCurrency: organisation?.reporting_currency ?? 'USD',
      snapshot,
    },
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
    data.fx,
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

export type FxContext = {
  reportingCurrency: string;
  snapshot: FxSnapshot;
};

export type ConversionInfo = {
  rate: number;
  date: string | null;
  stale: boolean;
};

export type BudgetSummary = {
  budget: { amount: number; currency: string } | null;
  convertedBudget: number | null;
  spent: number;
  remaining: number | null;
  margin: number | null;
  percentUsed: number | null;
  price: number | null;
  profit: number | null;
  profitTargetPercent: number | null;
  profitTargetAmount: number | null;
  profitTargetMet: boolean | null;
  marginTargetAmount: number | null;
  marginTargetMet: boolean | null;
  billableMinutes: number;
  costByScope: { member: number; project: number; client: number };
  weeklyCost: Array<{ weekStart: string; cost: number }>;
  currency: string;
  currencyTotals: Record<string, number>;
  conversions: Record<string, ConversionInfo>;
  fxStale: boolean;
  fxDate: string | null;
  unconverted: { entries: number; hours: number };
  uncosted: { entries: number; hours: number };
  burnRatePerDay: number | null;
  projectedOverrun: number | null;
  projectionHorizonDays: number | null;
  projectionBasis: ProjectionBasis | null;
  flag: 'ok' | 'warning' | 'over' | 'none';
};

export type BudgetFinancials = {
  amount: string;
  currency: string;
  price: string | null;
  profit_target_percent: string | null;
  margin_target_amount: string | null;
};

export function isoWeekStart(date: Date): string {
  const start = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const day = (start.getUTCDay() + 6) % 7;
  start.setUTCDate(start.getUTCDate() - day);
  return start.toISOString().slice(0, 10);
}

function weeklySeries(
  weekly: Map<string, number>,
  maxWeeks = 12,
): Array<{ weekStart: string; cost: number }> {
  if (weekly.size === 0) {
    return [];
  }
  const starts: string[] = [];
  const cursor = new Date(`${isoWeekStart(new Date())}T00:00:00.000Z`);
  for (let index = 0; index < maxWeeks; index += 1) {
    starts.unshift(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() - 7);
  }
  const first = [...weekly.keys()].sort()[0]!;
  return starts
    .filter((weekStart) => weekStart >= first)
    .map((weekStart) => ({
      weekStart,
      cost: round4(weekly.get(weekStart) ?? 0),
    }));
}

export function summarise(
  budget: BudgetFinancials | null,
  entries: EntryRow[],
  index: RateIndex,
  projectClientId: string | null | undefined,
  horizon: ProjectionHorizon,
  fx: FxContext,
): BudgetSummary {
  const reporting = fx.reportingCurrency.toUpperCase();
  let spent = 0;
  let billableMinutes = 0;
  let uncostedEntries = 0;
  let uncostedMinutes = 0;
  let unconvertedEntries = 0;
  let unconvertedMinutes = 0;
  let fxStale = false;
  const currencyTotals: Record<string, number> = {};
  const conversions: Record<string, ConversionInfo> = {};
  const costByScope = { member: 0, project: 0, client: 0 };
  const weekly = new Map<string, number>();
  let earliest: number | null = null;

  for (const entry of entries) {
    const started = new Date(entry.started_at).getTime();
    earliest = earliest === null ? started : Math.min(earliest, started);
    billableMinutes += entry.billable_minutes;
    const costed = costEntry(index, entry, projectClientId);
    if (costed.cost === null || costed.currency === null) {
      uncostedEntries += 1;
      uncostedMinutes += entry.billable_minutes;
      continue;
    }
    currencyTotals[costed.currency] = round4(
      (currencyTotals[costed.currency] ?? 0) + costed.cost,
    );
    const conversion = convertAmount(
      costed.cost,
      costed.currency,
      reporting,
      fx.snapshot,
    );
    if (!conversion) {
      unconvertedEntries += 1;
      unconvertedMinutes += entry.billable_minutes;
      continue;
    }
    spent += conversion.amount;
    if (costed.scope) {
      costByScope[costed.scope] = round4(
        costByScope[costed.scope] + conversion.amount,
      );
    }
    const week = isoWeekStart(new Date(entry.started_at));
    weekly.set(week, round4((weekly.get(week) ?? 0) + conversion.amount));
    if (costed.currency !== reporting) {
      conversions[costed.currency] = {
        rate: conversion.rate,
        date: conversion.date,
        stale: conversion.stale,
      };
      if (conversion.stale) {
        fxStale = true;
      }
    }
  }
  spent = round4(spent);
  const weeklyCost = weeklySeries(weekly);

  const uncosted = {
    entries: uncostedEntries,
    hours: round4(uncostedMinutes / 60),
  };
  const unconverted = {
    entries: unconvertedEntries,
    hours: round4(unconvertedMinutes / 60),
  };

  if (!budget) {
    return {
      budget: null,
      convertedBudget: null,
      spent,
      remaining: null,
      margin: null,
      percentUsed: null,
      price: null,
      profit: null,
      profitTargetPercent: null,
      profitTargetAmount: null,
      profitTargetMet: null,
      marginTargetAmount: null,
      marginTargetMet: null,
      billableMinutes,
      costByScope,
      weeklyCost,
      currency: reporting,
      currencyTotals,
      conversions,
      fxStale,
      fxDate: fx.snapshot.date,
      unconverted,
      uncosted,
      burnRatePerDay: null,
      projectedOverrun: null,
      projectionHorizonDays: null,
      projectionBasis: null,
      flag: 'none',
    };
  }

  const amount = Number(budget.amount);
  const convertForProject = (value: number): number | null => {
    const conversion = convertAmount(value, budget.currency, reporting, fx.snapshot);
    if (!conversion) {
      return null;
    }
    if (budget.currency.toUpperCase() !== reporting) {
      conversions[budget.currency.toUpperCase()] = {
        rate: conversion.rate,
        date: conversion.date,
        stale: conversion.stale,
      };
      if (conversion.stale) {
        fxStale = true;
      }
    }
    return conversion.amount;
  };
  const convertedBudget = convertForProject(amount);

  if (convertedBudget === null) {
    return {
      budget: { amount, currency: budget.currency },
      convertedBudget: null,
      spent,
      remaining: null,
      margin: null,
      percentUsed: null,
      price: null,
      profit: null,
      profitTargetPercent:
        budget.profit_target_percent === null
          ? null
          : Number(budget.profit_target_percent),
      profitTargetAmount: null,
      profitTargetMet: null,
      marginTargetAmount: null,
      marginTargetMet: null,
      billableMinutes,
      costByScope,
      weeklyCost,
      currency: reporting,
      currencyTotals,
      conversions,
      fxStale,
      fxDate: fx.snapshot.date,
      unconverted,
      uncosted,
      burnRatePerDay: null,
      projectedOverrun: null,
      projectionHorizonDays: horizon.days,
      projectionBasis: horizon.basis,
      flag: 'none',
    };
  }

  const remaining = round4(convertedBudget - spent);
  const percentUsed =
    convertedBudget > 0 ? round4((spent / convertedBudget) * 100) : null;

  const profitTargetPercent =
    budget.profit_target_percent === null
      ? null
      : Number(budget.profit_target_percent);
  const convertedPrice =
    budget.price === null ? null : convertForProject(Number(budget.price));
  const profit = convertedPrice === null ? null : round4(convertedPrice - spent);
  const profitTargetAmount =
    convertedPrice === null || profitTargetPercent === null
      ? null
      : round4((convertedPrice * profitTargetPercent) / 100);
  const profitTargetMet =
    profit === null || profitTargetAmount === null
      ? null
      : profit >= profitTargetAmount;
  const marginTargetAmount =
    budget.margin_target_amount === null
      ? null
      : convertForProject(Number(budget.margin_target_amount));
  const margin = remaining;
  const marginTargetMet =
    marginTargetAmount === null ? null : margin >= marginTargetAmount;

  const elapsedDays =
    earliest === null
      ? 0
      : Math.max(1, (Date.now() - earliest) / (1000 * 60 * 60 * 24));
  const burnRatePerDay = elapsedDays > 0 ? round4(spent / elapsedDays) : null;
  const projectedTotal =
    burnRatePerDay === null ? null : spent + burnRatePerDay * horizon.days;
  const projectedOverrun =
    projectedTotal === null ? null : round4(projectedTotal - convertedBudget);

  let flag: BudgetSummary['flag'] = 'ok';
  if (spent > convertedBudget) {
    flag = 'over';
  } else if (
    (convertedBudget > 0 && remaining < convertedBudget * 0.1) ||
    marginTargetMet === false ||
    profitTargetMet === false
  ) {
    flag = 'warning';
  }

  return {
    budget: { amount, currency: budget.currency },
    convertedBudget,
    spent,
    remaining,
    margin,
    percentUsed,
    price: convertedPrice,
    profit,
    profitTargetPercent,
    profitTargetAmount,
    profitTargetMet,
    marginTargetAmount,
    marginTargetMet,
    billableMinutes,
    costByScope,
    weeklyCost,
    currency: reporting,
    currencyTotals,
    conversions,
    fxStale,
    fxDate: fx.snapshot.date,
    unconverted,
    uncosted,
    burnRatePerDay,
    projectedOverrun,
    projectionHorizonDays: horizon.days,
    projectionBasis: horizon.basis,
    flag,
  };
}
