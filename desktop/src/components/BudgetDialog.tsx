import { useEffect, useState } from 'react';
import { useApp } from '../state/AppContext';
import { Field } from './ui';
import { currencyOptions } from '../lib/currency';
import type { Project } from '../lib/types';

export function BudgetDialog({
  project,
  defaultCurrency,
  onClose,
}: {
  project: Project;
  defaultCurrency: string;
  onClose: () => void;
}) {
  const { getBudget, setBudget, removeBudget } = useApp();
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(
    project.summary?.budget?.currency ?? defaultCurrency,
  );
  const [existing, setExisting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getBudget(project.id)
      .then((budget) => {
        if (cancelled || !budget) {
          return;
        }
        setAmount(String(Number(budget.amount)));
        setCurrency(budget.currency);
        setExisting(true);
      })
      .catch(() => {
        // treat a missing budget as none
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [getBudget, project.id]);

  const save = async () => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 0) {
      setError('Enter a budget amount of zero or more.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await setBudget(project.id, { amount: value, currency });
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save budget');
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    setError(null);
    try {
      await removeBudget(project.id);
      onClose();
    } catch (removeError) {
      setError(
        removeError instanceof Error ? removeError.message : 'Could not remove budget',
      );
      setSaving(false);
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Budget for ${project.name}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="section-title">
          <div>
            <h2>Project budget</h2>
            <span className="muted small">{project.name}</span>
          </div>
          <button type="button" className="btn btn-sm" onClick={onClose}>
            Close
          </button>
        </div>

        {loading ? (
          <p className="muted small">Loading budget…</p>
        ) : (
          <>
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

            <p className="muted small">
              Time is costed at the most specific rate: member, then project, then
              client. Amounts in other currencies convert at the daily FX rate.
            </p>

            {error ? (
              <div className="banner banner-error" role="alert">
                {error}
              </div>
            ) : null}

            <div className="row-between">
              {existing ? (
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => void remove()}
                  disabled={saving}
                >
                  Remove budget
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
                  {saving ? 'Saving…' : 'Save budget'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
