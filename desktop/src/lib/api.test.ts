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
});
