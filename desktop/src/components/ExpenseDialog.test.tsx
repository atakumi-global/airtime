import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ADMIN, PROJECTS, WORK_ITEMS, expense } from '../test/fixtures';
import { field, renderReady } from '../test/harness';
import { FakeServer, reject } from '../test/server';
import { ExpenseDialog } from './ExpenseDialog';
import type { Expense } from '../lib/types';

const PROJECT = PROJECTS[0]!;

async function setup(existing: Expense | null = null) {
  const server = new FakeServer();
  server.on('POST /api/projects/project-1/expenses', () => ({ expense: expense() }));
  server.on('PATCH /api/expenses/expense-1', () => ({ expense: expense() }));
  server.on('DELETE /api/expenses/expense-1', () => ({ ok: true }));
  server.on('GET /api/expenses/expense-1/history', () => ({
    history: [
      {
        id: 'h1',
        actor_member_id: ADMIN.id,
        action: 'expense.created',
        before_state: null,
        after_state: { amount: '100.00' },
        created_at: '2026-09-03T08:00:00.000Z',
      },
      {
        id: 'h2',
        actor_member_id: ADMIN.id,
        action: 'expense.updated',
        before_state: { amount: '100.00', note: 'Seats' },
        after_state: { amount: '120.00', note: 'Seats' },
        created_at: '2026-09-03T09:00:00.000Z',
      },
    ],
  }));
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const mounted = await renderReady(
    <ExpenseDialog
      project={PROJECT}
      expense={existing}
      workItems={WORK_ITEMS}
      defaultCurrency="EUR"
      onClose={onClose}
      onSaved={onSaved}
    />,
  );
  return { server, onClose, onSaved, ...mounted };
}

describe('ExpenseDialog', () => {
  it('adds an expense with date, amount, currency, category, note and work item', async () => {
    const { server, onSaved } = await setup();
    fireEvent.change(field('Date'), { target: { value: '2026-09-03' } });
    fireEvent.change(field('Amount'), { target: { value: '49.5' } });
    fireEvent.change(field<HTMLSelectElement>('Currency'), { target: { value: 'GBP' } });
    fireEvent.change(field<HTMLSelectElement>('Category'), { target: { value: 'travel' } });
    fireEvent.change(field<HTMLSelectElement>('Work item'), { target: { value: 'plane-wi-1' } });
    fireEvent.change(field('Note'), { target: { value: ' Train ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add expense' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(server.callsTo('POST /api/projects/project-1/expenses')[0]!.body).toEqual({
      date: '2026-09-03',
      amount: 49.5,
      currency: 'GBP',
      category: 'travel',
      note: 'Train',
      workItemId: 'plane-wi-1',
    });
  });

  it('rejects an empty or non-positive amount without calling the server', async () => {
    const { server, onSaved } = await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Add expense' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/amount greater than zero/);
    fireEvent.change(field('Amount'), { target: { value: '-3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add expense' }));
    expect(server.callsTo('POST /api/projects/project-1/expenses')).toHaveLength(0);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('shows the server message when saving fails', async () => {
    const { server, onSaved } = await setup();
    server.on('POST /api/projects/project-1/expenses', () => reject(422, 'fx_rate_unavailable'));
    fireEvent.change(field('Amount'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add expense' }));
    expect((await screen.findByRole('alert')).textContent).toBe('fx_rate_unavailable');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('edits an expense, showing the saved rate and date', async () => {
    const { server, onSaved } = await setup(
      expense({
        currency: 'GBP',
        amount: '100.00',
        amount_reporting: '115.0000',
        fx_rate: '1.15000000',
        fx_date: '2026-09-03',
      }),
    );
    expect(screen.getByTestId('expense-fx').textContent).toContain('rate 1.15 on 3 Sep');
    fireEvent.change(field('Amount'), { target: { value: '130' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(server.callsTo('PATCH /api/expenses/expense-1')[0]!.body).toMatchObject({
      amount: 130,
      currency: 'GBP',
    });
  });

  it('deletes after a confirmation', async () => {
    const { server, onSaved } = await setup(expense());
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(server.callsTo('DELETE /api/expenses/expense-1')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Delete expense' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(server.callsTo('DELETE /api/expenses/expense-1')).toHaveLength(1);
  });

  it('shows the history with before and after values', async () => {
    await setup(expense());
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    expect(await screen.findByText('Expense created')).toBeTruthy();
    expect(screen.getByText('Expense updated')).toBeTruthy();
    expect(screen.getByText('Amount: 100.00 → 120.00')).toBeTruthy();
  });
});
