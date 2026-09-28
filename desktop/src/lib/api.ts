import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauri } from './native';
import type {
  AuditEntry,
  Budget,
  EntryHistoryEvent,
  FeedbackEvent,
  FxRates,
  Member,
  Organisation,
  PlaneConnection,
  Project,
  Rate,
  RateScope,
  RunningTimer,
  TimeEntry,
  Timesheet,
  WorkItem,
} from './types';

// In the Tauri app use the HTTP plugin: it avoids the WebView2 loopback
// restriction and CORS. In a plain browser (dev preview) use the web fetch.
// Tests inject their own fetch.
const defaultFetch = isTauri
  ? (tauriFetch as unknown as typeof fetch)
  : globalThis.fetch.bind(globalThis);

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export class NetworkError extends Error {
  constructor(message = 'network unreachable') {
    super(message);
    this.name = 'NetworkError';
  }
}

export type ApiClientOptions = {
  baseUrl: string;
  token?: string | null;
  fetchImpl?: typeof fetch;
};

export class ApiClient {
  private baseUrl: string;
  private token: string | null;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.token = options.token ?? null;
    this.fetchImpl = options.fetchImpl ?? defaultFetch;
  }

  setToken(token: string | null): void {
    this.token = token;
  }

  setBaseUrl(baseUrl: string): void {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Accept: 'application/json',
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
          ...(init.headers ?? {}),
        },
      });
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      throw new NetworkError(`cannot reach ${this.baseUrl}${path} (${reason})`);
    }

    if (!response.ok) {
      let message = `request failed with ${response.status}`;
      try {
        const body = (await response.json()) as { error?: string };
        if (body.error) {
          message = body.error;
        }
      } catch {
        // keep the status message
      }
      throw new ApiError(response.status, message);
    }

    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  async login(
    email: string,
    password: string,
  ): Promise<{ token: string; member: Member }> {
    return this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  async me(): Promise<Member> {
    const body = await this.request<{ member: Member }>('/api/me');
    return body.member;
  }

  async setFeedbackOptIn(optIn: boolean): Promise<Member> {
    const body = await this.request<{ member: Member }>('/api/me/feedback', {
      method: 'PATCH',
      body: JSON.stringify({ optIn }),
    });
    return body.member;
  }

  async organisation(): Promise<Organisation> {
    const body = await this.request<{ organisation: Organisation }>(
      '/api/organisation',
    );
    return body.organisation;
  }

  async projects(withBudget = true): Promise<Project[]> {
    const body = await this.request<{ projects: Project[] }>(
      `/api/projects?withBudget=${withBudget ? 'true' : 'false'}`,
    );
    return body.projects;
  }

  async workItems(): Promise<WorkItem[]> {
    const body = await this.request<{ workItems: WorkItem[] }>(
      '/api/plane/work-items',
    );
    return body.workItems;
  }

  async timeEntries(from: string, to: string): Promise<TimeEntry[]> {
    const body = await this.request<{ entries: TimeEntry[] }>(
      `/api/time-entries?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    );
    return body.entries;
  }

  async timesheet(from: string, to: string): Promise<Timesheet> {
    const query = new URLSearchParams({ from, to });
    return this.request(`/api/time-entries/summary?${query.toString()}`);
  }

  async timer(): Promise<RunningTimer | null> {
    const body = await this.request<{ timer: RunningTimer | null }>('/api/timer');
    return body.timer;
  }

  async startTimer(workItemId?: string | null, description?: string | null) {
    return this.request<{ timer: RunningTimer }>('/api/timer/start', {
      method: 'POST',
      body: JSON.stringify({
        workItemId: workItemId ?? null,
        description: description ?? null,
      }),
    });
  }

  async stopTimer(): Promise<TimeEntry | null> {
    const body = await this.request<{ entry: TimeEntry }>('/api/timer/stop', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    return body.entry;
  }

  async createManualEntry(payload: {
    workItemId?: string | null;
    date: string;
    durationMinutes: number;
    description?: string | null;
  }): Promise<TimeEntry> {
    const body = await this.request<{ entry: TimeEntry }>('/api/time-entries', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return body.entry;
  }

  async updateTimeEntry(
    id: string,
    payload: {
      startedAt?: string;
      endedAt?: string;
      durationMinutes?: number;
      workItemId?: string | null;
      description?: string | null;
    },
  ): Promise<TimeEntry> {
    const body = await this.request<{ entry: TimeEntry }>(
      `/api/time-entries/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: JSON.stringify(payload) },
    );
    return body.entry;
  }

  async deleteTimeEntry(id: string): Promise<void> {
    await this.request(`/api/time-entries/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  async timeEntryHistory(id: string): Promise<EntryHistoryEvent[]> {
    const body = await this.request<{ history: EntryHistoryEvent[] }>(
      `/api/time-entries/${encodeURIComponent(id)}/history`,
    );
    return body.history;
  }

  async planeConnection(): Promise<PlaneConnection | null> {
    const body = await this.request<{ connection: PlaneConnection | null }>(
      '/api/plane/connection',
    );
    return body.connection;
  }

  async savePlaneConnection(payload: {
    baseUrl: string;
    workspaceSlug: string;
    token: string;
  }): Promise<{ workspace: { slug: string; projectCount: number } }> {
    return this.request('/api/plane/connection', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  async syncPlane(): Promise<{ projects: number; workItems: number }> {
    const body = await this.request<{ sync: { projects: number; workItems: number } }>(
      '/api/plane/sync',
      { method: 'POST', body: JSON.stringify({}) },
    );
    return body.sync;
  }

  async fxRates(): Promise<FxRates> {
    return this.request('/api/fx/rates');
  }

  async refreshFx(): Promise<FxRates> {
    const body = await this.request<{ rates: FxRates }>('/api/fx/refresh', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    return body.rates;
  }

  async updateReportingCurrency(currency: string): Promise<Organisation> {
    const body = await this.request<{ organisation: Organisation }>(
      '/api/organisation',
      { method: 'PATCH', body: JSON.stringify({ reportingCurrency: currency }) },
    );
    return body.organisation;
  }

  async budget(projectId: string): Promise<Budget | null> {
    const body = await this.request<{ budget: Budget | null }>(
      `/api/projects/${encodeURIComponent(projectId)}/budget`,
    );
    return body.budget;
  }

  async setBudget(
    projectId: string,
    payload: { amount: number; currency: string },
  ): Promise<Budget> {
    const body = await this.request<{ budget: Budget }>(
      `/api/projects/${encodeURIComponent(projectId)}/budget`,
      { method: 'PUT', body: JSON.stringify(payload) },
    );
    return body.budget;
  }

  async deleteBudget(projectId: string): Promise<void> {
    await this.request(
      `/api/projects/${encodeURIComponent(projectId)}/budget`,
      { method: 'DELETE' },
    );
  }

  async rates(): Promise<Rate[]> {
    const body = await this.request<{ rates: Rate[] }>('/api/rates');
    return body.rates;
  }

  async setRate(payload: {
    scope: RateScope;
    memberId?: string | null;
    projectId?: string | null;
    clientId?: string | null;
    currency: string;
    hourlyAmount: number;
  }): Promise<Rate> {
    const body = await this.request<{ rate: Rate }>('/api/rates', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    return body.rate;
  }

  async deleteRate(id: string): Promise<void> {
    await this.request(`/api/rates/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  async members(): Promise<Member[]> {
    const body = await this.request<{ members: Member[] }>('/api/members');
    return body.members;
  }

  async createMember(payload: {
    email: string;
    displayName: string;
    role: Member['role'];
    password?: string;
  }): Promise<Member> {
    const body = await this.request<{ member: Member }>('/api/members', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return body.member;
  }

  async updateMemberRole(id: string, role: Member['role']): Promise<Member> {
    const body = await this.request<{ member: Member }>(
      `/api/members/${encodeURIComponent(id)}/role`,
      { method: 'PATCH', body: JSON.stringify({ role }) },
    );
    return body.member;
  }

  async removeMember(id: string): Promise<void> {
    await this.request(`/api/members/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  async audit(limit = 100): Promise<AuditEntry[]> {
    const body = await this.request<{ entries: AuditEntry[] }>(
      `/api/audit?limit=${limit}`,
    );
    return body.entries;
  }

  async feedbackEvents(limit = 200): Promise<FeedbackEvent[]> {
    const body = await this.request<{ events: FeedbackEvent[] }>(
      `/api/feedback?limit=${limit}`,
    );
    return body.events;
  }

  async feedbackExport(): Promise<Record<string, unknown>[]> {
    const body = await this.request<{ dataset: Record<string, unknown>[] }>(
      '/api/feedback/export',
    );
    return body.dataset;
  }

  async exportTimeEntriesCsv(params: {
    from?: string;
    to?: string;
    projectId?: string;
    memberId?: string;
  }): Promise<string> {
    const query = new URLSearchParams();
    if (params.from) query.set('from', params.from);
    if (params.to) query.set('to', params.to);
    if (params.projectId) query.set('projectId', params.projectId);
    if (params.memberId) query.set('memberId', params.memberId);
    const path = `/api/exports/time-entries.csv?${query.toString()}`;
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        headers: {
          Accept: 'text/csv',
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
      });
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      throw new NetworkError(`cannot reach ${this.baseUrl}${path} (${reason})`);
    }
    if (!response.ok) {
      throw new ApiError(response.status, 'export failed');
    }
    return response.text();
  }
}
