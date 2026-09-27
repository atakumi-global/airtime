export type Role = 'administrator' | 'manager' | 'member';

export type Member = {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  status: 'active' | 'removed';
  feedbackOptIn: boolean;
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
  percentUsed: number | null;
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
  projectionBasis: 'project_end_date' | 'default_horizon' | null;
  flag: 'ok' | 'warning' | 'over' | 'none';
};

export type Project = {
  id: string;
  organisation_id: string;
  plane_project_id: string | null;
  name: string;
  identifier: string | null;
  archived: boolean;
  client_id: string | null;
  start_date: string | null;
  target_date: string | null;
  summary?: BudgetSummary;
};

export type WorkItem = {
  id: string;
  project_id: string | null;
  plane_work_item_id: string;
  identifier: string | null;
  name: string;
  state_group: string | null;
  is_open: boolean;
  project_name: string | null;
  project_identifier: string | null;
};

export type TimeEntry = {
  id: string;
  project_id: string | null;
  member_id: string;
  work_item_id: string | null;
  description: string | null;
  source: 'timer' | 'manual' | string;
  started_at: string;
  ended_at: string;
  duration_minutes: number;
  billable_minutes: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type EntryHistoryEvent = {
  id: string;
  entry_id: string;
  actor_member_id: string;
  action: 'created' | 'updated' | 'deleted' | string;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  created_at: string;
};

export type RunningTimer = {
  member_id: string;
  project_id: string | null;
  work_item_id: string | null;
  description: string | null;
  started_at: string;
};

export type PlaneConnection = {
  baseUrl: string;
  workspaceSlug: string;
  status: string;
  lastVerifiedAt: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  webhookPath: string | null;
};

export type FxRates = {
  base: string;
  date: string | null;
  stale: boolean;
  rates: Record<string, number>;
};

export type Organisation = {
  id: string;
  name: string;
  reportingCurrency: string;
};

export type Budget = {
  id: string;
  project_id: string;
  amount: string;
  currency: string;
};

export type RateScope = 'member' | 'project' | 'client';

export type Rate = {
  id: string;
  scope: RateScope;
  member_id: string | null;
  project_id: string | null;
  client_id: string | null;
  currency: string;
  hourly_amount: string;
};

export type AuditEntry = {
  id: string;
  actor_member_id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  created_at: string;
};

export type FeedbackEvent = {
  id: string;
  member_hash: string;
  action: string;
  source: string | null;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  created_at: string;
};

export type QueuedEntry = {
  id: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type CacheSnapshot = {
  savedAt: string;
  member: Member | null;
  organisation: Organisation | null;
  projects: Project[];
  workItems: WorkItem[];
  entries: TimeEntry[];
  timer: RunningTimer | null;
  queue: QueuedEntry[];
};
