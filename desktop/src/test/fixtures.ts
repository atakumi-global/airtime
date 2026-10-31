import type {
  BudgetSummary,
  FxRates,
  Member,
  Organisation,
  Project,
  QueuedEntry,
  RunningTimer,
  TimeEntry,
  WorkItem,
} from '../lib/types';

export const ADMIN: Member = {
  id: 'member-admin',
  email: 'ada@example.test',
  displayName: 'Ada Admin',
  role: 'administrator',
  status: 'active',
  feedbackOptIn: false,
};

export const MANAGER: Member = {
  ...ADMIN,
  id: 'member-manager',
  email: 'mia@example.test',
  displayName: 'Mia Manager',
  role: 'manager',
};

export const PLAIN_MEMBER: Member = {
  ...ADMIN,
  id: 'member-plain',
  email: 'max@example.test',
  displayName: 'Max Member',
  role: 'member',
};

export const ORGANISATION: Organisation = {
  id: 'org-1',
  name: 'Example Org',
  reportingCurrency: 'EUR',
};

export const FX: FxRates = {
  base: 'EUR',
  date: '2026-09-01',
  stale: false,
  rates: { USD: 1.1 },
};

export const WORK_ITEMS: WorkItem[] = [
  {
    id: 'wi-1',
    project_id: 'project-1',
    plane_work_item_id: 'plane-wi-1',
    identifier: 'WEB-1',
    name: 'Build the landing page',
    state_group: 'started',
    is_open: true,
    project_name: 'Website',
    project_identifier: 'WEB',
  },
  {
    id: 'wi-2',
    project_id: 'project-1',
    plane_work_item_id: 'plane-wi-2',
    identifier: 'WEB-2',
    name: 'Fix the footer',
    state_group: 'unstarted',
    is_open: true,
    project_name: 'Website',
    project_identifier: 'WEB',
  },
];

export function summary(overrides: Partial<BudgetSummary> = {}): BudgetSummary {
  return {
    budget: { amount: 1000, currency: 'EUR' },
    convertedBudget: 1000,
    spent: 400,
    remaining: 600,
    margin: 600,
    percentUsed: 40,
    price: 2000,
    profit: 1600,
    profitTargetPercent: 35,
    profitTargetAmount: 700,
    profitTargetMet: true,
    marginTargetAmount: 500,
    marginTargetMet: true,
    billableMinutes: 400,
    costByScope: { member: 0, project: 400, client: 0 },
    weeklyCost: [],
    currency: 'EUR',
    currencyTotals: { EUR: 400 },
    conversions: {},
    fxStale: false,
    fxDate: '2026-09-01',
    unconverted: { entries: 0, hours: 0 },
    uncosted: { entries: 0, hours: 0 },
    burnRatePerDay: 20,
    projectedOverrun: null,
    projectionHorizonDays: 30,
    projectionBasis: 'default_horizon',
    flag: 'ok',
    ...overrides,
  };
}

export const PROJECTS: Project[] = [
  {
    id: 'project-1',
    organisation_id: 'org-1',
    plane_project_id: 'plane-project-1',
    name: 'Website',
    identifier: 'WEB',
    archived: false,
    client_id: null,
    start_date: null,
    target_date: null,
    summary: summary(),
  },
  {
    id: 'project-2',
    organisation_id: 'org-1',
    plane_project_id: 'plane-project-2',
    name: 'Mobile app',
    identifier: 'APP',
    archived: false,
    client_id: null,
    start_date: null,
    target_date: null,
    summary: summary({
      budget: null,
      convertedBudget: null,
      flag: 'none',
      percentUsed: null,
      price: null,
    }),
  },
];

export function timeEntry(overrides: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: 'entry-1',
    project_id: 'project-1',
    member_id: ADMIN.id,
    work_item_id: 'plane-wi-1',
    description: 'Wired up the hero',
    source: 'manual',
    started_at: '2026-09-02T09:00:00.000Z',
    ended_at: '2026-09-02T10:30:00.000Z',
    duration_minutes: 90,
    billable_minutes: 90,
    created_at: '2026-09-02T10:30:00.000Z',
    updated_at: '2026-09-02T10:30:00.000Z',
    deleted_at: null,
    ...overrides,
  };
}

export function runningTimer(overrides: Partial<RunningTimer> = {}): RunningTimer {
  return {
    member_id: ADMIN.id,
    project_id: 'project-1',
    work_item_id: 'plane-wi-1',
    description: 'WEB-1 Build the landing page',
    started_at: new Date(Date.now() - 60_000).toISOString(),
    state: 'running',
    paused_at: null,
    paused_seconds: 0,
    ...overrides,
  };
}

export function queuedEntry(id: string, overrides: Record<string, unknown> = {}): QueuedEntry {
  return {
    id,
    createdAt: '2026-09-02T10:00:00.000Z',
    payload: {
      workItemId: 'plane-wi-1',
      date: '2026-09-02',
      durationMinutes: 30,
      description: `queued ${id}`,
      ...overrides,
    },
  };
}
