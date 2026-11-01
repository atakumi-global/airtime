import {
  ADMIN,
  FX,
  ORGANISATION,
  PROJECTS,
  WORK_ITEMS,
  timeEntry,
} from './fixtures';
import type { FetchBridge } from './setup';

export type Call = {
  url: string;
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
};

/** A handler returns a JSON body (200), a ready Response, or throws `unreachable()`. */
export type Handler = (call: Call) => unknown | Promise<unknown>;

export function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** An HTTP error the way the Airtime server answers: `{ error: message }`. */
export function reject(status: number, message: string): Response {
  return reply({ error: message }, status);
}

/** What a fetch to an unreachable host does: it rejects with a TypeError. */
export function unreachable(): never {
  throw new TypeError('fetch failed');
}

function bridge(): FetchBridge {
  return (globalThis as unknown as { __airtimeFetchBridge: FetchBridge })
    .__airtimeFetchBridge;
}

/**
 * An in-memory stand-in for the Airtime API. Every request is recorded, and a
 * route is replaced per test with `on('POST /api/timer/start', handler)`.
 * Unrouted requests answer 404 so a missing route fails loudly.
 */
export class FakeServer {
  readonly calls: Call[] = [];
  private readonly routes = new Map<string, Handler>();

  constructor() {
    this.on('GET /api/me', () => ({ member: ADMIN }));
    this.on('GET /api/organisation', () => ({ organisation: ORGANISATION }));
    this.on('GET /api/projects', () => ({ projects: PROJECTS }));
    this.on('GET /api/plane/work-items', () => ({ workItems: WORK_ITEMS }));
    this.on('GET /api/timer', () => ({ timer: null }));
    this.on('GET /api/time-entries', () => ({ entries: [] }));
    this.on('GET /api/plane/connection', () => ({ connection: null }));
    this.on('GET /api/fx/rates', () => FX);
    this.on('GET /api/projects/project-1/expenses', () => ({ expenses: [] }));
    this.on('GET /api/projects/project-2/expenses', () => ({ expenses: [] }));
    this.on('POST /api/time-entries', () => ({ entry: timeEntry() }));
    bridge().handler = (input, init) => this.handle(input, init);
  }

  on(route: string, handler: Handler): this {
    this.routes.set(route, handler);
    return this;
  }

  /** Make every request fail the way an unreachable server does. */
  goOffline(): this {
    for (const route of [...this.routes.keys()]) {
      this.routes.set(route, unreachable);
    }
    this.fallbackOffline = true;
    return this;
  }

  private fallbackOffline = false;

  callsTo(route: string): Call[] {
    const [method, path] = route.split(' ') as [string, string];
    return this.calls.filter((call) => call.method === method && call.path === path);
  }

  private async handle(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    let body: unknown = undefined;
    if (typeof init?.body === 'string') {
      body = JSON.parse(init.body);
    }
    const call: Call = { url: url.toString(), method, path: url.pathname, query: url.searchParams, body };
    this.calls.push(call);
    const handler = this.routes.get(`${method} ${url.pathname}`);
    if (!handler) {
      if (this.fallbackOffline) {
        unreachable();
      }
      return reject(404, `no fake route for ${method} ${url.pathname}`);
    }
    const result = await handler(call);
    if (result instanceof Response) {
      return result;
    }
    if (result === undefined) {
      return new Response(null, { status: 204 });
    }
    return reply(result);
  }
}
