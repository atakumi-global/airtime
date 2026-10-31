import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError, NetworkError } from './api';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('ApiClient', () => {
  it('sends the bearer token and parses the body', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ member: { id: 'm1', displayName: 'Ada' } }),
    );
    const client = new ApiClient({
      baseUrl: 'http://localhost:3000/',
      token: 'token-1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const member = await client.me();
    expect(member.id).toBe('m1');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://localhost:3000/api/me');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer token-1',
    );
  });

  it('throws ApiError with the server message', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: 'invalid_credentials' }, 401),
    );
    const client = new ApiClient({
      baseUrl: 'http://localhost:3000',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(client.me()).rejects.toBeInstanceOf(ApiError);
    await expect(client.me()).rejects.toMatchObject({
      status: 401,
      message: 'invalid_credentials',
    });
  });

  it('throws NetworkError when the server cannot be reached', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const client = new ApiClient({
      baseUrl: 'http://localhost:3000',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(client.timer()).rejects.toBeInstanceOf(NetworkError);
  });

  it('pauses and resumes the timer through the timer endpoints', async () => {
    const paused = {
      member_id: 'm1',
      project_id: null,
      work_item_id: null,
      description: null,
      started_at: '2026-09-27T10:00:00.000Z',
      state: 'paused',
      paused_at: '2026-09-27T11:00:00.000Z',
      paused_seconds: 0,
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ timer: paused }))
      .mockResolvedValueOnce(
        jsonResponse({ timer: { ...paused, state: 'running', paused_at: null, paused_seconds: 600 } }),
      );
    const client = new ApiClient({
      baseUrl: 'http://localhost:3000',
      token: 'token-1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect((await client.pauseTimer()).state).toBe('paused');
    const resumed = await client.resumeTimer();
    expect(resumed.state).toBe('running');
    expect(resumed.paused_seconds).toBe(600);

    const calls = fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls[0]![0]).toBe('http://localhost:3000/api/timer/pause');
    expect(calls[0]![1].method).toBe('POST');
    expect(calls[1]![0]).toBe('http://localhost:3000/api/timer/resume');
    expect(calls[1]![1].method).toBe('POST');
  });

  it('surfaces a pause conflict as an ApiError', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'already_paused' }, 409));
    const client = new ApiClient({
      baseUrl: 'http://localhost:3000',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(client.pauseTimer()).rejects.toMatchObject({
      status: 409,
      message: 'already_paused',
    });
  });

  it('patches an entry with the expected payload', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ entry: { id: 'e1' } }));
    const client = new ApiClient({
      baseUrl: 'http://localhost:3000',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await client.updateTimeEntry('e1', {
      startedAt: '2026-09-22T09:00:00.000Z',
      endedAt: '2026-09-22T10:00:00.000Z',
      description: 'Retry logic',
    });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://localhost:3000/api/time-entries/e1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({
      startedAt: '2026-09-22T09:00:00.000Z',
      endedAt: '2026-09-22T10:00:00.000Z',
      description: 'Retry logic',
    });
  });

  it('deletes an entry', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }));
    const client = new ApiClient({
      baseUrl: 'http://localhost:3000',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await client.deleteTimeEntry('e1');

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://localhost:3000/api/time-entries/e1');
    expect(init.method).toBe('DELETE');
  });

  it('reads the entry history', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ history: [{ id: 'h1', action: 'updated' }] }),
    );
    const client = new ApiClient({
      baseUrl: 'http://localhost:3000',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const history = await client.timeEntryHistory('e1');
    expect(history).toHaveLength(1);
    expect(history[0]?.action).toBe('updated');
  });

  it('posts a manual entry with the expected payload', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ entry: { id: 'e1' } }));
    const client = new ApiClient({
      baseUrl: 'http://localhost:3000',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await client.createManualEntry({
      workItemId: 'wi-1',
      date: '2026-09-20',
      durationMinutes: 30,
    });

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      workItemId: 'wi-1',
      date: '2026-09-20',
      durationMinutes: 30,
    });
  });

  it('loads a project summary and its entries', async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) =>
      String(url).includes('/summary')
        ? jsonResponse({ project: { id: 'p1' }, summary: { spent: 10 } })
        : jsonResponse({ entries: [{ id: 'e1' }] }),
    );
    const client = new ApiClient({
      baseUrl: 'http://localhost:3000',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const detail = await client.projectSummary('p1');
    expect(detail.summary.spent).toBe(10);
    expect(fetchImpl.mock.calls[0]![0]).toBe(
      'http://localhost:3000/api/projects/p1/summary',
    );

    const entries = await client.projectEntries('p1');
    expect(entries).toHaveLength(1);
    expect(fetchImpl.mock.calls[1]![0]).toBe(
      'http://localhost:3000/api/time-entries?projectId=p1',
    );
  });

  it('sends the budget with a price and both targets', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ budget: { id: 'b1' } }));
    const client = new ApiClient({
      baseUrl: 'http://localhost:3000',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await client.setBudget('p1', {
      amount: 32000,
      currency: 'EUR',
      price: 48000,
      profitTargetPercent: 35,
      marginTargetAmount: 4000,
    });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://localhost:3000/api/projects/p1/budget');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toEqual({
      amount: 32000,
      currency: 'EUR',
      price: 48000,
      profitTargetPercent: 35,
      marginTargetAmount: 4000,
    });
  });

  it('returns the stored FX snapshot after a refresh', async () => {
    const snapshot = {
      base: 'EUR',
      date: '2026-10-30',
      stale: false,
      fetchedAt: '2026-10-30T08:00:00.000Z',
      rates: { USD: 1.08, GBP: 0.85 },
    };
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith('/api/fx/refresh')
        ? jsonResponse({ refreshed: true, stored: 2, date: '2026-10-30' })
        : jsonResponse(snapshot),
    );
    const client = new ApiClient({
      baseUrl: 'http://localhost:3000',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const fx = await client.refreshFx();

    expect(fx.date).toBe('2026-10-30');
    expect(fx.stale).toBe(false);
    expect(fx.rates).toEqual({ USD: 1.08, GBP: 0.85 });
    const calls = fetchImpl.mock.calls as unknown as [string, RequestInit][];
    expect(calls).toHaveLength(2);
    expect(calls[0]![0]).toBe('http://localhost:3000/api/fx/refresh');
    expect(calls[0]![1].method).toBe('POST');
    expect(calls[1]![0]).toBe('http://localhost:3000/api/fx/rates');
  });

  it('keeps the stale marker when the stored snapshot is stale', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith('/api/fx/refresh')
        ? jsonResponse({ refreshed: true, stored: 0, date: '2026-10-01' })
        : jsonResponse({
            base: 'EUR',
            date: '2026-10-01',
            stale: true,
            fetchedAt: null,
            rates: { USD: 1.07 },
          }),
    );
    const client = new ApiClient({
      baseUrl: 'http://localhost:3000',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const fx = await client.refreshFx();

    expect(fx.stale).toBe(true);
    expect(fx.date).toBe('2026-10-01');
  });

  it('does not read the snapshot when the refresh fails', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: 'fx_refresh_failed', message: 'provider down' }, 502),
    );
    const client = new ApiClient({
      baseUrl: 'http://localhost:3000',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(client.refreshFx()).rejects.toMatchObject({ status: 502 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
