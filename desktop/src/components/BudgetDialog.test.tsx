import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PROJECTS } from '../test/fixtures';
import { field, renderReady } from '../test/harness';
import { FakeServer, reject } from '../test/server';
import { BudgetDialog } from './BudgetDialog';

const PROJECT = PROJECTS[1]!;

const EXISTING = {
  id: 'budget-1',
  project_id: PROJECT.id,
  amount: '1500.00',
  currency: 'USD',
  price: '3000.00',
  profit_target_percent: '40.0',
  margin_target_amount: '800.00',
};

async function setup(budget: unknown = null) {
  const server = new FakeServer();
  server.on(`GET /api/projects/${PROJECT.id}/budget`, () => ({ budget }));
  const onClose = vi.fn();
  const mounted = await renderReady(
    <BudgetDialog project={PROJECT} defaultCurrency="EUR" onClose={onClose} />,
  );
  await waitFor(() => expect(screen.queryByText('Loading budget…')).toBeNull());
  return { server, onClose, ...mounted };
}

describe('BudgetDialog', () => {
  it('opens empty for a project without a budget and hides Remove', async () => {
    await setup(null);
    expect(field('Budget amount').value).toBe('');
    expect(field<HTMLSelectElement>('Currency').value).toBe('EUR');
    expect(screen.queryByRole('button', { name: 'Remove budget' })).toBeNull();
  });

  it('loads an existing budget into the form', async () => {
    await setup(EXISTING);
    expect(field('Budget amount').value).toBe('1500');
    expect(field<HTMLSelectElement>('Currency').value).toBe('USD');
    expect(field('Price to client').value).toBe('3000');
    expect(field('Profit target %').value).toBe('40');
    expect(field('Margin target (amount)').value).toBe('800');
    expect(screen.getByRole('button', { name: 'Remove budget' })).toBeTruthy();
  });

  it('saves the budget with all targets and closes (happy path)', async () => {
    const { server, onClose } = await setup(null);
    server.on(`PUT /api/projects/${PROJECT.id}/budget`, () => ({ budget: EXISTING }));

    fireEvent.change(field('Budget amount'), { target: { value: '1200.5' } });
    fireEvent.change(field<HTMLSelectElement>('Currency'), { target: { value: 'GBP' } });
    fireEvent.change(field('Price to client'), { target: { value: '2500' } });
    fireEvent.change(field('Profit target %'), { target: { value: '35' } });
    fireEvent.change(field('Margin target (amount)'), { target: { value: '600' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save budget' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(server.callsTo(`PUT /api/projects/${PROJECT.id}/budget`)[0]?.body).toEqual({
      amount: 1200.5,
      currency: 'GBP',
      price: 2500,
      profitTargetPercent: 35,
      marginTargetAmount: 600,
    });
  });

  it('sends blank optional fields as null', async () => {
    const { server, onClose } = await setup(null);
    server.on(`PUT /api/projects/${PROJECT.id}/budget`, () => ({ budget: EXISTING }));

    fireEvent.change(field('Budget amount'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save budget' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(server.callsTo(`PUT /api/projects/${PROJECT.id}/budget`)[0]?.body).toEqual({
      amount: 100,
      currency: 'EUR',
      price: null,
      profitTargetPercent: null,
      marginTargetAmount: null,
    });
  });

  it.each([
    ['budget amount', { 'Budget amount': '-5' }, 'Enter a budget amount of zero or more.'],
    [
      'price',
      { 'Budget amount': '10', 'Price to client': '-1' },
      'Enter a price to the client of zero or more, or leave it blank.',
    ],
    [
      'profit target',
      { 'Budget amount': '10', 'Profit target %': '120' },
      'Profit target is a percentage from 0 to 100, or blank.',
    ],
    [
      'margin target',
      { 'Budget amount': '10', 'Margin target (amount)': '-2' },
      'Enter a margin target of zero or more, or leave it blank.',
    ],
  ])('rejects an invalid %s without calling the server', async (_name, values, message) => {
    const { server, onClose } = await setup(null);

    for (const [label, value] of Object.entries(values)) {
      fireEvent.change(field(label), { target: { value } });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Save budget' }));

    expect((await screen.findByRole('alert')).textContent).toBe(message);
    expect(server.callsTo(`PUT /api/projects/${PROJECT.id}/budget`)).toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows the server message and stays open when the save fails (error path)', async () => {
    const { server, onClose } = await setup(null);
    server.on(`PUT /api/projects/${PROJECT.id}/budget`, () => reject(403, 'managers only'));

    fireEvent.change(field('Budget amount'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save budget' }));

    expect((await screen.findByRole('alert')).textContent).toBe('managers only');
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Save budget' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('removes an existing budget and closes (happy path)', async () => {
    const { server, onClose } = await setup(EXISTING);
    server.on(`DELETE /api/projects/${PROJECT.id}/budget`, () => undefined);

    fireEvent.click(screen.getByRole('button', { name: 'Remove budget' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(server.callsTo(`DELETE /api/projects/${PROJECT.id}/budget`)).toHaveLength(1);
  });

  it('shows the server message when removing fails (error path)', async () => {
    const { server, onClose } = await setup(EXISTING);
    server.on(`DELETE /api/projects/${PROJECT.id}/budget`, () => reject(500, 'could not delete'));

    fireEvent.click(screen.getByRole('button', { name: 'Remove budget' }));

    expect((await screen.findByRole('alert')).textContent).toBe('could not delete');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('treats a failed budget lookup as no budget', async () => {
    const server = new FakeServer();
    server.on(`GET /api/projects/${PROJECT.id}/budget`, () => reject(500, 'boom'));
    await renderReady(<BudgetDialog project={PROJECT} defaultCurrency="EUR" onClose={vi.fn()} />);

    await waitFor(() => expect(screen.queryByText('Loading budget…')).toBeNull());
    expect(field('Budget amount').value).toBe('');
    expect(screen.queryByRole('button', { name: 'Remove budget' })).toBeNull();
  });
});
