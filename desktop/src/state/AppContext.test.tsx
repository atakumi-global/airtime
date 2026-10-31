import { act, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SESSION_KEY } from '../lib/native';
import {
  ADMIN,
  ORGANISATION,
  PROJECTS,
  WORK_ITEMS,
  queuedEntry,
  runningTimer,
  timeEntry,
} from '../test/fixtures';
import { mountApp, readCache, seedSession, snapshot } from '../test/harness';
import {
  FakeServer,
  reject,
  reply,
  unreachable,
  type Call,
} from '../test/server';

/** Wait until the boot refresh has finished talking to the server. */
async function bootSettled(app: () => { status: string; refreshing: boolean }) {
  await waitFor(() => {
    expect(app().status).not.toBe('loading');
    expect(app().refreshing).toBe(false);
  });
}

describe('AppProvider boot (cache first)', () => {
  it('shows the sign-in screen state when there is no session token', async () => {
    new FakeServer();
    const { app } = mountApp();
    await waitFor(() => expect(app().status).toBe('login'));
    expect(app().member).toBeNull();
  });

  it('renders the cached snapshot before the server has answered', async () => {
    const server = new FakeServer();
    let release: (value: unknown) => void = () => undefined;
    server.on(
      'GET /api/me',
      () => new Promise((resolve) => (release = resolve)),
    );
    seedSession({
      cache: {
        timer: runningTimer(),
        queue: [queuedEntry('q1')],
      },
    });

    const { app } = mountApp();

    await waitFor(() => expect(app().status).toBe('ready'));
    // The server has not answered /api/me yet, but cached data is on screen.
    expect(server.callsTo('GET /api/me')).toHaveLength(1);
    expect(app().member?.displayName).toBe(ADMIN.displayName);
    expect(app().projects).toHaveLength(PROJECTS.length);
    expect(app().workItems).toHaveLength(WORK_ITEMS.length);
    expect(app().entries).toHaveLength(1);
    expect(app().timer?.work_item_id).toBe('plane-wi-1');
    expect(app().timerState).toBe('running');
    expect(app().queue.map((item) => item.id)).toEqual(['q1']);
    expect(app().refreshing).toBe(true);

    await act(async () => {
      release({ member: ADMIN });
    });
  });

  it('keeps the cached data and reports offline when the server is unreachable', async () => {
    const server = new FakeServer().goOffline();
    seedSession({ cache: { queue: [queuedEntry('q1')] } });

    const { app } = mountApp();

    await waitFor(() => expect(app().online).toBe(false));
    await bootSettled(app);
    expect(app().status).toBe('ready');
    expect(app().notice).toBe('Offline. Showing locally cached data.');
    expect(app().member?.id).toBe(ADMIN.id);
    expect(app().projects).toHaveLength(PROJECTS.length);
    expect(app().entries).toHaveLength(1);
    expect(app().queue).toHaveLength(1);
    expect(server.callsTo('GET /api/me').length).toBeGreaterThan(0);
  });

  it('replaces the cache with fresh server data once the refresh succeeds', async () => {
    const server = new FakeServer();
    const fresh = timeEntry({ id: 'entry-fresh', description: 'From the server' });
    server.on('GET /api/time-entries', () => ({ entries: [fresh] }));
    seedSession({ cache: { entries: [timeEntry()] } });

    const { app } = mountApp();

    await waitFor(() => expect(app().entries[0]?.id).toBe('entry-fresh'));
    await bootSettled(app);
    expect(app().online).toBe(true);
    expect(app().organisation?.name).toBe(ORGANISATION.name);
    expect(app().fx?.base).toBe('EUR');
    await waitFor(() => expect(readCache()?.entries[0]?.id).toBe('entry-fresh'));
  });

  it('uses the saved server URL for requests', async () => {
    const server = new FakeServer();
    seedSession({ serverUrl: 'https://airtime.example.test/', cache: {} });

    const { app } = mountApp();

    await waitFor(() => expect(server.calls.length).toBeGreaterThan(0));
    await bootSettled(app);
    expect(server.calls[0]?.url).toBe('https://airtime.example.test/api/me');
    expect(app().baseUrl).toBe('https://airtime.example.test/');
  });

  it('ignores a corrupt cache and still signs in from the token', async () => {
    new FakeServer();
    seedSession({ cache: '{not json' });

    const { app } = mountApp();

    await waitFor(() => expect(app().status).toBe('ready'));
    await waitFor(() => expect(app().member?.id).toBe(ADMIN.id));
    await bootSettled(app);
    expect(app().error).toBeNull();
  });

  it('returns to sign-in and drops the token when the server answers 401', async () => {
    const server = new FakeServer();
    server.on('GET /api/me', () => reject(401, 'unauthorized'));
    seedSession({ cache: {} });

    const { app } = mountApp();

    await waitFor(() => expect(app().status).toBe('login'));
    expect(window.localStorage.getItem(SESSION_KEY)).toBeNull();
    expect(app().member).toBeNull();
  });

  it('surfaces a server error from the refresh instead of going offline', async () => {
    const server = new FakeServer();
    server.on('GET /api/organisation', () => reject(500, 'database down'));
    seedSession({ cache: {} });

    const { app } = mountApp();

    await waitFor(() => expect(app().error).toBe('database down'));
    expect(app().online).toBe(true);
    expect(app().status).toBe('ready');
  });
});

describe('AppProvider sign-in and sign-out', () => {
  it('signs in, stores the session and loads the data', async () => {
    const server = new FakeServer();
    server.on('POST /auth/login', () => ({ token: 'new-token', member: ADMIN }));
    const { app } = mountApp();
    await waitFor(() => expect(app().status).toBe('login'));

    await act(async () => {
      await app().login('https://airtime.example.test', 'ada@example.test', 'pw');
    });

    expect(app().status).toBe('ready');
    expect(app().member?.id).toBe(ADMIN.id);
    expect(app().projects).toHaveLength(PROJECTS.length);
    expect(window.localStorage.getItem(SESSION_KEY)).toBe('new-token');
    const login = server.callsTo('POST /auth/login')[0] as Call;
    expect(login.body).toEqual({ email: 'ada@example.test', password: 'pw' });
  });

  it('rejects a failed sign-in and stays on the login screen', async () => {
    const server = new FakeServer();
    server.on('POST /auth/login', () => reject(401, 'invalid_credentials'));
    const { app } = mountApp();
    await waitFor(() => expect(app().status).toBe('login'));

    let failure: unknown;
    await act(async () => {
      await app()
        .login('http://localhost:3000', 'ada@example.test', 'wrong')
        .catch((caught: unknown) => {
          failure = caught;
        });
    });

    expect((failure as Error).message).toBe('invalid_credentials');
    expect(app().status).toBe('login');
    expect(window.localStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it('clears the session and the cached lists on sign-out', async () => {
    new FakeServer();
    seedSession({ cache: { queue: [queuedEntry('q1')] } });
    const { app } = mountApp();
    await waitFor(() => expect(app().projects.length).toBeGreaterThan(0));
    await bootSettled(app);

    await act(async () => {
      await app().logout();
    });

    expect(app().status).toBe('login');
    expect(app().member).toBeNull();
    expect(app().projects).toEqual([]);
    expect(app().queue).toEqual([]);
    expect(window.localStorage.getItem(SESSION_KEY)).toBeNull();
  });
});

describe('AppProvider timer', () => {
  async function readyApp(
    server: FakeServer,
    cache: { timer?: ReturnType<typeof runningTimer> } = {},
  ) {
    // The server agrees with the cached timer, as it would after a normal session.
    server.on('GET /api/timer', () => ({ timer: cache.timer ?? null }));
    seedSession({ cache });
    const mounted = mountApp();
    await waitFor(() => expect(app(mounted).member).not.toBeNull());
    await bootSettled(mounted.app);
    expect(server.callsTo('GET /api/me').length).toBeGreaterThan(0);
    return mounted;
  }
  const app = (mounted: ReturnType<typeof mountApp>) => mounted.app();

  it('starts the timer optimistically and keeps the server timer', async () => {
    const server = new FakeServer();
    const serverTimer = runningTimer({ started_at: '2026-09-02T09:00:00.000Z' });
    server.on('POST /api/timer/start', () => ({ timer: serverTimer }));
    const mounted = await readyApp(server);

    await act(async () => {
      await mounted.app().startTimer('plane-wi-1');
    });

    expect(mounted.app().timer?.started_at).toBe('2026-09-02T09:00:00.000Z');
    expect(mounted.app().timerState).toBe('running');
    expect(mounted.app().timerPending).toBe(false);
    expect(server.callsTo('POST /api/timer/start')[0]?.body).toEqual({
      workItemId: 'plane-wi-1',
      description: null,
    });
  });

  it('shows the timer immediately, before the server answers', async () => {
    const server = new FakeServer();
    let release: (value: unknown) => void = () => undefined;
    server.on(
      'POST /api/timer/start',
      () => new Promise((resolve) => (release = resolve)),
    );
    const mounted = await readyApp(server);

    let pending: Promise<void> = Promise.resolve();
    await act(async () => {
      pending = mounted.app().startTimer('plane-wi-2');
    });

    expect(mounted.app().timerPending).toBe(true);
    expect(mounted.app().timer?.work_item_id).toBe('plane-wi-2');
    expect(mounted.app().timer?.description).toBe('WEB-2 Fix the footer');

    await act(async () => {
      release({ timer: runningTimer({ work_item_id: 'plane-wi-2' }) });
      await pending;
    });
    expect(mounted.app().timerPending).toBe(false);
  });

  it('runs the timer locally when the server is unreachable, then queues the entry on stop', async () => {
    const server = new FakeServer();
    const mounted = await readyApp(server);
    server.on('POST /api/timer/start', unreachable);
    server.on('POST /api/timer/stop', unreachable);
    server.on('GET /api/me', unreachable);

    await act(async () => {
      await mounted.app().startTimer('plane-wi-1');
    });
    expect(mounted.app().timer).not.toBeNull();
    expect(mounted.app().online).toBe(false);
    expect(mounted.app().notice).toContain('Timer is local');

    await act(async () => {
      await mounted.app().stopTimer();
    });

    // A local timer never calls the server's stop route.
    expect(server.callsTo('POST /api/timer/stop')).toHaveLength(0);
    expect(mounted.app().timer).toBeNull();
    expect(mounted.app().queue).toHaveLength(1);
    const queued = mounted.app().queue[0]!;
    expect(queued.payload.workItemId).toBe('plane-wi-1');
    expect(new Date(queued.payload.endedAt as string).getTime()).toBeGreaterThanOrEqual(
      new Date(queued.payload.startedAt as string).getTime(),
    );
    expect(mounted.app().notice).toBe(
      'Offline. Entry queued and will sync when the server is reachable.',
    );
    await waitFor(() => expect(readCache()?.queue).toHaveLength(1));
  });

  it('drops the optimistic timer and shows the error when the server rejects the start', async () => {
    const server = new FakeServer();
    server.on('POST /api/timer/start', () => reject(409, 'timer already running'));
    const mounted = await readyApp(server);

    await act(async () => {
      await mounted.app().startTimer('plane-wi-1');
    });

    expect(mounted.app().timer).toBeNull();
    expect(mounted.app().error).toBe('timer already running');
    expect(mounted.app().online).toBe(true);
  });

  it('signs out when the session has expired during a start', async () => {
    const server = new FakeServer();
    server.on('POST /api/timer/start', () => reject(401, 'unauthorized'));
    const mounted = await readyApp(server);

    await act(async () => {
      await mounted.app().startTimer('plane-wi-1');
    });

    expect(mounted.app().status).toBe('login');
    expect(mounted.app().timer).toBeNull();
  });

  it('stops a server timer through the API and refreshes', async () => {
    const server = new FakeServer();
    const mounted = await readyApp(server, { timer: runningTimer() });
    server.on('POST /api/timer/stop', () => {
      // The server no longer has a timer once it has been stopped.
      server.on('GET /api/timer', () => ({ timer: null }));
      return { entry: timeEntry() };
    });
    const meCalls = server.callsTo('GET /api/me').length;

    await act(async () => {
      await mounted.app().stopTimer();
    });

    expect(server.callsTo('POST /api/timer/stop')).toHaveLength(1);
    expect(mounted.app().timer).toBeNull();
    expect(mounted.app().queue).toHaveLength(0);
    expect(server.callsTo('GET /api/me').length).toBeGreaterThan(meCalls);
  });

  it('queues the entry when the server drops away during stop', async () => {
    const server = new FakeServer();
    server.on('POST /api/timer/stop', unreachable);
    const mounted = await readyApp(server, {
      timer: runningTimer({
        started_at: new Date(Date.now() - 600_000).toISOString(),
      }),
    });

    await act(async () => {
      await mounted.app().stopTimer();
    });

    expect(mounted.app().timer).toBeNull();
    expect(mounted.app().online).toBe(false);
    expect(mounted.app().queue).toHaveLength(1);
    const payload = mounted.app().queue[0]!.payload;
    const seconds =
      (new Date(payload.endedAt as string).getTime() -
        new Date(payload.startedAt as string).getTime()) /
      1000;
    expect(seconds).toBeGreaterThanOrEqual(599);
    expect(seconds).toBeLessThan(700);
  });

  it('surfaces a server error from stop without queueing', async () => {
    const server = new FakeServer();
    server.on('POST /api/timer/stop', () => reject(500, 'could not stop'));
    const mounted = await readyApp(server, { timer: runningTimer() });

    await act(async () => {
      await mounted.app().stopTimer();
    });

    expect(mounted.app().error).toBe('could not stop');
    expect(mounted.app().queue).toHaveLength(0);
  });

  it('queues a paused timer up to the pause, without the paused time', async () => {
    const server = new FakeServer();
    server.on('POST /api/timer/stop', unreachable);
    const startedAt = new Date(Date.now() - 3_600_000).toISOString();
    const pausedAt = new Date(Date.now() - 1_800_000).toISOString();
    const mounted = await readyApp(server, {
      timer: runningTimer({
        started_at: startedAt,
        state: 'paused',
        paused_at: pausedAt,
        paused_seconds: 0,
      }),
    });
    expect(mounted.app().timerState).toBe('paused');

    await act(async () => {
      await mounted.app().stopTimer();
    });

    const payload = mounted.app().queue[0]!.payload;
    expect(payload.endedAt).toBe(pausedAt);
    expect(payload.startedAt).toBe(startedAt);
  });

  it('pauses and resumes through the API', async () => {
    const server = new FakeServer();
    const pausedAt = new Date().toISOString();
    server.on('POST /api/timer/pause', () => ({
      timer: runningTimer({ state: 'paused', paused_at: pausedAt }),
    }));
    server.on('POST /api/timer/resume', () => ({
      timer: runningTimer({ state: 'running', paused_seconds: 5 }),
    }));
    const mounted = await readyApp(server, { timer: runningTimer() });

    await act(async () => {
      await mounted.app().pauseTimer();
    });
    expect(mounted.app().timerState).toBe('paused');
    expect(mounted.app().timer?.paused_at).toBe(pausedAt);

    await act(async () => {
      await mounted.app().resumeTimer();
    });
    expect(mounted.app().timerState).toBe('running');
    expect(mounted.app().timer?.paused_seconds).toBe(5);
  });

  it('puts the timer back to running when pause cannot reach the server', async () => {
    const server = new FakeServer();
    server.on('POST /api/timer/pause', unreachable);
    const mounted = await readyApp(server, { timer: runningTimer() });

    await act(async () => {
      await mounted.app().pauseTimer();
    });

    expect(mounted.app().timerState).toBe('running');
    expect(mounted.app().online).toBe(false);
    expect(mounted.app().notice).toContain('could not be paused');
  });

  it('reloads from the server when pause hits a 409 conflict', async () => {
    const server = new FakeServer();
    server.on('POST /api/timer/pause', () => reject(409, 'timer is not running'));
    const mounted = await readyApp(server, { timer: runningTimer() });
    const timerCalls = server.callsTo('GET /api/timer').length;

    await act(async () => {
      await mounted.app().pauseTimer();
    });

    expect(server.callsTo('GET /api/timer').length).toBeGreaterThan(timerCalls);
    expect(mounted.app().error).toBeNull();
  });
});

describe('AppProvider offline queue', () => {
  async function mountWithQueue(
    server: FakeServer,
    queue: ReturnType<typeof queuedEntry>[],
  ) {
    seedSession({ cache: snapshot({ queue }) });
    const mounted = mountApp();
    await waitFor(() => expect(mounted.app().status).toBe('ready'));
    await bootSettled(mounted.app);
    expect(server.callsTo('GET /api/me').length).toBeGreaterThan(0);
    return mounted;
  }

  it('sends every queued entry in order and empties the queue (success)', async () => {
    const server = new FakeServer();
    const sent: string[] = [];
    server.on('POST /api/time-entries', (call) => {
      sent.push((call.body as { description: string }).description);
      return { entry: timeEntry() };
    });

    const mounted = await mountWithQueue(server, [
      queuedEntry('a'),
      queuedEntry('b'),
    ]);

    await waitFor(() => expect(mounted.app().queue).toHaveLength(0));
    expect(sent).toEqual(['queued a', 'queued b']);
    expect(mounted.app().notice).toBe('2 queued entries synced.');
    expect(mounted.app().online).toBe(true);
    await waitFor(() => expect(readCache()?.queue).toEqual([]));
  });

  it('says "entry" for a single synced item', async () => {
    const server = new FakeServer();
    const mounted = await mountWithQueue(server, [queuedEntry('a')]);

    await waitFor(() => expect(mounted.app().queue).toHaveLength(0));
    expect(mounted.app().notice).toBe('1 queued entry synced.');
  });

  it('keeps the whole queue and stays offline when the network is still down', async () => {
    const server = new FakeServer();
    server.on('POST /api/time-entries', unreachable);

    const mounted = await mountWithQueue(server, [
      queuedEntry('a'),
      queuedEntry('b'),
    ]);

    await waitFor(() => expect(mounted.app().online).toBe(false));
    expect(mounted.app().queue.map((item) => item.id)).toEqual(['a', 'b']);
    // Nothing was sent, so the refresh stops before reloading server data.
    expect(server.callsTo('GET /api/organisation')).toHaveLength(0);
    await waitFor(() => expect(readCache()?.queue).toHaveLength(2));
  });

  it('keeps only the unsent entries after a partial success', async () => {
    const server = new FakeServer();
    server.on('POST /api/time-entries', (call) => {
      if ((call.body as { description: string }).description === 'queued b') {
        return unreachable();
      }
      return { entry: timeEntry() };
    });

    const mounted = await mountWithQueue(server, [
      queuedEntry('a'),
      queuedEntry('b'),
      queuedEntry('c'),
    ]);

    await waitFor(() =>
      expect(mounted.app().queue.map((item) => item.id)).toEqual(['b']),
    );
    expect(mounted.app().notice).toBe('2 queued entries synced.');
    await waitFor(() => expect(readCache()?.queue.map((item) => item.id)).toEqual(['b']));
  });

  // AIRTIME-40: flushQueue only keeps NetworkError items, so a server rejection
  // (400) is dropped silently when others sync, and leaves the client pinned
  // offline when nothing syncs. These document the intended behaviour and are
  // marked as known failures until AIRTIME-40 lands; remove `.fails` with the fix.
  it.fails('removes a rejected entry with a visible error and does not pin the client offline (AIRTIME-40)', async () => {
    const server = new FakeServer();
    server.on('POST /api/time-entries', () => reject(400, 'duration must be positive'));

    const mounted = await mountWithQueue(server, [queuedEntry('bad')]);

    await waitFor(() => expect(mounted.app().error).not.toBeNull());
    expect(mounted.app().online).toBe(true);
    expect(mounted.app().queue).toHaveLength(0);
  });

  it.fails('tells the user when a rejected entry is dropped while others sync (AIRTIME-40)', async () => {
    const server = new FakeServer();
    server.on('POST /api/time-entries', (call) =>
      (call.body as { description: string }).description === 'queued bad'
        ? reject(400, 'duration must be positive')
        : { entry: timeEntry() },
    );

    const mounted = await mountWithQueue(server, [
      queuedEntry('bad'),
      queuedEntry('good'),
    ]);

    await waitFor(() => expect(mounted.app().queue).toHaveLength(0));
    expect(mounted.app().error).not.toBeNull();
  });
});

describe('AppProvider manual entries', () => {
  async function readyApp(server: FakeServer) {
    seedSession({ cache: {} });
    const mounted = mountApp();
    await waitFor(() => expect(mounted.app().member).not.toBeNull());
    await bootSettled(mounted.app);
    expect(server.callsTo('GET /api/me').length).toBeGreaterThan(0);
    return mounted;
  }

  const input = (description: string) => ({
    workItemId: 'plane-wi-1',
    date: '2026-09-02',
    durationMinutes: 30,
    description,
  });

  it('saves a manual entry and refreshes', async () => {
    const server = new FakeServer();
    const mounted = await readyApp(server);
    const meCalls = server.callsTo('GET /api/me').length;

    await act(async () => {
      await mounted.app().addManualEntry(input('one'));
    });

    expect(server.callsTo('POST /api/time-entries')[0]?.body).toEqual(input('one'));
    expect(mounted.app().queue).toHaveLength(0);
    expect(server.callsTo('GET /api/me').length).toBeGreaterThan(meCalls);
  });

  it('queues a manual entry when the server is unreachable', async () => {
    const server = new FakeServer();
    const mounted = await readyApp(server);
    server.on('POST /api/time-entries', unreachable);

    await act(async () => {
      await mounted.app().addManualEntry(input('offline'));
    });

    expect(mounted.app().queue).toHaveLength(1);
    expect(mounted.app().queue[0]?.payload.description).toBe('offline');
    expect(mounted.app().online).toBe(false);
    expect(mounted.app().notice).toBe('Offline. Back-filled entry queued.');
  });

  it('throws a server rejection to the caller and does not queue it', async () => {
    const server = new FakeServer();
    const mounted = await readyApp(server);
    server.on('POST /api/time-entries', () => reject(400, 'invalid duration'));

    let failure: unknown;
    await act(async () => {
      await mounted
        .app()
        .addManualEntry(input('bad'))
        .catch((caught: unknown) => {
          failure = caught;
        });
    });

    expect((failure as Error).message).toBe('invalid duration');
    expect(mounted.app().queue).toHaveLength(0);
  });

  it('reports saved, queued and failed rows of a bulk save separately', async () => {
    const server = new FakeServer();
    const mounted = await readyApp(server);
    server.on('POST /api/time-entries', (call) => {
      const description = (call.body as { description: string }).description;
      if (description === 'net') {
        return unreachable();
      }
      if (description === 'bad') {
        return reject(400, 'invalid duration');
      }
      return { entry: timeEntry() };
    });

    let result: Awaited<ReturnType<ReturnType<typeof mounted.app>['addManualEntries']>>;
    await act(async () => {
      result = await mounted
        .app()
        .addManualEntries([input('ok'), input('net'), input('bad')]);
    });

    expect(result!.saved).toBe(1);
    expect(result!.queued).toBe(1);
    expect(result!.failed).toHaveLength(1);
    expect(result!.failed[0]?.message).toBe('invalid duration');
    expect(result!.failed[0]?.input.description).toBe('bad');
    expect(mounted.app().queue.map((item) => item.payload.description)).toEqual(['net']);
    expect(mounted.app().notice).toBe(
      '1 entry queued and will sync when the server is reachable.',
    );
  });

  it('does not refresh when nothing was saved', async () => {
    const server = new FakeServer();
    const mounted = await readyApp(server);
    server.on('POST /api/time-entries', unreachable);
    const meCalls = server.callsTo('GET /api/me').length;

    await act(async () => {
      await mounted.app().addManualEntries([input('a'), input('b')]);
    });

    expect(mounted.app().queue).toHaveLength(2);
    expect(mounted.app().notice).toBe(
      '2 entries queued and will sync when the server is reachable.',
    );
    expect(server.callsTo('GET /api/me')).toHaveLength(meCalls);
  });
});

// Keep reply/Call referenced for readers extending the file.
void reply;
