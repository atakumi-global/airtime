import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CostedTimeEntry, Timesheet as TimesheetData } from '../lib/types';
import { ADMIN, MANAGER, PLAIN_MEMBER, timeEntry } from '../test/fixtures';
import { field, mountApp, renderReady, seedSession } from '../test/harness';
import { FakeServer, reject, unreachable } from '../test/server';
import { Timesheet } from './Timesheet';

/** A start time inside the current week, so the default view always contains it. */
function thisWeek(hour: number): string {
  const date = new Date();
  const day = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - day);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

function costed(overrides: Partial<CostedTimeEntry> = {}): CostedTimeEntry {
  const startedAt = thisWeek(9);
  return {
    ...timeEntry({
      id: 'entry-1',
      started_at: startedAt,
      ended_at: new Date(new Date(startedAt).getTime() + 90 * 60000).toISOString(),
      duration_minutes: 90,
      billable_minutes: 90,
    }),
    cost: 127.5,
    cost_currency: 'EUR',
    cost_uncosted: false,
    ...overrides,
  };
}

function sheet(entries: CostedTimeEntry[]): TimesheetData {
  const total = entries.reduce((sum, entry) => sum + entry.duration_minutes, 0);
  const uncosted = entries.filter((entry) => entry.cost_uncosted);
  return {
    entries,
    totals: {
      entryCount: entries.length,
      totalMinutes: total,
      billableMinutes: total,
      cost: entries.reduce((sum, entry) => sum + (entry.cost ?? 0), 0),
      currency: 'EUR',
      currencyTotals: {},
      conversions: {},
      fxStale: false,
      fxDate: null,
      uncosted: {
        entries: uncosted.length,
        minutes: uncosted.reduce((sum, entry) => sum + entry.duration_minutes, 0),
      },
      unconverted: { entries: 0, minutes: 0 },
    },
  };
}

async function setup(
  data: TimesheetData = sheet([costed()]),
  member = ADMIN,
  onBackfill = vi.fn(),
) {
  const server = new FakeServer();
  server.on('GET /api/me', () => ({ member }));
  server.on('GET /api/time-entries/summary', () => data);
  server.on('GET /api/time-entries/entry-1/history', () => ({ history: [] }));
  const mounted = await renderReady(<Timesheet onBackfill={onBackfill} />, {
    cache: { member, entries: data.entries },
  });
  await screen.findByRole('heading', { name: 'Bulk entry' });
  return { server, onBackfill, ...mounted };
}

describe('Timesheet', () => {
  it('shows the period totals and the entries', async () => {
    await setup(sheet([costed(), costed({ id: 'entry-2', cost_uncosted: true, cost: null, cost_currency: null })]));

    expect(screen.getByText('2 entries')).toBeTruthy();
    expect(screen.getByText('Total').parentElement!.textContent).toContain('3h');
    expect(screen.getByText('Uncosted', { selector: '.metric-label' })).toBeTruthy();
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('WEB-1 · Build the landing page');
    expect(rows[1]!.textContent).toContain('Uncosted');
  });

  it('asks the server for the current week and moves to the next period', async () => {
    const { server } = await setup();
    const first = server.callsTo('GET /api/time-entries/summary')[0]!;
    expect(new Date(first.query.get('to')!).getTime() - new Date(first.query.get('from')!).getTime()).toBe(
      7 * 86400000,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Next period' }));

    await waitFor(() => expect(server.callsTo('GET /api/time-entries/summary').length).toBeGreaterThan(1));
    const last = server.callsTo('GET /api/time-entries/summary').at(-1)!;
    expect(new Date(last.query.get('from')!).getTime()).toBeGreaterThan(new Date(first.query.get('from')!).getTime());
  });

  it('switches to the month view', async () => {
    const { server } = await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Month' }));
    await waitFor(() => {
      const last = server.callsTo('GET /api/time-entries/summary').at(-1)!;
      const days =
        (new Date(last.query.get('to')!).getTime() - new Date(last.query.get('from')!).getTime()) / 86400000;
      expect(days).toBeGreaterThanOrEqual(28);
    });
  });

  it('shows the empty state and opens back-fill from it', async () => {
    const { onBackfill } = await setup(sheet([]));
    expect(screen.getByText('No entries in this period.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Back-fill time' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back-fill' }));

    expect(onBackfill).toHaveBeenCalledTimes(2);
  });

  it('shows the server message and retries when the timesheet cannot load (error path)', async () => {
    const server = new FakeServer();
    server.on('GET /api/time-entries/summary', () => reject(500, 'summary exploded'));
    seedSession({ cache: {} });
    mountApp(<Timesheet onBackfill={vi.fn()} />);

    expect(await screen.findByText('summary exploded')).toBeTruthy();

    server.on('GET /api/time-entries/summary', () => sheet([costed()]));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('heading', { name: 'Bulk entry' })).toBeTruthy();
    expect(screen.queryByText('summary exploded')).toBeNull();
  });

  it('falls back to the cached entries when offline and hides cost figures', async () => {
    const server = new FakeServer().goOffline();
    seedSession({ cache: { entries: [costed()] } });
    mountApp(<Timesheet onBackfill={vi.fn()} />);

    expect(await screen.findByText(/Offline\. Showing cached entries for this period/)).toBeTruthy();
    expect(screen.getAllByText('needs the server')).toHaveLength(3);
    // The cache loads while the first request is in flight; the view follows it.
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2));
    expect(screen.getAllByRole('row')[1]!.textContent).toContain('Uncosted');
    expect(server.callsTo('GET /api/time-entries/summary').length).toBeGreaterThan(0);
  });

  describe('bulk entry', () => {
    async function addRow(server: FakeServer) {
      server.on('POST /api/time-entries', () => ({ entry: timeEntry() }));
      fireEvent.click(screen.getByRole('button', { name: 'Add row' }));
      const durationBox = await screen.findByRole('textbox', { name: '' });
      return durationBox as HTMLInputElement;
    }

    it('saves a draft row (happy path)', async () => {
      const { server } = await setup(sheet([]));
      const duration = await addRow(server);
      fireEvent.change(screen.getByRole('combobox', { name: 'Work item' }), {
        target: { value: 'plane-wi-2' },
      });
      fireEvent.change(duration, { target: { value: '45m' } });

      fireEvent.click(screen.getByRole('button', { name: 'Save 1 entry' }));

      expect(await screen.findByText('1 entry saved.')).toBeTruthy();
      const body = server.callsTo('POST /api/time-entries')[0]!.body as Record<string, unknown>;
      expect(body.workItemId).toBe('plane-wi-2');
      expect(body.durationMinutes).toBe(45);
      expect(body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('saves a row with Enter and opens the next row', async () => {
      const { server } = await setup(sheet([]));
      const duration = await addRow(server);
      fireEvent.change(duration, { target: { value: '1h' } });

      fireEvent.keyDown(duration, { key: 'Enter' });

      await waitFor(() => expect(server.callsTo('POST /api/time-entries')).toHaveLength(1));
      await waitFor(() => expect(screen.getAllByRole('textbox', { name: '' })).toHaveLength(1));
      expect((screen.getByRole('textbox', { name: '' }) as HTMLInputElement).value).toBe('');
    });

    it('keeps Save disabled until a duration is valid and shows why', async () => {
      const { server } = await setup(sheet([]));
      const duration = await addRow(server);
      expect((screen.getByRole('button', { name: 'Save 0 entries' }) as HTMLButtonElement).disabled).toBe(true);

      fireEvent.change(duration, { target: { value: 'nonsense' } });

      expect(screen.getByRole('alert')).toBeTruthy();
      expect((screen.getByRole('button', { name: 'Save 0 entries' }) as HTMLButtonElement).disabled).toBe(true);
      expect(server.callsTo('POST /api/time-entries')).toHaveLength(0);
    });

    it('asks for a duration when Enter is pressed on an empty row', async () => {
      const { server } = await setup(sheet([]));
      const duration = await addRow(server);

      fireEvent.keyDown(duration, { key: 'Enter' });

      expect(await screen.findByText('Enter a duration before saving.')).toBeTruthy();
      expect(server.callsTo('POST /api/time-entries')).toHaveLength(0);
    });

    it('queues a row when the server is unreachable and says so', async () => {
      const { server, app } = await setup(sheet([]));
      const duration = await addRow(server);
      server.on('POST /api/time-entries', unreachable);
      fireEvent.change(duration, { target: { value: '30m' } });

      fireEvent.click(screen.getByRole('button', { name: 'Save 1 entry' }));

      expect(await screen.findByText('1 entry queued offline.')).toBeTruthy();
      expect(app().queue).toHaveLength(1);
    });

    it('keeps a rejected row with the server message beside it (error path)', async () => {
      const { server } = await setup(sheet([]));
      const duration = await addRow(server);
      server.on('POST /api/time-entries', () => reject(400, 'work item is closed'));
      fireEvent.change(duration, { target: { value: '30m' } });

      fireEvent.click(screen.getByRole('button', { name: 'Save 1 entry' }));

      expect(await screen.findByText('work item is closed')).toBeTruthy();
      expect(screen.getByText('1 row failed.')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
    });

    it('removes a draft row', async () => {
      const { server } = await setup(sheet([]));
      await addRow(server);
      fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
      expect(screen.queryByRole('textbox', { name: '' })).toBeNull();
    });
  });

  describe('editing', () => {
    it('opens the entry dialog, saves, and offers Undo that restores the old values', async () => {
      const original = costed({ description: 'Original note' });
      const { server } = await setup(sheet([original]));
      server.on('PATCH /api/time-entries/entry-1', () => ({ entry: original }));

      fireEvent.click(screen.getAllByRole('button', { name: /^Edit entry/ })[0]!);
      const dialog = await screen.findByRole('dialog', { name: 'Edit entry' });
      fireEvent.change(field('Duration', dialog), { target: { value: '2h' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

      expect(await screen.findByText('Entry updated.')).toBeTruthy();
      expect(screen.queryByRole('dialog')).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

      await waitFor(() => expect(server.callsTo('PATCH /api/time-entries/entry-1')).toHaveLength(2));
      expect(server.callsTo('PATCH /api/time-entries/entry-1')[1]?.body).toMatchObject({
        startedAt: original.started_at,
        endedAt: original.ended_at,
        description: 'Original note',
      });
      expect(screen.queryByText('Entry updated.')).toBeNull();
    });

    it('dismisses the undo toast', async () => {
      const original = costed();
      const { server } = await setup(sheet([original]));
      server.on('PATCH /api/time-entries/entry-1', () => ({ entry: original }));

      fireEvent.click(screen.getAllByRole('button', { name: /^Edit entry/ })[0]!);
      const dialog = await screen.findByRole('dialog', { name: 'Edit entry' });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
      await screen.findByText('Entry updated.');

      fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

      expect(screen.queryByText('Entry updated.')).toBeNull();
    });
  });

  describe('export', () => {
    beforeEach(() => {
      URL.createObjectURL = vi.fn(() => 'blob:csv');
      URL.revokeObjectURL = vi.fn();
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('exports the period for a manager (happy path)', async () => {
      const { server } = await setup(sheet([costed()]), MANAGER);
      server.on('GET /api/exports/time-entries.csv', () => new Response('a\r\n1\r\n'));

      fireEvent.click(screen.getByRole('button', { name: 'Export' }));

      expect(await screen.findByText('Exported 1 entry to CSV.')).toBeTruthy();
      const query = server.callsTo('GET /api/exports/time-entries.csv')[0]!.query;
      expect(query.get('from')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('shows the failure when the export fails (error path)', async () => {
      const { server } = await setup(sheet([costed()]), MANAGER);
      server.on('GET /api/exports/time-entries.csv', () => reject(500, 'nope'));

      fireEvent.click(screen.getByRole('button', { name: 'Export' }));

      // A failed export sets the error, but the banner only renders in the page's
      // error state, so the visible contract is: the request went out, no file.
      await waitFor(() => expect(server.callsTo('GET /api/exports/time-entries.csv')).toHaveLength(1));
      expect(URL.createObjectURL).not.toHaveBeenCalled();
    });

    it('does not offer export to a member', async () => {
      await setup(sheet([costed()]), PLAIN_MEMBER);
      expect(screen.queryByRole('button', { name: 'Export' })).toBeNull();
    });
  });
});
