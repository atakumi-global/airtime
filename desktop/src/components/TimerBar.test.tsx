import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { runningTimer } from '../test/fixtures';
import { renderReady } from '../test/harness';
import { FakeServer, reject, unreachable } from '../test/server';
import { TimerBar } from './TimerBar';

describe('TimerBar', () => {
  it('shows an idle bar with a Start timer button when no timer runs', async () => {
    new FakeServer();
    await renderReady(<TimerBar />);

    const bar = screen.getByRole('region', { name: /^Timer/ });
    expect(bar.getAttribute('data-timer-state')).toBe('idle');
    expect(screen.getByText('No timer running')).toBeTruthy();
    expect(screen.getByRole('timer').textContent).toBe('00:00:00');
    expect(screen.getByRole('button', { name: /Start timer/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Stop & save/ })).toBeNull();
  });

  it('starts a timer on the first work item and then offers pause and stop', async () => {
    const server = new FakeServer();
    server.on('POST /api/timer/start', () => ({ timer: runningTimer() }));
    await renderReady(<TimerBar />);

    fireEvent.click(screen.getByRole('button', { name: /Start timer/ }));

    await waitFor(() =>
      expect(screen.getByRole('region', { name: /^Timer/ }).getAttribute('data-timer-state')).toBe('running'),
    );
    expect(server.callsTo('POST /api/timer/start')[0]?.body).toEqual({
      workItemId: 'plane-wi-1',
      description: null,
    });
    expect(screen.getByText('WEB-1 · Build the landing page')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pause timer' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Stop & save/ })).toBeTruthy();
  });

  it('counts the elapsed time of a running timer', async () => {
    new FakeServer().on('GET /api/timer', () => ({
      timer: runningTimer({ started_at: new Date(Date.now() - 3_725_000).toISOString() }),
    }));
    await renderReady(<TimerBar />, {
      cache: { timer: runningTimer({ started_at: new Date(Date.now() - 3_725_000).toISOString() }) },
    });

    expect(screen.getByRole('timer').textContent).toMatch(/^01:02:0[5-9]$/);
  });

  it('stops the timer and returns to idle', async () => {
    const server = new FakeServer();
    server.on('GET /api/timer', () => ({ timer: runningTimer() }));
    server.on('POST /api/timer/stop', () => {
      server.on('GET /api/timer', () => ({ timer: null }));
      return { entry: {} };
    });
    await renderReady(<TimerBar />, { cache: { timer: runningTimer() } });

    fireEvent.click(screen.getByRole('button', { name: /Stop & save/ }));

    await waitFor(() =>
      expect(screen.getByRole('region', { name: /^Timer/ }).getAttribute('data-timer-state')).toBe('idle'),
    );
    expect(server.callsTo('POST /api/timer/stop')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /Start timer/ })).toBeTruthy();
  });

  it('pauses and resumes', async () => {
    const server = new FakeServer();
    server.on('GET /api/timer', () => ({ timer: runningTimer() }));
    server.on('POST /api/timer/pause', () => ({
      timer: runningTimer({ state: 'paused', paused_at: new Date().toISOString() }),
    }));
    server.on('POST /api/timer/resume', () => ({ timer: runningTimer({ paused_seconds: 3 }) }));
    await renderReady(<TimerBar />, { cache: { timer: runningTimer() } });

    fireEvent.click(screen.getByRole('button', { name: 'Pause timer' }));
    await waitFor(() =>
      expect(screen.getByRole('region', { name: /^Timer/ }).getAttribute('data-timer-state')).toBe('paused'),
    );
    expect(screen.getByText('Timer paused', { exact: false })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Resume/ }));
    await waitFor(() =>
      expect(screen.getByRole('region', { name: /^Timer/ }).getAttribute('data-timer-state')).toBe('running'),
    );
  });

  it('shows the Offline and queued badges while entries wait to sync', async () => {
    const server = new FakeServer();
    server.on('GET /api/timer', () => ({ timer: runningTimer() }));
    server.on('POST /api/timer/stop', unreachable);
    await renderReady(<TimerBar />, { cache: { timer: runningTimer() } });

    fireEvent.click(screen.getByRole('button', { name: /Stop & save/ }));

    await waitFor(() => expect(screen.getByText('Offline')).toBeTruthy());
    expect(screen.getByText('1 queued')).toBeTruthy();
  });

  it('keeps the bar idle when the server rejects the start', async () => {
    const server = new FakeServer();
    server.on('POST /api/timer/start', () => reject(409, 'timer already running'));
    await renderReady(<TimerBar />);

    fireEvent.click(screen.getByRole('button', { name: /Start timer/ }));

    await waitFor(() =>
      expect(screen.getByRole('region', { name: /^Timer/ }).getAttribute('data-timer-state')).toBe('idle'),
    );
  });

  it('toggles the timer with Ctrl+Alt+T', async () => {
    const server = new FakeServer();
    server.on('POST /api/timer/start', () => ({ timer: runningTimer() }));
    await renderReady(<TimerBar />);

    await act(async () => {
      fireEvent.keyDown(window, { key: 't', ctrlKey: true, altKey: true });
    });

    await waitFor(() => expect(server.callsTo('POST /api/timer/start')).toHaveLength(1));
  });

  it('shows the shortcut as keys, and a spoken description on the timer buttons', async () => {
    new FakeServer();
    await renderReady(<TimerBar />);

    const start = screen.getByRole('button', { name: /Start timer/ });
    expect(start.getAttribute('aria-keyshortcuts')).toBe('Control+Alt+T');
    const described = document.getElementById(start.getAttribute('aria-describedby') ?? '');
    expect(described?.textContent).toBe('Shortcut: Start or stop the timer, Control Alt T');
    expect(document.querySelectorAll('.timerbar kbd')).toHaveLength(3);
  });

  it('follows a rebound shortcut and ignores the old keys', async () => {
    window.localStorage.setItem(
      'airtime.shortcuts',
      JSON.stringify({ timer: { ctrl: true, alt: true, shift: false, key: 'J' } }),
    );
    const server = new FakeServer();
    server.on('POST /api/timer/start', () => ({ timer: runningTimer() }));
    await renderReady(<TimerBar />);

    await act(async () => {
      fireEvent.keyDown(window, { key: 't', ctrlKey: true, altKey: true });
    });
    expect(server.callsTo('POST /api/timer/start')).toHaveLength(0);

    await act(async () => {
      fireEvent.keyDown(window, { key: 'j', ctrlKey: true, altKey: true });
    });
    await waitFor(() => expect(server.callsTo('POST /api/timer/start')).toHaveLength(1));
    expect(
      screen.getByRole('button', { name: /Start timer|Stop & save/ }).getAttribute('aria-keyshortcuts'),
    ).toBe('Control+Alt+J');
  });

  it('still toggles while a dialog is open', async () => {
    const server = new FakeServer();
    server.on('POST /api/timer/start', () => ({ timer: runningTimer() }));
    await renderReady(
      <>
        <div role="dialog" aria-modal="true" aria-label="Open dialog" />
        <TimerBar />
      </>,
    );

    await act(async () => {
      fireEvent.keyDown(window, { key: 't', ctrlKey: true, altKey: true });
    });

    await waitFor(() => expect(server.callsTo('POST /api/timer/start')).toHaveLength(1));
  });

  it('shows the workspace of the running timer and puts it in the accessible name', async () => {
    const server = new FakeServer();
    server.on('GET /api/timer', () => ({ timer: runningTimer({ workspace_slug: 'beta' }) }));
    await renderReady(<TimerBar />);
    const bar = screen.getByRole('region', { name: 'Timer, workspace beta' });
    expect(bar.textContent).toContain('beta');
  });

  it('falls back to the work item workspace when the timer carries none (offline start)', async () => {
    const server = new FakeServer();
    server.on('GET /api/timer', () => ({ timer: runningTimer() }));
    await renderReady(<TimerBar />);
    expect(screen.getByRole('region', { name: 'Timer, workspace acme' })).toBeTruthy();
  });

  it('keeps the plain name when no timer runs', async () => {
    new FakeServer();
    await renderReady(<TimerBar />);
    expect(screen.getByRole('region', { name: /^Timer/ })).toBeTruthy();
  });
});
