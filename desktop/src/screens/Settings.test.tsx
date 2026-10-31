import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SESSION_KEY } from '../lib/native';
import { ADMIN, MANAGER } from '../test/fixtures';
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
