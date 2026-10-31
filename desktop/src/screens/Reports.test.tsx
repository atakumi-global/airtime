import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN, MANAGER, PLAIN_MEMBER } from '../test/fixtures';
import { field, renderReady } from '../test/harness';
import { FakeServer, reject } from '../test/server';
import { Reports } from './Reports';

const CSV = 'date,member\r\n2026-09-02,Ada\r\n2026-09-03,Ada\r\n';

async function setup(member = MANAGER) {
  const server = new FakeServer();
  server.on('GET /api/me', () => ({ member }));
  server.on('GET /api/members', () => ({ members: [ADMIN, MANAGER] }));
  const mounted = await renderReady(<Reports />, { cache: { member } });
  return { server, ...mounted };
}

describe('Reports', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:csv');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exports the CSV with the chosen filters and reports the row count (happy path)', async () => {
    const { server } = await setup();
    server.on('GET /api/exports/time-entries.csv', () => new Response(CSV, { status: 200 }));

    fireEvent.change(field('From'), { target: { value: '2026-09-01' } });
    fireEvent.change(field('To'), { target: { value: '2026-09-07' } });
    fireEvent.change(field<HTMLSelectElement>('Project'), { target: { value: 'project-1' } });
    await waitFor(() => expect(field<HTMLSelectElement>('Member').options.length).toBe(3));
    fireEvent.change(field<HTMLSelectElement>('Member'), { target: { value: ADMIN.id } });
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

    expect(await screen.findByText('Exported 2 entries to CSV.')).toBeTruthy();
    const query = server.callsTo('GET /api/exports/time-entries.csv')[0]!.query;
    expect(Object.fromEntries(query)).toEqual({
      from: '2026-09-01',
      to: '2026-09-07',
      projectId: 'project-1',
      memberId: ADMIN.id,
    });
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
  });

  it('says "1 entry" for a single row and 0 for an empty export', async () => {
    const { server } = await setup();
    server.on('GET /api/exports/time-entries.csv', () => new Response('date\r\n2026-09-02\r\n'));
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(await screen.findByText('Exported 1 entry to CSV.')).toBeTruthy();

    server.on('GET /api/exports/time-entries.csv', () => new Response(''));
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(await screen.findByText('Exported 0 entries to CSV.')).toBeTruthy();
  });

  it('shows an error and downloads nothing when the export fails (error path)', async () => {
    const { server } = await setup();
    server.on('GET /api/exports/time-entries.csv', () => reject(500, 'boom'));

    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

    expect(await screen.findByText('export failed')).toBeTruthy();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('does not let a member export', async () => {
    const { server } = await setup(PLAIN_MEMBER);
    expect(screen.getByText('Only managers and administrators can export time and cost data.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Export CSV' }) as HTMLButtonElement).disabled).toBe(true);
    expect(server.callsTo('GET /api/exports/time-entries.csv')).toHaveLength(0);
  });

  it('still renders when the member list is not available to the caller', async () => {
    const server = new FakeServer();
    server.on('GET /api/me', () => ({ member: MANAGER }));
    server.on('GET /api/members', () => reject(403, 'forbidden'));
    await renderReady(<Reports />, { cache: { member: MANAGER } });

    expect(field<HTMLSelectElement>('Member').options.length).toBe(1);
  });
});
