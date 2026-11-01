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

export type ExpenseCategory =
  | 'licences'
  | 'travel'
  | 'hardware'
  | 'subcontractors'
  | 'other';

export type ExpenseSummary = {
  total: number;
  count: number;
  byCategory: Record<ExpenseCategory, number>;
  currencyTotals: Record<string, number>;
  unconverted: number;
};

export type Expense = {
  id: string;
  project_id: string;
  work_item_id: string | null;
  expense_date: string;
  amount: string;
  currency: string;
  category: ExpenseCategory;
  note: string | null;
  reporting_currency: string | null;
  amount_reporting: string | null;
  fx_rate: string | null;
  fx_date: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type ExpenseInput = {
  date: string;
  amount: number;
  currency: string;
  category: ExpenseCategory;
  note?: string | null;
  workItemId?: string | null;
};

export type ExpenseHistoryEvent = {
  id: string;
  actor_member_id: string | null;
  action: 'expense.created' | 'expense.updated' | 'expense.deleted' | string;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  created_at: string;
};

export type BudgetSummary = {
  budget: { amount: number; currency: string } | null;
  convertedBudget: number | null;
  /** Cost: labour at cost levels plus expenses, in the reporting currency. */
  spent: number;
  labourCost: number;
  expenses: ExpenseSummary;
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
  costByScope: {
    member: number;
    project: number;
    projectMember: number;
    default: number;
  };
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
  projectionBasis: 'project_end_date' | 'default_horizon' | null;
  flag: 'ok' | 'warning' | 'over' | 'none';
};

export type Project = {
  id: string;
  organisation_id: string;
  plane_project_id: string | null;
  /** The Plane workspace (slug) the project belongs to; null for a project not linked to Plane. */
  workspace_slug?: string | null;
  name: string;
  identifier: string | null;
  archived: boolean;
  client_id: string | null;
  start_date: string | null;
  target_date: string | null;
  summary?: BudgetSummary;
  /** False when the project is history only: it stays readable but takes no new time. */
  can_enter_time?: boolean;
};

export type WorkItem = {
  id: string;
  project_id: string | null;
  plane_work_item_id: string;
  identifier: string | null;
  name: string;
  state_group: string | null;
  is_open: boolean;
  /** The Plane workspace (slug) the work item came from. */
  workspace_slug?: string | null;
  project_name: string | null;
  project_identifier: string | null;
  /** True when the project is archived in Plane: history only, no new time. */
  project_archived?: boolean;
  /** False when the work item is history only: it stays readable but takes no new time. */
  can_enter_time?: boolean;
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
  /** The Plane workspace of the entry's project, when the server knows it. */
  workspace_slug?: string | null;
};

export type CostedTimeEntry = TimeEntry & {
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
  entries: CostedTimeEntry[];
  totals: TimesheetTotals;
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
  /** The Plane workspace of the timer's work item. */
  workspace_slug?: string | null;
  started_at: string;
  /** Absent in caches written before the paused state existed; treated as running. */
  state?: 'running' | 'paused';
  /** Set while paused. */
  paused_at?: string | null;
  /** Seconds already spent paused before the current pause. */
  paused_seconds?: number;
};

export type TimerState = 'idle' | 'running' | 'paused';

export type WorkspaceStatus = 'pending' | 'verified' | 'failed';

export type PlaneWorkspace = {
  slug: string;
  status: WorkspaceStatus;
  errorCategory: 'unauthorised' | 'not_found' | 'network' | null;
  error: string | null;
  projectCount: number | null;
  lastVerifiedAt: string | null;
  lastSyncedAt: string | null;
  /** Each workspace has its own webhook in Plane. */
  webhookPath: string | null;
};

export type PlaneConnection = {
  baseUrl: string;
  workspaces: PlaneWorkspace[];
  status: string;
  lastVerifiedAt: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
};

export type WorkspaceSyncResult = {
  slug: string;
  status: 'ok' | 'failed';
  projects: number;
  workItems: number;
  error: string | null;
};

export type PlaneSyncSummary = {
  projects: number;
  workItems: number;
  workspaces?: WorkspaceSyncResult[];
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
  defaultHourlyRate: number;
};

export type Budget = {
  id: string;
  project_id: string;
  amount: string;
  currency: string;
  price: string | null;
  profit_target_percent: string | null;
  margin_target_amount: string | null;
};

export type RateScope = 'member' | 'project' | 'project_member';

export type Rate = {
  id: string;
  scope: RateScope;
  member_id: string | null;
  project_id: string | null;
  from_date: string;
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
  /** The workspace filter chosen on Projects ('' or absent = all workspaces). */
  workspaceFilter?: string | null;
};
