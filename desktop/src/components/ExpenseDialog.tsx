import { useEffect, useState } from 'react';
import { useApp } from '../state/AppContext';
import { Badge, Field } from './ui';
import { currencyOptions } from '../lib/currency';
import { EXPENSE_CATEGORIES } from '../lib/expenses';
import { formatDateOnly, formatMoney } from '../lib/format';
import type {
  Expense,
  ExpenseCategory,
  ExpenseHistoryEvent,
  Project,
  WorkItem,
} from '../lib/types';

const ACTION_LABEL: Record<string, string> = {
  'expense.created': 'Expense created',
  'expense.updated': 'Expense updated',
  'expense.deleted': 'Expense deleted',
};

function todayValue(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function changeSummary(event: ExpenseHistoryEvent): string {
  const before = event.before_state;
  const after = event.after_state;
  if (!before || !after) {
    return '';
  }
  const parts: string[] = [];
  const pairs: Array<[string, string]> = [
    ['amount', 'Amount'],
    ['currency', 'Currency'],
    ['category', 'Category'],
    ['note', 'Note'],
    ['expense_date', 'Date'],
  ];
  for (const [key, label] of pairs) {
    if (String(before[key] ?? '') !== String(after[key] ?? '')) {
      parts.push(`${label}: ${String(before[key] ?? '—')} → ${String(after[key] ?? '—')}`);
    }
  }
  return parts.join(' · ');
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ExpenseDialog({
  project,
  expense,
  workItems,
  defaultCurrency,
  onClose,
  onSaved,
}: {
  project: Project;
  expense: Expense | null;
  workItems: WorkItem[];
  defaultCurrency: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { member, addExpense, editExpense, removeExpense, expenseHistory } = useApp();
  const [date, setDate] = useState(expense ? expense.expense_date.slice(0, 10) : todayValue());
  const [amount, setAmount] = useState(expense ? String(Number(expense.amount)) : '');
  const [currency, setCurrency] = useState(expense?.currency ?? defaultCurrency);
  const [category, setCategory] = useState<ExpenseCategory>(expense?.category ?? 'licences');
  const [note, setNote] = useState(expense?.note ?? '');
  const [workItemId, setWorkItemId] = useState(expense?.work_item_id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<ExpenseHistoryEvent[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const expenseId = expense?.id ?? null;
  useEffect(() => {
    if (!expenseId) {
      return;
    }
    let cancelled = false;
    expenseHistory(expenseId)
      .then((events) => {
        if (!cancelled) {
          setHistory(events);
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setHistoryError(
            loadError instanceof Error ? loadError.message : 'Could not load history',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [expenseId, expenseHistory]);

  const projectItems = workItems.filter((item) => item.project_id === project.id);

  const save = async () => {
    const value = Number(amount);
    if (amount.trim() === '' || !Number.isFinite(value) || value <= 0) {
      setError('Enter an amount greater than zero.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError('Enter the date of the expense.');
      return;
    }
    setSaving(true);
    setError(null);
    const payload = {
      date,
      amount: value,
      currency,
      category,
      note: note.trim() === '' ? null : note.trim(),
      workItemId: workItemId === '' ? null : workItemId,
    };
    try {
      if (expense) {
        await editExpense(expense.id, payload);
      } else {
        await addExpense(project.id, payload);
      }
      onSaved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save expense');
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!expense) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await removeExpense(expense.id);
      onSaved();
    } catch (removeError) {
      setError(
        removeError instanceof Error ? removeError.message : 'Could not delete expense',
      );
      setSaving(false);
      setConfirmDelete(false);
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={expense ? 'Edit expense' : 'Add expense'}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="section-title">
          <div>
            <h2>{expense ? 'Edit expense' : 'Add expense'}</h2>
            <span className="muted small">{project.name}</span>
          </div>
          <button type="button" className="btn btn-sm" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <Field label="Date">
              <input
                className="input"
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </Field>
          </div>
          <div style={{ flex: 1 }}>
            <Field label="Category">
              <select
                className="select"
                value={category}
                onChange={(event) => setCategory(event.target.value as ExpenseCategory)}
              >
                {EXPENSE_CATEGORIES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </div>

        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div style={{ flex: 2 }}>
            <Field label="Amount">
              <input
                className="input"
                type="number"
                min={0}
                step="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0.00"
              />
            </Field>
          </div>
          <div style={{ flex: 1 }}>
            <Field label="Currency">
              <select
                className="select"
                value={currency}
                onChange={(event) => setCurrency(event.target.value)}
              >
                {currencyOptions(currency).map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </div>

        <Field label="Work item" hint="Optional. The expense stays on the project.">
          <select
            className="select"
            value={workItemId}
            onChange={(event) => setWorkItemId(event.target.value)}
          >
            <option value="">No work item</option>
            {projectItems.map((item) => (
              <option key={item.plane_work_item_id} value={item.plane_work_item_id}>
                {`${item.identifier ?? ''} ${item.name}`.trim()}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Note">
          <input
            className="input"
            value={note}
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
            placeholder="What was it for?"
          />
        </Field>

        <p className="muted small">
          The expense counts toward Cost, Margin and Profit straight away. Amounts in
          another currency convert at the latest daily rate, which is saved with the
          expense together with its date.
        </p>

        {expense && expense.amount_reporting !== null && expense.currency !== expense.reporting_currency ? (
          <p className="small" data-testid="expense-fx">
            Saved as {formatMoney(Number(expense.amount_reporting), expense.reporting_currency ?? '')} at
            rate {Number(expense.fx_rate)} on {expense.fx_date ? formatDateOnly(expense.fx_date) : 'an unknown date'}.
          </p>
        ) : null}

        {error ? (
          <div className="banner banner-error" role="alert">
            {error}
          </div>
        ) : null}

        <div className="row-between">
          {expense ? (
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => setConfirmDelete(true)}
              disabled={saving}
            >
              Delete
            </button>
          ) : (
            <span />
          )}
          <div className="row">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void save()}
              disabled={saving}
            >
              {saving ? 'Saving…' : expense ? 'Save changes' : 'Add expense'}
            </button>
          </div>
        </div>

        {expense ? (
          <>
            <div className="row-between">
              <button
                type="button"
                className="btn btn-sm"
                aria-expanded={showHistory}
                onClick={() => setShowHistory((value) => !value)}
              >
                {showHistory ? 'Hide history' : 'History'}
              </button>
            </div>
            {showHistory ? (
              <div className="history">
                {historyError ? (
                  <p className="muted small">{historyError}</p>
                ) : history.length === 0 ? (
                  <p className="muted small">No changes recorded yet.</p>
                ) : (
                  history.map((event) => (
                    <div className="history-item" key={event.id}>
                      <Badge
                        tone={
                          event.action === 'expense.deleted'
                            ? 'danger'
                            : event.action === 'expense.created'
                              ? 'brand'
                              : 'neutral'
                        }
                      >
                        {ACTION_LABEL[event.action] ?? event.action}
                      </Badge>
                      <span className="small">
                        {event.actor_member_id === member?.id
                          ? 'You'
                          : event.actor_member_id
                            ? `Member ${event.actor_member_id.slice(0, 8)}`
                            : 'Removed member'}
                      </span>
                      <span className="muted small">{formatTimestamp(event.created_at)}</span>
                      <span className="muted small">{changeSummary(event)}</span>
                    </div>
                  ))
                )}
                <p className="muted small">
                  Before and after values, author and timestamp are retained.
                </p>
              </div>
            ) : null}
          </>
        ) : null}

        {confirmDelete ? (
          <div className="dialog-backdrop" role="presentation">
            <div
              className="dialog"
              role="alertdialog"
              aria-modal="true"
              aria-label="Delete expense"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="section-title">
                <h2>Delete this expense?</h2>
              </div>
              <p className="small muted">
                The expense leaves the project cost and is recorded in the history with
                your name and the time.
              </p>
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setConfirmDelete(false)}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => void remove()}
                  disabled={saving}
                >
                  {saving ? 'Deleting…' : 'Delete expense'}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
