import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Rate } from '../lib/types';
import { ADMIN, MANAGER, PLAIN_MEMBER } from '../test/fixtures';
import { field, renderReady } from '../test/harness';
import { FakeServer, reject } from '../test/server';
import { Rates } from './Rates';

const RATES: Rate[] = [
  {
    id: 'rate-1',
    scope: 'project',
    member_id: null,
    project_id: 'project-1',
    from_date: '2026-01-01',
    currency: 'EUR',
    hourly_amount: '85.00',
  },
  {
    id: 'rate-2',
    scope: 'member',
    member_id: MANAGER.id,
    project_id: null,
    from_date: '2026-01-01',
    currency: 'USD',
    hourly_amount: '120.00',
  },
  {
    id: 'rate-3',
    scope: 'project_member',
    member_id: PLAIN_MEMBER.id,
    project_id: 'project-1',
    from_date: '2026-07-01',
    currency: 'NZD',
    hourly_amount: '95.00',
  },
  {
    id: 'rate-4',
    scope: 'project',
    member_id: null,
    project_id: 'project-1',
    from_date: '2026-06-01',
    currency: 'EUR',
    hourly_amount: '90.00',
  },
];

async function setup(member = ADMIN, rates: Rate[] = RATES) {
  const server = new FakeServer();
  server.on('GET /api/me', () => ({ member }));
  server.on('GET /api/rates', () => ({ rates }));
  server.on('GET /api/members', () => ({ members: [ADMIN, MANAGER, PLAIN_MEMBER] }));
  const mounted = await renderReady(<Rates />, { cache: { member } });
  await waitFor(() => expect(screen.queryByText('Loading rates…')).toBeNull());
  return { server, ...mounted };
}

describe('Rates', () => {
  it('lists the rates with the project and member names', async () => {
    await setup();
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(4);
    expect(within(rows[1]!).getByText('Mia Manager')).toBeTruthy();
    expect(rows[1]!.textContent).toMatch(/120 \/ hour/);
    expect(rows[1]!.textContent).toContain('2026-01-01');
  });

  it('orders by target, then newest from-date first, and can order by date alone', async () => {
    await setup();
    const targets = () =>
      screen
        .getAllByRole('row')
        .slice(1)
        .map((row) => (row as HTMLElement).textContent ?? '');
    const initial = targets();
    const websiteRows = initial.filter((text) => text.startsWith('ProjectWebsite'));
    expect(websiteRows).toHaveLength(2);
    expect(websiteRows[0]).toContain('2026-06-01');
    expect(websiteRows[1]).toContain('2026-01-01');

    fireEvent.change(field<HTMLSelectElement>('Order by'), { target: { value: 'date' } });
    const byDate = targets().map((text) => /\d{4}-\d{2}-\d{2}/.exec(text)?.[0]);
    expect(byDate).toEqual([...byDate].sort().reverse());
  });

  it('shows scope, target, from date, amount and currency columns', async () => {
    await setup();
    const headers = screen.getAllByRole('columnheader').map((header) => header.textContent);
    expect(headers).toEqual(
      expect.arrayContaining(['Scope', 'Applies to', 'From date', 'Rate', 'Currency']),
    );
    const projectMember = screen.getAllByRole('row')[1] as HTMLElement;
    expect(projectMember.textContent).toContain('Max Member on Website');
  });

  it('says so when no rates exist', async () => {
    await setup(ADMIN, []);
    expect(screen.getByText('No rates yet.')).toBeTruthy();
    expect(screen.getByText('Time is costed at the default rate of 200 NZD.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save rate' })).toBeTruthy();
  });

  it('offers no client scope and states the new precedence', async () => {
    await setup();
    const options = Array.from(
      field<HTMLSelectElement>('Applies to').querySelectorAll('option'),
    ).map((option) => option.textContent);
    expect(options).toEqual(['Member', 'Project', 'Project + member']);
    expect(screen.queryByText('Client id')).toBeNull();
    expect(
      screen.getByText(
        'Rates resolve project + member, then project, then member, then the default rate.',
      ),
    ).toBeTruthy();
  });

  it('shows a member a notice and no controls', async () => {
    await setup(PLAIN_MEMBER);
    expect(screen.getByText('Only managers and administrators can change rates.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save rate' })).toBeNull();
    expect(screen.queryAllByRole('button', { name: /^Remove/ })).toHaveLength(0);
  });

  it('saves a project rate and reloads the list (happy path)', async () => {
    const { server } = await setup();
    server.on('PUT /api/rates', () => ({ rate: RATES[0] }));

    fireEvent.change(field<HTMLSelectElement>('Project'), { target: { value: 'project-2' } });
    fireEvent.change(field('From date'), { target: { value: '2026-08-01' } });
    fireEvent.change(field('Hourly rate'), { target: { value: '95' } });
    fireEvent.change(field<HTMLSelectElement>('Currency'), { target: { value: 'GBP' } });
    const loads = server.callsTo('GET /api/rates').length;
    fireEvent.click(screen.getByRole('button', { name: 'Save rate' }));

    await waitFor(() => expect(server.callsTo('PUT /api/rates')).toHaveLength(1));
    expect(server.callsTo('PUT /api/rates')[0]?.body).toEqual({
      scope: 'project',
      memberId: null,
      projectId: 'project-2',
      fromDate: '2026-08-01',
      currency: 'GBP',
      hourlyAmount: 95,
    });
    await waitFor(() => expect(server.callsTo('GET /api/rates').length).toBeGreaterThan(loads));
    expect(field('Hourly rate').value).toBe('');
  });

  it('saves a member rate', async () => {
    const { server } = await setup();
    server.on('PUT /api/rates', () => ({ rate: RATES[1] }));

    fireEvent.change(field<HTMLSelectElement>('Applies to'), { target: { value: 'member' } });
    fireEvent.change(field<HTMLSelectElement>('Member'), { target: { value: PLAIN_MEMBER.id } });
    fireEvent.change(field('Hourly rate'), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save rate' }));

    await waitFor(() => expect(server.callsTo('PUT /api/rates')).toHaveLength(1));
    expect(server.callsTo('PUT /api/rates')[0]?.body).toMatchObject({
      scope: 'member',
      memberId: PLAIN_MEMBER.id,
      projectId: null,
    });
  });

  it('saves a project + member rate with both references', async () => {
    const { server } = await setup();
    server.on('PUT /api/rates', () => ({ rate: RATES[2] }));

    fireEvent.change(field<HTMLSelectElement>('Applies to'), { target: { value: 'project_member' } });
    fireEvent.change(field<HTMLSelectElement>('Member'), { target: { value: PLAIN_MEMBER.id } });
    fireEvent.change(field<HTMLSelectElement>('Project'), { target: { value: 'project-2' } });
    fireEvent.change(field('From date'), { target: { value: '2026-09-01' } });
    fireEvent.change(field('Hourly rate'), { target: { value: '70' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save rate' }));

    await waitFor(() => expect(server.callsTo('PUT /api/rates')).toHaveLength(1));
    expect(server.callsTo('PUT /api/rates')[0]?.body).toMatchObject({
      scope: 'project_member',
      memberId: PLAIN_MEMBER.id,
      projectId: 'project-2',
      fromDate: '2026-09-01',
      hourlyAmount: 70,
    });
  });

  it('needs both the member and the project for a project + member rate', async () => {
    const { server } = await setup();
    fireEvent.change(field<HTMLSelectElement>('Applies to'), { target: { value: 'project_member' } });
    fireEvent.change(field('Hourly rate'), { target: { value: '70' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save rate' }));
    expect(await screen.findByText('Choose the member this rate applies to.')).toBeTruthy();

    fireEvent.change(field<HTMLSelectElement>('Member'), { target: { value: PLAIN_MEMBER.id } });
    fireEvent.click(screen.getByRole('button', { name: 'Save rate' }));
    expect(await screen.findByText('Choose the project this rate applies to.')).toBeTruthy();
    expect(server.callsTo('PUT /api/rates')).toHaveLength(0);
  });

  it('needs a from date', async () => {
    const { server } = await setup();
    fireEvent.change(field<HTMLSelectElement>('Project'), { target: { value: 'project-1' } });
    fireEvent.change(field('From date'), { target: { value: '' } });
    fireEvent.change(field('Hourly rate'), { target: { value: '70' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save rate' }));

    expect(await screen.findByText('Choose the date this rate applies from.')).toBeTruthy();
    expect(server.callsTo('PUT /api/rates')).toHaveLength(0);
  });

  it('asks for the target before saving', async () => {
    const { server } = await setup();

    fireEvent.change(field('Hourly rate'), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save rate' }));

    expect(await screen.findByText('Choose the project this rate applies to.')).toBeTruthy();
    expect(server.callsTo('PUT /api/rates')).toHaveLength(0);
  });

  it('rejects a negative rate without calling the server', async () => {
    const { server } = await setup();

    fireEvent.change(field<HTMLSelectElement>('Project'), { target: { value: 'project-1' } });
    fireEvent.change(field('Hourly rate'), { target: { value: '-3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save rate' }));

    expect(await screen.findByText('Enter an hourly rate of zero or more.')).toBeTruthy();
    expect(server.callsTo('PUT /api/rates')).toHaveLength(0);
  });

  it('shows the server message when saving fails (error path)', async () => {
    const { server } = await setup();
    server.on('PUT /api/rates', () => reject(403, 'not allowed'));

    fireEvent.change(field<HTMLSelectElement>('Project'), { target: { value: 'project-1' } });
    fireEvent.change(field('Hourly rate'), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save rate' }));

    expect(await screen.findByText('not allowed')).toBeTruthy();
  });

  const REMOVE_RATE_1 = /^Remove Project rate for Website from 2026-01-01$/;

  it('asks for confirmation, naming the effect on past costs, then removes (happy path)', async () => {
    const { server } = await setup();
    server.on('DELETE /api/rates/rate-1', () => undefined);

    fireEvent.click(screen.getByRole('button', { name: REMOVE_RATE_1 }));
    expect(server.callsTo('DELETE /api/rates/rate-1')).toHaveLength(0);
    expect(screen.getByText('Removing this rate can change past costs and reports.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^Confirm removing Project rate for Website from 2026-01-01$/ }));

    await waitFor(() => expect(server.callsTo('DELETE /api/rates/rate-1')).toHaveLength(1));
  });

  it('keeps the rate when the removal is not confirmed', async () => {
    const { server } = await setup();

    fireEvent.click(screen.getByRole('button', { name: REMOVE_RATE_1 }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));

    expect(screen.getByRole('button', { name: REMOVE_RATE_1 })).toBeTruthy();
    expect(server.callsTo('DELETE /api/rates/rate-1')).toHaveLength(0);
  });

  it('shows the server message when removing fails (error path)', async () => {
    const { server } = await setup();
    server.on('DELETE /api/rates/rate-1', () => reject(500, 'could not remove rate'));

    fireEvent.click(screen.getByRole('button', { name: REMOVE_RATE_1 }));
    fireEvent.click(screen.getByRole('button', { name: /^Confirm removing/ }));

    expect(await screen.findByText('could not remove rate')).toBeTruthy();
  });

  it('shows the server message when the rates cannot be loaded', async () => {
    const server = new FakeServer();
    server.on('GET /api/rates', () => reject(500, 'rates unavailable'));
    server.on('GET /api/members', () => ({ members: [] }));
    await renderReady(<Rates />);

    expect(await screen.findByText('rates unavailable')).toBeTruthy();
  });
});
