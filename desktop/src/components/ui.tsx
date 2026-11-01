import { cloneElement, isValidElement, useId } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { BudgetSummary } from '../lib/types';

export function Badge({
  tone = 'neutral',
  icon,
  children,
}: {
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'brand';
  icon?: string;
  children: ReactNode;
}) {
  const className =
    tone === 'neutral' ? 'badge' : `badge badge-${tone}`;
  return (
    <span className={className}>
      {icon ? (
        <span className="icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {children}
    </span>
  );
}

export function healthBadge(summary: BudgetSummary | undefined): {
  tone: 'neutral' | 'success' | 'warning' | 'danger' | 'brand';
  icon: string;
  label: string;
} {
  if (!summary || !summary.budget) {
    return { tone: 'neutral', icon: '–', label: 'No budget' };
  }
  if (summary.flag === 'over') {
    const percent = summary.percentUsed ? `${Math.round(summary.percentUsed)}%` : 'over';
    return { tone: 'danger', icon: '!', label: `Over budget · ${percent}` };
  }
  if (summary.marginTargetMet === false) {
    return { tone: 'warning', icon: '!', label: 'Below margin target' };
  }
  if (summary.profitTargetMet === false) {
    return { tone: 'warning', icon: '!', label: 'Below profit target' };
  }
  if (summary.price == null) {
    return { tone: 'brand', icon: 'i', label: 'Price not set' };
  }
  if (summary.flag === 'warning') {
    const left =
      summary.percentUsed != null
        ? `${Math.max(0, Math.round(100 - summary.percentUsed))}% left`
        : 'low';
    return { tone: 'warning', icon: '!', label: `Low budget · ${left}` };
  }
  return { tone: 'success', icon: '✓', label: 'On track' };
}

export function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="card card-pad stack" style={{ gap: 2 }}>
      <span className="metric-label">{label}</span>
      <span className="metric-value">{value}</span>
      {detail ? <span className="muted small">{detail}</span> : null}
    </div>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  const generated = useId();
  // The label is tied to its control with htmlFor/id and the hint with
  // aria-describedby, so assistive technology announces both.
  const control = isValidElement<{ id?: string; 'aria-describedby'?: string }>(children)
    ? (children as ReactElement<{ id?: string; 'aria-describedby'?: string }>)
    : null;
  const controlId = control?.props.id ?? generated;
  const hintId = `${generated}-hint`;
  return (
    <div className="field">
      <label htmlFor={controlId}>{label}</label>
      {control
        ? cloneElement(control, {
            id: controlId,
            ...(hint ? { 'aria-describedby': hintId } : {}),
          })
        : children}
      {hint ? (
        <span className="muted small" id={hintId}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}
