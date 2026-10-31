import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SESSION_KEY } from '../lib/native';
import { ADMIN, MANAGER, runningTimer } from '../test/fixtures';
import { field, renderReady } from '../test/harness';
import { FakeServer, reject } from '../test/server';
import { Settings } from './Settings';

async function setup(member = ADMIN) {
  const server = new FakeServer();
  server.on('GET /api/me', () => ({ member }));
  const mounted = await renderReady(<Settings />, { cache: { member } });
  return { server, ...mounted };
}

function connectForm() {
  fireEvent.change(field('Workspace slug'), { target: { value: 'acme' } });
  fireEvent.change(field('Personal API token'), { target: { value: 'plane_api_test' } });
}

describe('Settings', () => {
  it('shows the account and the current server', async () => {
    await setup();
    expect(screen.getByText('Ada Admin')).toBeTruthy();
    expect(screen.getByText(/ada@example.test · administrator · server/)).toBeTruthy();
  });

  it('signs out', async () => {
    const { app } = await setup();
    window.localStorage.setItem(SESSION_KEY, 'session-token');

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(app().status).toBe('login'));
    await waitFor(() => expect(window.localStorage.getItem(SESSION_KEY)).toBeNull());
  });

  it('opts in to anonymised corrections', async () => {
    const { server } = await setup();
    server.on('PATCH /api/me/feedback', () => ({ member: { ...ADMIN, feedbackOptIn: true } }));

    fireEvent.click(screen.getByRole('checkbox'));

    await waitFor(() =>
      expect(server.callsTo('PATCH /api/me/feedback')[0]?.body).toEqual({ optIn: true }),
    );
    await waitFor(() => expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true));
  });

  it('connects Plane and reports the workspace (happy path)', async () => {
    const { server } = await setup();
    server.on('PUT /api/plane/connection', () => ({
      workspace: { slug: 'acme', projectCount: 4 },
    }));

    connectForm();
    fireEvent.click(screen.getByRole('button', { name: 'Connect and sync' }));

    expect(await screen.findByText('Connected to acme (4 projects)')).toBeTruthy();
    expect(server.callsTo('PUT /api/plane/connection')[0]?.body).toEqual({
      baseUrl: 'https://plane.example.com',
      workspaceSlug: 'acme',
      token: 'plane_api_test',
    });
    // The token field is cleared once it has been sent.
    expect((field('Personal API token') as HTMLInputElement).value).toBe('');
  });

  it('shows the server message when Plane rejects the connection (error path)', async () => {
    const { server } = await setup();
    server.on('PUT /api/plane/connection', () => reject(400, 'plane token invalid'));

    connectForm();
    fireEvent.click(screen.getByRole('button', { name: 'Connect and sync' }));

    expect(await screen.findByText('plane token invalid')).toBeTruthy();
  });

  it('keeps Connect disabled until the slug and token are filled in, and Sync disabled until connected', async () => {
    await setup();
    expect((screen.getByRole('button', { name: 'Connect and sync' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Sync now' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('syncs an existing connection (happy path)', async () => {
    const server = new FakeServer();
    server.on('GET /api/plane/connection', () => ({
      connection: {
        baseUrl: 'https://plane.acme.test',
        workspaceSlug: 'acme',
        status: 'active',
        lastVerifiedAt: null,
        lastSyncedAt: null,
        lastError: null,
        webhookPath: null,
      },
    }));
    server.on('POST /api/plane/sync', () => ({ sync: { projects: 3, workItems: 17 } }));
    await renderReady(<Settings />);

    expect(screen.getByText('active')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));

    expect(await screen.findByText('Synced 3 projects and 17 work items')).toBeTruthy();
  });

  it('shows the server message when the sync fails (error path)', async () => {
    const server = new FakeServer();
    server.on('GET /api/plane/connection', () => ({
      connection: {
        baseUrl: 'https://plane.acme.test',
        workspaceSlug: 'acme',
        status: 'active',
        lastVerifiedAt: null,
        lastSyncedAt: null,
        lastError: null,
        webhookPath: null,
      },
    }));
    server.on('POST /api/plane/sync', () => reject(502, 'plane unreachable'));
    await renderReady(<Settings />);

    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));

    expect(await screen.findByText('plane unreachable')).toBeTruthy();
  });

  it('lets an administrator change the reporting currency (happy path)', async () => {
    const { server } = await setup(ADMIN);
    server.on('PATCH /api/organisation', () => ({
      organisation: { id: 'org-1', name: 'Example Org', reportingCurrency: 'USD' },
    }));

    fireEvent.change(field<HTMLSelectElement>('Reporting currency'), { target: { value: 'USD' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save currency' }));

    expect(await screen.findByText('Reporting currency set to USD.')).toBeTruthy();
    expect(server.callsTo('PATCH /api/organisation')[0]?.body).toEqual({ reportingCurrency: 'USD' });
  });

  it('shows the server message when the currency cannot be saved (error path)', async () => {
    const { server } = await setup(ADMIN);
    server.on('PATCH /api/organisation', () => reject(400, 'unsupported currency'));

    fireEvent.change(field<HTMLSelectElement>('Reporting currency'), { target: { value: 'CHF' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save currency' }));

    expect(await screen.findByText('unsupported currency')).toBeTruthy();
  });

  it('refreshes the FX rates (happy path)', async () => {
    const { server } = await setup(ADMIN);
    server.on('POST /api/fx/refresh', () => ({ refreshed: true, stored: 30, date: '2026-09-02' }));

    fireEvent.click(screen.getByRole('button', { name: 'Refresh FX rates' }));

    expect(await screen.findByText('Foreign-exchange rates refreshed.')).toBeTruthy();
    expect(server.callsTo('POST /api/fx/refresh')).toHaveLength(1);
  });

  it('shows the server message when the FX refresh fails (error path)', async () => {
    const { server } = await setup(ADMIN);
    server.on('POST /api/fx/refresh', () => reject(502, 'rate provider down'));

    fireEvent.click(screen.getByRole('button', { name: 'Refresh FX rates' }));

    expect(await screen.findByText('rate provider down')).toBeTruthy();
  });

  it('hides the currency actions from a non-administrator', async () => {
    await setup(MANAGER);
    expect((field<HTMLSelectElement>('Reporting currency')).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save currency' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Refresh FX rates' })).toBeNull();
    expect(screen.getByText(/Only administrators can change these settings/)).toBeTruthy();
  });
});

describe('Settings keyboard shortcuts', () => {
  const rowOf = (label: string) =>
    screen.getByText(label, { selector: 'th' }).closest('tr') as HTMLElement;

  const stored = () => JSON.parse(window.localStorage.getItem('airtime.shortcuts') ?? '{}');

  it('lists every shortcut with its default keys and a spoken form', async () => {
    await setup();
    const section = screen.getByRole('region', { name: 'Keyboard shortcuts' });
    const rows = within(section).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(6);
    expect(within(rowOf('Start or stop the timer')).getByText('Control Alt T')).toBeTruthy();
    expect(within(rowOf('Search work items')).getByText('Control K')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reset all' }).hasAttribute('disabled')).toBe(true);
  });

  it('rebinds a shortcut by pressing the new keys, and remembers it', async () => {
    await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Change shortcut for Back-fill time' }));
    const capture = screen.getByRole('button', {
      name: 'Press the new keys for Back-fill time, or Escape to cancel',
    });
    expect(document.activeElement).toBe(capture);

    fireEvent.keyDown(capture, { key: 'j', ctrlKey: true, altKey: true });

    expect(within(rowOf('Back-fill time')).getByText('Control Alt J')).toBeTruthy();
    expect(screen.getByText('Saved. Back-fill time, Control Alt J.')).toBeTruthy();
    expect(stored()).toEqual({ backfill: { ctrl: true, alt: true, shift: false, key: 'J' } });
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Change shortcut for Back-fill time' }),
    );
  });

  it('refuses a combination another shortcut uses and says which', async () => {
    await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Change shortcut for Back-fill time' }));

    fireEvent.keyDown(document.activeElement!, { key: 't', ctrlKey: true, altKey: true });

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('Ctrl+Alt+T is already used for "Start or stop the timer".');
    expect(stored()).toEqual({});
  });

  it('refuses a bare key and a text-editing combination', async () => {
    await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Change shortcut for Open timesheet' }));

    fireEvent.keyDown(document.activeElement!, { key: 'j' });
    expect(screen.getByRole('alert').textContent).toMatch(/Ctrl or Alt/);

    fireEvent.keyDown(document.activeElement!, { key: 'c', ctrlKey: true });
    expect(screen.getByRole('alert').textContent).toMatch(/editing text/);
    expect(stored()).toEqual({});
  });

  it('waits through a bare modifier and cancels with Escape', async () => {
    await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Change shortcut for Show tray menu' }));

    fireEvent.keyDown(document.activeElement!, { key: 'Control', ctrlKey: true });
    expect(screen.getByText('Press the new keys…')).toBeTruthy();

    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByText('Press the new keys…')).toBeNull();
    expect(within(rowOf('Show tray menu')).getByText('Control Alt M')).toBeTruthy();
  });

  it('resets one shortcut or all of them', async () => {
    await setup();
    for (const [label, key] of [
      ['Back-fill time', 'j'],
      ['Open timesheet', 'l'],
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name: `Change shortcut for ${label}` }));
      fireEvent.keyDown(document.activeElement!, { key, ctrlKey: true, altKey: true });
    }
    expect(Object.keys(stored()).sort()).toEqual(['backfill', 'timesheet']);

    fireEvent.click(screen.getByRole('button', { name: 'Reset shortcut for Back-fill time' }));
    expect(within(rowOf('Back-fill time')).getByText('Control Alt B')).toBeTruthy();
    expect(Object.keys(stored())).toEqual(['timesheet']);

    fireEvent.click(screen.getByRole('button', { name: 'Reset all' }));
    expect(within(rowOf('Open timesheet')).getByText('Control Alt S')).toBeTruthy();
    expect(window.localStorage.getItem('airtime.shortcuts')).toBeNull();
  });

  it('does not fire a shortcut while listening for new keys', async () => {
    const { server } = await setup();
    server.on('POST /api/timer/start', () => ({ timer: runningTimer() }));
    fireEvent.click(screen.getByRole('button', { name: 'Change shortcut for Back-fill time' }));
    expect(screen.getByText('Press the new keys…')).toBeTruthy();
    // The capture handler owns the key press, so nothing else may react to it.
    fireEvent.keyDown(document.activeElement!, { key: 't', ctrlKey: true, altKey: true });
    expect(server.callsTo('POST /api/timer/start')).toHaveLength(0);
  });
});
