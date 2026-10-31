import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { queuedEntry } from './test/fixtures';
import { seedSession } from './test/harness';
import { FakeServer, reject } from './test/server';
import App from './App';

describe('App', () => {
  it('shows the loading state, then the sign-in screen without a session', async () => {
    new FakeServer();
    render(<App />);

    expect(screen.getByText('Loading Airtime…')).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy();
  });

  it('opens straight into the cached app, then refreshes from the server (cache-first boot)', async () => {
    const server = new FakeServer();
    let release: (value: unknown) => void = () => undefined;
    server.on('GET /api/organisation', () => new Promise((resolve) => (release = resolve)));
    seedSession({ cache: {} });

    render(<App />);

    // The server has not answered the data requests, but the cached shell is up.
    expect(await screen.findByRole('heading', { name: 'My time' })).toBeTruthy();
    expect(screen.getByText('Example Org')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Refreshing…' })).toBeTruthy();

    release({ organisation: { id: 'org-1', name: 'Renamed Org', reportingCurrency: 'EUR' } });
    expect(await screen.findByText('Renamed Org')).toBeTruthy();
  });

  it('opens the cached app offline and keeps it usable', async () => {
    new FakeServer().goOffline();
    seedSession({ cache: { queue: [queuedEntry('q1')] } });

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'My time' })).toBeTruthy();
    expect(await screen.findByText('Offline. Showing locally cached data.')).toBeTruthy();
    expect(screen.getByText('1 queued')).toBeTruthy();
  });

  it('goes back to sign-in when the saved session has expired', async () => {
    const server = new FakeServer();
    server.on('GET /api/me', () => reject(401, 'unauthorized'));
    seedSession({ cache: {} });

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy();
  });

  it('navigates between screens and opens and closes the back-fill dialog', async () => {
    new FakeServer()
      .on('GET /api/time-entries/summary', () => ({
        entries: [],
        totals: {
          entryCount: 0,
          totalMinutes: 0,
          billableMinutes: 0,
          cost: 0,
          currency: 'EUR',
          currencyTotals: {},
          conversions: {},
          fxStale: false,
          fxDate: null,
          uncosted: { entries: 0, minutes: 0 },
          unconverted: { entries: 0, minutes: 0 },
        },
      }))
      .on('GET /api/members', () => ({ members: [] }))
      .on('GET /api/rates', () => ({ rates: [] }));
    seedSession({ cache: {} });
    render(<App />);
    await screen.findByRole('heading', { name: 'My time' });

    fireEvent.click(screen.getByRole('button', { name: 'Projects' }));
    expect(await screen.findByRole('heading', { name: 'Projects' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Budgets' }));
    expect(await screen.findByRole('heading', { name: 'Budgets and rates' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Back-fill' }));
    expect(screen.getByRole('dialog', { name: 'Back-fill time' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
