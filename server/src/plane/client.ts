export type PlaneProject = {
  id: string;
  identifier?: string;
  name: string;
  archived_at?: string | null;
  start_date?: string | null;
  target_date?: string | null;
};

export type PlaneIssue = {
  id: string;
  sequence_id?: number;
  name: string;
  state?: string;
  state_group?: string;
  state_detail?: { group?: string };
  project?: string;
  updated_at?: string;
  completed_at?: string | null;
  archived_at?: string | null;
};

export class PlaneError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'PlaneError';
  }
}

export type PlaneClientOptions = {
  baseUrl: string;
  workspaceSlug: string;
  token: string;
  fetchImpl?: typeof fetch;
};

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

const CLOSED_GROUPS = new Set(['completed', 'cancelled']);

export function isIssueOpen(issue: PlaneIssue): boolean {
  if (issue.completed_at || issue.archived_at) {
    return false;
  }
  const group = issue.state_detail?.group ?? issue.state_group;
  if (group && CLOSED_GROUPS.has(group)) {
    return false;
  }
  return true;
}

export class PlaneClient {
  private readonly apiBase: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: PlaneClientOptions) {
    this.apiBase = `${normalizeBaseUrl(options.baseUrl)}/api/v1`;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async getJson(path: string): Promise<unknown> {
    const response = await this.fetchImpl(`${this.apiBase}${path}`, {
      method: 'GET',
      headers: {
        'X-API-Key': this.options.token,
        Accept: 'application/json',
      },
    });
    if (!response.ok) {
      throw new PlaneError(
        response.status,
        `Plane request to ${path} failed with status ${response.status}`,
      );
    }
    return response.json();
  }

  private async paginate<T>(path: string): Promise<T[]> {
    const results: T[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 100; page += 1) {
      const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
      const body = await this.getJson(`${path}${query}`);
      if (Array.isArray(body)) {
        results.push(...(body as T[]));
        break;
      }
      const pageBody = body as {
        results?: T[];
        next_cursor?: string | null;
        next_page_results?: boolean;
      };
      if (Array.isArray(pageBody.results)) {
        results.push(...pageBody.results);
      }
      if (!pageBody.next_page_results || !pageBody.next_cursor) {
        break;
      }
      cursor = pageBody.next_cursor;
    }
    return results;
  }

  async verify(): Promise<{ projectCount: number }> {
    const projects = await this.paginate<PlaneProject>(
      `/workspaces/${encodeURIComponent(this.options.workspaceSlug)}/projects/`,
    );
    return { projectCount: projects.length };
  }

  async listProjects(): Promise<PlaneProject[]> {
    return this.paginate<PlaneProject>(
      `/workspaces/${encodeURIComponent(this.options.workspaceSlug)}/projects/`,
    );
  }

  async listIssues(projectId: string): Promise<PlaneIssue[]> {
    return this.paginate<PlaneIssue>(
      `/workspaces/${encodeURIComponent(this.options.workspaceSlug)}/projects/${encodeURIComponent(projectId)}/issues/`,
    );
  }
}
