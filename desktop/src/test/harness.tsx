import { render, waitFor } from '@testing-library/react';
import { expect } from 'vitest';
import { useEffect, useState, type ReactNode } from 'react';
import { AppProvider, useApp } from '../state/AppContext';
import { SESSION_KEY } from '../lib/native';
import type { CacheSnapshot } from '../lib/types';
import {
  ADMIN,
  ORGANISATION,
  PROJECTS,
  WORK_ITEMS,
  runningTimer,
  timeEntry,
} from './fixtures';

type AppValue = ReturnType<typeof useApp>;

export const CACHE_KEY = 'airtime.cache';
export const SERVER_URL_KEY = 'airtime.server-url';

/** Seed the browser stores the way a previous session leaves them. */
export function seedSession(
  options: {
    token?: string | null;
    cache?: Partial<CacheSnapshot> | string | null;
    serverUrl?: string;
  } = {},
): void {
  const token = options.token === undefined ? 'session-token' : options.token;
  if (token) {
    window.localStorage.setItem(SESSION_KEY, token);
  }
  if (options.serverUrl) {
    window.localStorage.setItem(SERVER_URL_KEY, options.serverUrl);
  }
  const cache = options.cache;
  if (typeof cache === 'string') {
    window.localStorage.setItem(CACHE_KEY, cache);
  } else if (cache) {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(snapshot(cache)));
  }
}

export function snapshot(overrides: Partial<CacheSnapshot> = {}): CacheSnapshot {
  return {
    savedAt: '2026-09-02T08:00:00.000Z',
    member: ADMIN,
    organisation: ORGANISATION,
    projects: PROJECTS,
    workItems: WORK_ITEMS,
    entries: [timeEntry()],
    timer: null,
    queue: [],
    ...overrides,
  };
}

export function cachedTimer(overrides: Parameters<typeof runningTimer>[0] = {}) {
  return runningTimer(overrides);
}

export function readCache(): CacheSnapshot | null {
  const raw = window.localStorage.getItem(CACHE_KEY);
  return raw ? (JSON.parse(raw) as CacheSnapshot) : null;
}

/**
 * Mount the real AppProvider. `app()` returns the latest context value so a
 * test can call the actions and read the state without any screen on top.
 */
export function mountApp(children: ReactNode = null): { app: () => AppValue } {
  const latest: { current: AppValue | null } = { current: null };
  function Probe() {
    const value = useApp();
    useEffect(() => {
      latest.current = value;
    });
    return null;
  }
  render(
    <AppProvider>
      <Probe />
      {children}
    </AppProvider>,
  );
  return {
    app: () => {
      if (!latest.current) {
        throw new Error('app context not mounted');
      }
      return latest.current;
    },
  };
}

/**
 * Mount `ui` inside the real AppProvider with a signed-in session, and wait
 * until the boot refresh has settled, so a screen starts from a known state.
 */
export async function renderReady(
  ui: ReactNode,
  options: { cache?: Partial<CacheSnapshot> } = {},
): Promise<{ app: () => AppValue }> {
  seedSession({ cache: options.cache ?? {} });
  // Like App.tsx, show the screen only once the session is ready, so components
  // that read context in their initial state see the loaded data.
  function Gate() {
    // `fx` is never cached, so it is set only once boot has loaded fresh data.
    const { status, refreshing, fx } = useApp();
    const [open, setOpen] = useState(false);
    if (!open && status === 'ready' && !refreshing && fx) {
      setOpen(true);
    }
    return open ? <>{ui}</> : null;
  }
  const mounted = mountApp(<Gate />);
  await waitFor(() => {
    expect(mounted.app().status).toBe('ready');
    expect(mounted.app().fx).not.toBeNull();
    expect(mounted.app().refreshing).toBe(false);
  });
  return mounted;
}

/**
 * The form control inside the `Field` with this label. `Field` renders a bare
 * `<label>` without `htmlFor`, so `getByLabelText` cannot reach the control.
 */
export function field<T extends HTMLElement = HTMLInputElement>(
  label: string,
  scope: HTMLElement = document.body,
): T {
  const labels = Array.from(scope.querySelectorAll('.field > label')).filter(
    (node) => node.textContent === label,
  );
  if (labels.length !== 1) {
    throw new Error(`expected one field labelled "${label}", found ${labels.length}`);
  }
  const control = labels[0]!.parentElement!.querySelector('input, select, textarea');
  if (!control) {
    throw new Error(`field "${label}" has no control`);
  }
  return control as T;
}
