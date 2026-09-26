import type { ReactNode } from 'react';
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
  tone: 'neutral' | 'success' | 'warning' | 'danger';
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
  if (summary.flag === 'warning') {
    return { tone: 'warning', icon: '!', label: 'Below margin target' };
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
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint ? <span className="muted small">{hint}</span> : null}
    </div>
  );
}
