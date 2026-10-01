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
  const [price, setPrice] = useState('');
  const [profitTarget, setProfitTarget] = useState('');
  const [marginTarget, setMarginTarget] = useState('');
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
        setPrice(budget.price === null ? '' : String(Number(budget.price)));
        setProfitTarget(
          budget.profit_target_percent === null
            ? ''
            : String(Number(budget.profit_target_percent)),
        );
        setMarginTarget(
          budget.margin_target_amount === null
            ? ''
            : String(Number(budget.margin_target_amount)),
        );
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

  const parseOptional = (value: string): number | null | 'invalid' => {
    const trimmed = value.trim();
    if (trimmed === '') {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : 'invalid';
  };

  const save = async () => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 0) {
      setError('Enter a budget amount of zero or more.');
      return;
    }
    const priceValue = parseOptional(price);
    if (priceValue === 'invalid' || (priceValue !== null && priceValue < 0)) {
      setError('Enter a price to the client of zero or more, or leave it blank.');
      return;
    }
    const profitValue = parseOptional(profitTarget);
    if (
      profitValue === 'invalid' ||
      (profitValue !== null && (profitValue < 0 || profitValue > 100))
    ) {
      setError('Profit target is a percentage from 0 to 100, or blank.');
      return;
    }
    const marginValue = parseOptional(marginTarget);
    if (marginValue === 'invalid' || (marginValue !== null && marginValue < 0)) {
      setError('Enter a margin target of zero or more, or leave it blank.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await setBudget(project.id, {
        amount: value,
        currency,
        price: priceValue,
        profitTargetPercent: profitValue,
        marginTargetAmount: marginValue,
      });
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
                <Field label="Budget amount">
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

            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <Field label="Price to client">
                  <input
                    className="input"
                    type="number"
                    min={0}
                    step="0.01"
                    value={price}
                    onChange={(event) => setPrice(event.target.value)}
                    placeholder="0.00"
                  />
                </Field>
              </div>
              <div style={{ flex: 1 }}>
                <Field label="Profit target %">
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={100}
                    step="0.1"
                    value={profitTarget}
                    onChange={(event) => setProfitTarget(event.target.value)}
                    placeholder="35"
                  />
                </Field>
              </div>
            </div>

            <Field
              label="Margin target (amount)"
              hint="Margin target is owned by delivery and finance."
            >
              <input
                className="input"
                type="number"
                min={0}
                step="0.01"
                value={marginTarget}
                onChange={(event) => setMarginTarget(event.target.value)}
                placeholder="0.00"
              />
            </Field>

            <p className="muted small">
              Price sets Profit (price minus cost) and the profit target; the
              margin target is measured against cost. Time is costed at the most
              specific rate: member, then project, then client. Amounts in other
              currencies convert at the daily FX rate.
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
