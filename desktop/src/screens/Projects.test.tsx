import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ADMIN, PLAIN_MEMBER, PROJECTS, expense, summary, timeEntry } from '../test/fixtures';
import { field, mountApp, renderReady, seedSession } from '../test/harness';
import { FakeServer, reject } from '../test/server';
import { Projects } from './Projects';

async function setup(
  member = ADMIN,
  projects = PROJECTS,
  onNavigate: (view: string) => void = vi.fn(),
) {
  const server = new FakeServer();
  server.on('GET /api/me', () => ({ member }));
  server.on('GET /api/projects', () => ({ projects }));
  server.on('GET /api/projects/project-1/summary', () => ({
    project: projects[0],
    summary: summary(),
  }));
  server.on('GET /api/projects/project-1/budget', () => ({ budget: null }));
  server.on('GET /api/time-entries', (call) =>
    call.query.get('projectId')
      ? { entries: [timeEntry({ description: 'Hero work' })] }
      : { entries: [] },
  );
  const mounted = await renderReady(<Projects onNavigate={onNavigate} />, {
    cache: { member, projects },
  });
  return { server, onNavigate, ...mounted };
}

describe('Projects', () => {
  it('lists each project with its health badge and budget use', async () => {
    await setup();
    expect(screen.getByRole('button', { name: 'Website' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mobile app' })).toBeTruthy();
    expect(screen.getByText('On track')).toBeTruthy();
    expect(screen.getByText('No budget')).toBeTruthy();
    expect(screen.getByRole('meter', { name: 'Budget used for Website' }).getAttribute('aria-valuenow')).toBe('40');
    expect(screen.getByText('2 open items · from Plane', { exact: false })).toBeTruthy();
  });

  it('marks a project the member has left as history only', async () => {
    await setup(ADMIN, [
      { ...PROJECTS[0]!, can_enter_time: false },
      { ...PROJECTS[1]!, can_enter_time: true },
    ]);
    expect(screen.getAllByText('History only', { exact: false })).toHaveLength(1);
  });

  it('counts open work items per project', async () => {
    await setup();
    expect(screen.getByText('2 open items · from Plane')).toBeTruthy();
    expect(screen.getByText('0 open items · from Plane')).toBeTruthy();
  });

  it('flags projects that need attention', async () => {
    const flagged = [
      { ...PROJECTS[0]!, summary: summary({ flag: 'over', percentUsed: 120 }) },
      PROJECTS[1]!,
    ];
    await setup(ADMIN, flagged);
    expect(screen.getByText(/Website needs attention\./)).toBeTruthy();
    expect(screen.getByText('Over budget · 120%')).toBeTruthy();
  });

  it('shows the empty state when there are no projects', async () => {
    await setup(ADMIN, []);
    expect(screen.getByText('No projects yet.')).toBeTruthy();
  });

  it('says it is showing cached data when offline', async () => {
    const server = new FakeServer().goOffline();
    const { app } = await renderReadyOffline();
    expect(app().online).toBe(false);
    expect(screen.getByText('Offline. Showing cached projects and budgets.')).toBeTruthy();
    expect(server.callsTo('GET /api/me').length).toBeGreaterThan(0);
  });

  it('opens the budget dialog from a row and saves a budget (happy path)', async () => {
    const { server } = await setup();
    server.on('PUT /api/projects/project-2/budget', () => ({ budget: {} }));
    server.on('GET /api/projects/project-2/budget', () => ({ budget: null }));

    const row = screen.getByRole('button', { name: 'Mobile app' }).closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Set budget' }));

    const dialog = await screen.findByRole('dialog', { name: 'Budget for Mobile app' });
    await waitFor(() => expect(within(dialog).queryByText('Loading budget…')).toBeNull());
    fireEvent.change(field('Budget amount', dialog), { target: { value: '5000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save budget' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const body = server.callsTo('PUT /api/projects/project-2/budget')[0]!.body as { amount: number };
    expect(body.amount).toBe(5000);
  });

  it('labels the row action "Edit budget" when a budget exists', async () => {
    await setup();
    const row = screen.getByRole('button', { name: 'Website' }).closest('tr') as HTMLElement;
    expect(within(row).getByRole('button', { name: 'Edit budget' })).toBeTruthy();
  });

  it('hides budget editing from a member', async () => {
    await setup(PLAIN_MEMBER);
    expect(screen.queryByRole('button', { name: 'Edit budget' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Set budget' })).toBeNull();
  });

  it('opens the project detail with its summary and recent entries, and goes back', async () => {
    await setup();

    fireEvent.click(screen.getByRole('button', { name: 'Website' }));

    expect(await screen.findByRole('heading', { name: 'Website' })).toBeTruthy();
    expect(await screen.findByText('Recent time entries')).toBeTruthy();
    expect(await screen.findByText(/WEB-1 Build the landing page/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '← Projects' }));
    expect(await screen.findByRole('heading', { name: 'Projects' })).toBeTruthy();
  });

  it('shows the server message and retries when the detail cannot load (error path)', async () => {
    const { server } = await setup();
    server.on('GET /api/projects/project-1/summary', () => reject(500, 'summary failed'));

    fireEvent.click(screen.getByRole('button', { name: 'Website' }));
    expect(await screen.findByText('summary failed')).toBeTruthy();

    server.on('GET /api/projects/project-1/summary', () => ({ project: PROJECTS[0], summary: summary() }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(screen.queryByText('summary failed')).toBeNull());
    expect(await screen.findByText('Recent time entries')).toBeTruthy();
  });

  it('lists expenses in the detail and lets a manager add one', async () => {
    const { server } = await setup();
    server.on('GET /api/projects/project-1/expenses', () => ({
      expenses: [
        expense(),
        expense({
          id: 'expense-2',
          category: 'travel',
          note: null,
          currency: 'GBP',
          amount: '100.00',
          amount_reporting: '115.0000',
          fx_rate: '1.15000000',
        }),
      ],
    }));
    server.on('GET /api/projects/project-1/summary', () => ({
      project: PROJECTS[0],
      summary: summary({
        spent: 635,
        expenses: {
          total: 235,
          count: 2,
          byCategory: { licences: 120, travel: 115, hardware: 0, subcontractors: 0, other: 0 },
          currencyTotals: { EUR: 120, GBP: 100 },
          unconverted: 0,
        },
      }),
    }));
    server.on('POST /api/projects/project-1/expenses', () => ({ expense: expense() }));

    fireEvent.click(screen.getByRole('button', { name: 'Website' }));
    expect(await screen.findByText('Licences · Design tool seats')).toBeTruthy();
    expect(screen.getByText('Travel')).toBeTruthy();
    expect(screen.getByText('€235')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Add expense' }));
    fireEvent.change(field('Amount'), { target: { value: '20' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add expense' }));
    await waitFor(() => expect(server.callsTo('POST /api/projects/project-1/expenses')).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('shows expenses read-only to a member', async () => {
    const { server } = await setup(PLAIN_MEMBER);
    server.on('GET /api/projects/project-1/expenses', () => ({ expenses: [expense()] }));

    fireEvent.click(screen.getByRole('button', { name: 'Website' }));
    expect(await screen.findByText('Licences · Design tool seats')).toBeTruthy();
    expect(screen.getByText('Read-only')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add expense' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Edit expense/ })).toBeNull();
  });

  it('navigates to Rates and Reports from the detail', async () => {
    const { onNavigate } = await setup();

    fireEvent.click(screen.getByRole('button', { name: 'Website' }));
    await screen.findByText('Recent time entries');
    fireEvent.click(screen.getByRole('button', { name: 'Rates' }));
    fireEvent.click(screen.getByRole('button', { name: 'View all' }));

    expect(onNavigate).toHaveBeenNthCalledWith(1, 'rates');
    expect(onNavigate).toHaveBeenNthCalledWith(2, 'reports');
  });
});

async function renderReadyOffline() {
  // Cached data and a session, but the server cannot be reached.
  seedSession({ cache: {} });
  const mounted = mountApp(<Projects onNavigate={vi.fn()} />);
  await waitFor(() => expect(mounted.app().online).toBe(false));
  return mounted;
}
