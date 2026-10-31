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
    client_id: null,
    currency: 'EUR',
    hourly_amount: '85.00',
  },
  {
    id: 'rate-2',
    scope: 'member',
    member_id: MANAGER.id,
    project_id: null,
    client_id: null,
    currency: 'USD',
    hourly_amount: '120.00',
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
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('Website')).toBeTruthy();
    expect(rows[0]!.textContent).toMatch(/85 \/ hour/);
    expect(within(rows[1]!).getByText('Mia Manager')).toBeTruthy();
  });

  it('says so when no rates exist', async () => {
    await setup(ADMIN, []);
    expect(screen.getByText('No rates yet.')).toBeTruthy();
  });

  it('shows a member a notice and no controls', async () => {
    await setup(PLAIN_MEMBER);
    expect(screen.getByText('Only managers and administrators can change rates.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save rate' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });

  it('saves a project rate and reloads the list (happy path)', async () => {
    const { server } = await setup();
    server.on('PUT /api/rates', () => ({ rate: RATES[0] }));

    fireEvent.change(field<HTMLSelectElement>('Project'), { target: { value: 'project-2' } });
    fireEvent.change(field('Hourly rate'), { target: { value: '95' } });
    fireEvent.change(field<HTMLSelectElement>('Currency'), { target: { value: 'GBP' } });
    const loads = server.callsTo('GET /api/rates').length;
    fireEvent.click(screen.getByRole('button', { name: 'Save rate' }));

    await waitFor(() => expect(server.callsTo('PUT /api/rates')).toHaveLength(1));
    expect(server.callsTo('PUT /api/rates')[0]?.body).toEqual({
      scope: 'project',
      memberId: null,
      projectId: 'project-2',
      clientId: null,
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

  it('removes a rate and reloads (happy path)', async () => {
    const { server } = await setup();
    server.on('DELETE /api/rates/rate-1', () => undefined);

    const row = screen.getAllByRole('row')[1] as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(server.callsTo('DELETE /api/rates/rate-1')).toHaveLength(1));
  });

  it('shows the server message when removing fails (error path)', async () => {
    const { server } = await setup();
    server.on('DELETE /api/rates/rate-1', () => reject(500, 'could not remove rate'));

    const row = screen.getAllByRole('row')[1] as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Remove' }));

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
