import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ADMIN, MANAGER, PLAIN_MEMBER, queuedEntry } from '../test/fixtures';
import { mountApp, renderReady, seedSession } from '../test/harness';
import { FakeServer, unreachable } from '../test/server';
import { Shell, type View } from './Shell';

async function setup(member = ADMIN, options: { view?: View } = {}) {
  const server = new FakeServer();
  server.on('GET /api/me', () => ({ member }));
  const onNavigate = vi.fn();
  const onBackfill = vi.fn();
  const mounted = await renderReady(
    <Shell view={options.view ?? 'time'} onNavigate={onNavigate} onBackfill={onBackfill}>
      <p>page body</p>
    </Shell>,
    { cache: { member } },
  );
  return { server, onNavigate, onBackfill, ...mounted };
}

const nav = (name: string) => screen.queryByRole('button', { name });

describe('Shell', () => {
  it('shows every destination to an administrator', async () => {
    await setup(ADMIN);
    for (const name of ['My time', 'Back-fill', 'Reports', 'Projects', 'Budgets', 'Admin', 'Settings']) {
      expect(nav(name), name).toBeTruthy();
    }
  });

  it('hides Admin from a manager but keeps Reports and Budgets', async () => {
    await setup(MANAGER);
    expect(nav('Admin')).toBeNull();
    expect(nav('Reports')).toBeTruthy();
    expect(nav('Budgets')).toBeTruthy();
  });

  it('hides Reports, Budgets and Admin from a member', async () => {
    await setup(PLAIN_MEMBER);
    expect(nav('Reports')).toBeNull();
    expect(nav('Budgets')).toBeNull();
    expect(nav('Admin')).toBeNull();
    expect(nav('My time')).toBeTruthy();
    expect(nav('Projects')).toBeTruthy();
    expect(nav('Settings')).toBeTruthy();
  });

  it('marks the current view and navigates on click', async () => {
    const { onNavigate } = await setup(ADMIN, { view: 'projects' });
    expect(nav('Projects')!.getAttribute('aria-current')).toBe('page');
    expect(nav('My time')!.getAttribute('aria-current')).toBeNull();

    fireEvent.click(nav('Settings')!);
    fireEvent.click(nav('Budgets')!);

    expect(onNavigate).toHaveBeenNthCalledWith(1, 'settings');
    expect(onNavigate).toHaveBeenNthCalledWith(2, 'rates');
  });

  it('opens the back-fill dialog from the sidebar', async () => {
    const { onBackfill } = await setup();
    fireEvent.click(nav('Back-fill')!);
    expect(onBackfill).toHaveBeenCalledTimes(1);
  });

  it('shows the organisation, the member initials and the page body', async () => {
    await setup(ADMIN);
    expect(screen.getByText('Example Org')).toBeTruthy();
    expect(screen.getByTitle('Ada Admin').textContent).toBe('AA');
    expect(screen.getByText('page body')).toBeTruthy();
    expect(screen.queryByText('Offline', { selector: '.badge' })).toBeNull();
  });

  it('refreshes from the server on request', async () => {
    const { server } = await setup();
    const before = server.callsTo('GET /api/me').length;

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => expect(server.callsTo('GET /api/me').length).toBe(before + 1));
  });

  it('shows the offline badge and a dismissable notice when the refresh cannot reach the server', async () => {
    const { server } = await setup();
    server.on('GET /api/me', unreachable);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    const banner = await screen.findByRole('status');
    expect(banner.textContent).toContain('Offline. Showing locally cached data.');
    expect(screen.getAllByText('Offline').length).toBeGreaterThan(0);

    fireEvent.click(within(banner).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Offline. Showing locally cached data.')).toBeNull();
  });

  it('shows how many entries wait in the offline queue', async () => {
    new FakeServer().on('POST /api/time-entries', unreachable);
    // Boot never finishes loading while the queue cannot be sent, so mount directly.
    seedSession({ cache: { queue: [queuedEntry('a'), queuedEntry('b')] } });
    mountApp(
      <Shell view="time" onNavigate={vi.fn()} onBackfill={vi.fn()}>
        <p>page body</p>
      </Shell>,
    );

    expect(await screen.findByText('2 queued')).toBeTruthy();
  });
});
