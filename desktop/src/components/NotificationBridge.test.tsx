import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PROJECTS, runningTimer, summary, timeEntry } from '../test/fixtures';
import { mountApp, renderReady, seedSession } from '../test/harness';
import { FakeServer, unreachable } from '../test/server';
import { TimerBar } from './TimerBar';
import { NotificationBridge } from './NotificationBridge';
import type { NotificationAction, NotificationRequest } from '../lib/notifications';

const native = vi.hoisted(() => ({
  notify: vi.fn(),
  handler: null as null | ((event: { id: string; action: NotificationAction }) => void),
}));

vi.mock('../lib/notifications', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/notifications')>();
  return {
    ...original,
    notify: native.notify,
    onNotificationAction: async (
      handler: (event: { id: string; action: NotificationAction }) => void,
    ) => {
      native.handler = handler;
      return () => {
        native.handler = null;
      };
    },
  };
});

function raised(): NotificationRequest[] {
  return native.notify.mock.calls.map((call) => call[0] as NotificationRequest);
}

async function setup(
  options: { timer?: boolean; entries?: ReturnType<typeof timeEntry>[] } = {},
) {
  const server = new FakeServer();
  const timer = options.timer ? runningTimer() : null;
  if (timer) {
    server.on('GET /api/timer', () => ({ timer }));
  }
  const onTimesheet = vi.fn();
  const onProjects = vi.fn();
  const mounted = await renderReady(
    <>
      <NotificationBridge onTimesheet={onTimesheet} onProjects={onProjects} />
      <TimerBar />
    </>,
    { cache: { timer, entries: options.entries ?? [timeEntry()] } },
  );
  await waitFor(() => expect(native.handler).not.toBeNull());
  return { server, onTimesheet, onProjects, ...mounted };
}

describe('NotificationBridge', () => {
  beforeEach(() => {
    native.notify.mockReset();
    native.notify.mockResolvedValue('shown');
    native.handler = null;
  });

  it('raises nothing for the first sync or for ordinary use', async () => {
    await setup();
    expect(raised()).toEqual([]);
  });

  it('treats a cached timer that the server no longer has as the first sync, not a stop', async () => {
    const server = new FakeServer();
    server.on('GET /api/timer', () => ({ timer: null }));
    // Mounted from the start like in App.tsx, so it sees the cache and the first sync.
    seedSession({ cache: { timer: runningTimer(), entries: [timeEntry()] } });
    const mounted = mountApp(
      <NotificationBridge onTimesheet={vi.fn()} onProjects={vi.fn()} />,
    );
    await waitFor(() => {
      expect(mounted.app().status).toBe('ready');
      expect(mounted.app().fx).not.toBeNull();
      expect(mounted.app().refreshing).toBe(false);
    });
    expect(mounted.app().timer).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(raised()).toEqual([]);
  });

  it('raises "Entry saved" with a View action when stopping the timer creates an entry', async () => {
    const saved = timeEntry({ id: 'new', source: 'timer', work_item_id: 'plane-wi-1', duration_minutes: 90 });
    const server = await setup({ timer: true }).then(async (ctx) => {
      ctx.server.on('POST /api/timer/stop', () => ({ entry: saved }));
      ctx.server.on('GET /api/time-entries', () => ({ entries: [timeEntry(), saved] }));
      ctx.server.on('GET /api/timer', () => ({ timer: null }));
      return ctx;
    });

    fireEvent.click(screen.getByRole('button', { name: /Stop & save/ }));

    await waitFor(() => expect(raised()).toHaveLength(1));
    expect(raised()[0]).toMatchObject({
      tone: 'success',
      title: 'Entry saved',
      body: '1h 30m on WEB-1',
    });

    act(() => native.handler?.({ id: raised()[0]!.id, action: 'view' }));
    expect(server.onTimesheet).toHaveBeenCalledTimes(1);
    expect(server.onProjects).not.toHaveBeenCalled();
  });

  it('does not call a stop that failed offline an unexpected stop', async () => {
    const ctx = await setup({ timer: true });
    ctx.server.on('POST /api/timer/stop', unreachable);

    fireEvent.click(screen.getByRole('button', { name: /Stop & save/ }));

    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Timer' }).getAttribute('data-timer-state')).toBe('idle'),
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(raised()).toEqual([]);
  });

  it('raises "Timer stopped unexpectedly" with a Restart action, and Restart starts it again', async () => {
    const ctx = await setup({ timer: true });
    ctx.server.on('GET /api/timer', () => ({ timer: null }));
    ctx.server.on('POST /api/timer/start', () => ({ timer: runningTimer() }));

    // The server no longer has the timer; a refresh finds out.
    await act(async () => {
      await ctx.app().refresh();
    });

    await waitFor(() => expect(raised()).toHaveLength(1));
    expect(raised()[0]).toMatchObject({
      tone: 'error',
      title: 'Timer stopped unexpectedly',
    });

    act(() => native.handler?.({ id: raised()[0]!.id, action: 'restart' }));
    await waitFor(() => expect(ctx.server.callsTo('POST /api/timer/start')).toHaveLength(1));
    expect(ctx.server.callsTo('POST /api/timer/start')[0]?.body).toMatchObject({
      workItemId: 'plane-wi-1',
    });
  });

  it('ignores a Restart that this session never raised', async () => {
    const ctx = await setup();
    ctx.server.on('POST /api/timer/start', () => ({ timer: runningTimer() }));
    act(() => native.handler?.({ id: 'n-from-elsewhere', action: 'restart' }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(ctx.server.callsTo('POST /api/timer/start')).toHaveLength(0);
  });

  it('raises a warning with an Open action when a margin falls below target', async () => {
    const ctx = await setup();
    const below = PROJECTS.map((project, index) =>
      index === 0
        ? {
            ...project,
            summary: summary({ marginTargetMet: false, margin: 300, marginTargetAmount: 500 }),
          }
        : project,
    );
    ctx.server.on('GET /api/projects', () => ({ projects: below }));

    await act(async () => {
      await ctx.app().refresh();
    });

    await waitFor(() => expect(raised()).toHaveLength(1));
    expect(raised()[0]).toMatchObject({ tone: 'warning', title: 'Margin below target' });
    expect(raised()[0]?.body).toContain('Website');

    act(() => native.handler?.({ id: raised()[0]!.id, action: 'open' }));
    expect(ctx.onProjects).toHaveBeenCalledTimes(1);

    // A second refresh with the same data must not repeat the warning.
    await act(async () => {
      await ctx.app().refresh();
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(raised()).toHaveLength(1);
  });

  it('survives the shell refusing a notification', async () => {
    native.notify.mockRejectedValue(new Error('no notifications here'));
    const ctx = await setup({ timer: true });
    ctx.server.on('GET /api/timer', () => ({ timer: null }));
    await act(async () => {
      await ctx.app().refresh();
    });
    await waitFor(() => expect(native.notify).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('region', { name: 'Timer' })).toBeTruthy();
  });
});
