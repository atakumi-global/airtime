import type {
  FxRates,
  Member,
  Organisation,
  PlaneConnection,
  Project,
  RunningTimer,
  TimeEntry,
  WorkItem,
} from './types';

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
    this.fetchImpl = options.fetchImpl ?? fetch;
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
    } catch {
      throw new NetworkError();
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
}
