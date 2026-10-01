import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../state/AppContext';
import { Badge, healthBadge } from '../components/ui';
import { BudgetDialog } from '../components/BudgetDialog';
import { formatDate, formatDuration, formatMoney } from '../lib/format';
import { chartMax, chartText, projectedTotal } from '../lib/chart';
import type { BudgetSummary, Project, TimeEntry } from '../lib/types';
import type { View } from '../components/Shell';

const CHART = { width: 520, height: 190, left: 40, right: 510, top: 20, base: 150 };

function loadErrorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Could not load the project';
}

function Fin({
  label,
  value,
  formula,
  tone,
  accent,
}: {
  label: string;
  value: string;
  formula: string;
  tone?: 'pos' | 'neg';
  accent?: boolean;
}) {
  const className = `fin${accent ? ' fin-accent' : ''}${tone ? ` fin-${tone}` : ''}`;
  return (
    <div className={className}>
      <span className="k">{label}</span>
      <span className="v">{value}</span>
      <span className="formula">{formula}</span>
    </div>
  );
}

function Target({
  title,
  owner,
  target,
  actual,
  detail,
  emptyText,
  currency,
}: {
  title: string;
  owner: string;
  target: number | null;
  actual: number | null;
  detail?: string;
  emptyText: string;
  currency: string;
}) {
  const met = target !== null && actual !== null ? actual >= target : null;
  const percent = target !== null && target > 0 && actual !== null
    ? Math.min(100, Math.max(0, (actual / target) * 100))
    : 0;
  return (
    <div className="target">
      <div className="row-between">
        <span className="strong small">{title}</span>
        <span className="muted small">{owner}</span>
      </div>
      {target === null || actual === null ? (
        <p className="muted small">{emptyText}</p>
      ) : (
        <>
          <div className="row-between">
            <span className="muted small">
              Target {formatMoney(target, currency)}
              {detail ? ` (${detail})` : ''}
            </span>
            {met ? (
              <Badge tone="success" icon="✓">
                Above by {formatMoney(Math.max(0, actual - target), currency)}
              </Badge>
            ) : (
              <Badge tone="warning" icon="!">
                Below by {formatMoney(Math.max(0, target - actual), currency)}
              </Badge>
            )}
          </div>
          <div className="bar-track">
            <div
              className="bar-fill"
              style={{
                width: `${percent}%`,
                background: met ? 'var(--success)' : 'var(--warning)',
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}

function ProjectChart({ summary }: { summary: BudgetSummary }) {
  const max = chartMax(summary);
  const { left, right, top, base } = CHART;
  const span = right - left;
  const count = summary.weeklyCost.length;
  const step = span / Math.max(count, 1);
  const barWidth = Math.min(30, Math.max(6, step * 0.6));
  const y = (value: number) => base - (value / max) * (base - top);
  const budget = summary.convertedBudget;
  const price = summary.price;
  const projected = projectedTotal(summary);
  const last = summary.weeklyCost[count - 1]!;
  const lastX = left + step * (count - 0.5);
  return (
    <svg
      className="chart"
      viewBox={`0 0 ${CHART.width} ${CHART.height}`}
      role="img"
      aria-label={chartText(summary)}
    >
      {[0.25, 0.5, 0.75, 1].map((fraction) => (
        <line
          key={fraction}
          className="chart-grid"
          x1={left}
          y1={base - (base - top) * fraction}
          x2={right}
          y2={base - (base - top) * fraction}
        />
      ))}
      {budget !== null ? (
        <line className="chart-budget" x1={left} y1={y(budget)} x2={right} y2={y(budget)} />
      ) : null}
      {price !== null ? (
        <line className="chart-price" x1={left} y1={y(price)} x2={right} y2={y(price)} />
      ) : null}
      {summary.weeklyCost.map((week, index) => {
        const height = Math.max(1, (week.cost / max) * (base - top));
        return (
          <rect
            key={week.weekStart}
            className="chart-bar"
            x={left + step * index + (step - barWidth) / 2}
            y={base - height}
            width={barWidth}
            height={height}
            rx={3}
          />
        );
      })}
      {projected !== null ? (
        <polyline
          className="chart-projected"
          points={`${lastX},${y(last.cost)} ${right - 10},${y(projected)}`}
        />
      ) : null}
      <line className="chart-axis" x1={left} y1={base} x2={right} y2={base} />
      <text className="chart-label" x={left + step * 0.5} y={base + 16} textAnchor="middle">
        {formatDate(summary.weeklyCost[0]!.weekStart)}
      </text>
      <text className="chart-label" x={right} y={base + 16} textAnchor="end">
        Now
      </text>
    </svg>
  );
}

export function ProjectDetail({
  project,
  onBack,
  onNavigate,
}: {
  project: Project;
  onBack: () => void;
  onNavigate: (view: View) => void;
}) {
  const {
    member,
    organisation,
    workItems,
    loadProjectSummary,
    loadProjectEntries,
    exportCsv,
  } = useApp();
  const [summary, setSummary] = useState<BudgetSummary | null>(null);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const canManage =
    member?.role === 'manager' || member?.role === 'administrator';

  const fetchDetail = useCallback(
    () =>
      Promise.all([
        loadProjectSummary(project.id),
        loadProjectEntries(project.id),
      ]),
    [loadProjectEntries, loadProjectSummary, project.id],
  );

  const applyDetail = useCallback(
    ([detail, entryList]: [
      { project: Project; summary: BudgetSummary },
      TimeEntry[],
    ]) => {
      setSummary(detail.summary);
      setEntries(entryList.slice(0, 5));
      setError(null);
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    fetchDetail()
      .then((result) => {
        if (!cancelled) {
          applyDetail(result);
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(loadErrorText(loadError));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [applyDetail, fetchDetail]);

  const reload = useCallback(() => {
    setLoading(true);
    fetchDetail()
      .then(applyDetail)
      .catch((loadError: unknown) => setError(loadErrorText(loadError)))
      .finally(() => setLoading(false));
  }, [applyDetail, fetchDetail]);

  const exportProject = async () => {
    setExporting(true);
    setError(null);
    try {
      const csv = await exportCsv({ projectId: project.id });
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'airtime-time-entries.csv';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const currency = summary?.currency ?? organisation?.reportingCurrency ?? 'USD';
  const badge = healthBadge(summary ?? undefined);
  const money = (value: number | null | undefined) =>
    value === null || value === undefined ? '—' : formatMoney(value, currency);

  return (
    <div className="page">
      <div className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <button type="button" className="link-btn" onClick={onBack}>
            ← Projects
          </button>
          <div className="row">
            <h1>{project.name}</h1>
            <Badge tone={badge.tone} icon={badge.icon}>
              {badge.label}
            </Badge>
          </div>
          <span className="sub">read-only from Plane · Airtime adds budgets and cost</span>
        </div>
        {canManage ? (
          <div className="row">
            <button
              type="button"
              className="btn"
              onClick={() => void exportProject()}
              disabled={exporting}
            >
              {exporting ? 'Exporting…' : 'Export'}
            </button>
            <button type="button" className="btn" onClick={() => onNavigate('rates')}>
              Rates
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setEditing(true)}
            >
              {summary?.budget ? 'Edit budget' : 'Set budget'}
            </button>
          </div>
        ) : null}
      </div>

      {loading ? <p className="muted small">Loading project…</p> : null}

      {error ? (
        <div className="banner banner-error">
          <div className="row-between">
            <span>{error}</span>
            <button type="button" className="btn btn-sm" onClick={reload}>
              Retry
            </button>
          </div>
        </div>
      ) : null}

      {summary && !loading ? (
        <>
          {!summary.budget ? (
            <div className="banner">
              No budget is set for this project yet. Price, profit, margin and
              targets appear once a manager sets one.
            </div>
          ) : null}

          <section className="fin-grid" aria-label="Project financials">
            <Fin
              label="Price"
              value={money(summary.price)}
              formula="what we sell it for"
            />
            <Fin
              label="Budget"
              value={money(summary.convertedBudget)}
              formula="resources at commercial rates"
              accent
            />
            <Fin label="Cost" value={money(summary.spent)} formula="team at cost levels" />
            <Fin
              label="Profit"
              value={money(summary.profit)}
              formula="Price − cost used"
              tone={summary.profit !== null ? (summary.profit >= 0 ? 'pos' : 'neg') : undefined}
            />
            <Fin
              label="Margin"
              value={money(summary.margin)}
              formula="Available budget − cost"
              tone={summary.margin !== null ? (summary.margin >= 0 ? 'pos' : 'neg') : undefined}
            />
          </section>

          <section className="targets" aria-label="Targets">
            <Target
              title="Profit target"
              owner="managed by sales / account"
              target={summary.profitTargetAmount}
              actual={summary.profit}
              detail={
                summary.profitTargetPercent !== null && summary.price !== null
                  ? `${summary.profitTargetPercent}% of price`
                  : undefined
              }
              emptyText="Set a price and profit target to track this."
              currency={currency}
            />
            <Target
              title="Margin target"
              owner="managed by delivery / finance"
              target={summary.marginTargetAmount}
              actual={summary.margin}
              emptyText="Set a budget and margin target to track this."
              currency={currency}
            />
          </section>

          <div className="detail-grid">
            <section className="card card-pad stack">
              <div className="row-between">
                <h2>Cost, budget and projection</h2>
                <span className="row">
                  <Badge>{currency}</Badge>
                  {summary.fxDate ? (
                    <span className="muted small">daily FX</span>
                  ) : null}
                </span>
              </div>
              {summary.weeklyCost.length === 0 ? (
                <p className="muted small">
                  No cost has been logged against this project yet.
                </p>
              ) : (
                <ProjectChart summary={summary} />
              )}
              <div className="legend row small muted">
                <span>
                  <i style={{ background: 'var(--brand)' }} />
                  Cost by week
                </span>
                {summary.convertedBudget !== null ? (
                  <span>
                    <i style={{ background: 'var(--danger)' }} />
                    Budget
                  </span>
                ) : null}
                {summary.price !== null ? (
                  <span>
                    <i style={{ background: 'var(--success)' }} />
                    Price
                  </span>
                ) : null}
                {projectedTotal(summary) !== null ? (
                  <span>
                    <i style={{ background: 'var(--warning-strong)' }} />
                    Projected cost
                  </span>
                ) : null}
              </div>
            </section>

            <div className="stack">
              <section className="card card-pad stack">
                <h2>Cost build-up</h2>
                <div className="row-between">
                  <span className="small muted">Billable hours</span>
                  <span className="mono small">
                    {formatDuration(summary.billableMinutes)}
                  </span>
                </div>
                <div className="row-between">
                  <span className="small muted">At member cost levels</span>
                  <span className="mono small">{money(summary.costByScope.member)}</span>
                </div>
                <div className="row-between">
                  <span className="small muted">At project cost level</span>
                  <span className="mono small">{money(summary.costByScope.project)}</span>
                </div>
                {summary.costByScope.client > 0 ? (
                  <div className="row-between">
                    <span className="small muted">At client cost level</span>
                    <span className="mono small">
                      {money(summary.costByScope.client)}
                    </span>
                  </div>
                ) : null}
                <hr className="divider" />
                <div className="row-between">
                  <span className="small strong">Cost</span>
                  <span className="mono strong">{money(summary.spent)}</span>
                </div>
                <div className="row-between">
                  <span className="small muted">Uncosted — excluded</span>
                  <span className="mono small muted">
                    {formatDuration(summary.uncosted.hours * 60)}
                  </span>
                </div>
              </section>

              {summary.marginTargetMet === false &&
              summary.marginTargetAmount !== null &&
              summary.margin !== null ? (
                <div className="banner banner-warning">
                  Margin below target: {money(summary.margin)} available against a{' '}
                  {money(summary.marginTargetAmount)} target.
                </div>
              ) : null}
            </div>
          </div>

          <div className="detail-grid-even">
            <section className="card">
              <div className="card-pad row-between">
                <h2>Recent time entries</h2>
                {canManage ? (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => onNavigate('reports')}
                  >
                    View all
                  </button>
                ) : null}
              </div>
              {entries.length === 0 ? (
                <div className="empty">
                  <p className="small">No time logged against this project yet.</p>
                </div>
              ) : (
                entries.map((entry) => {
                  const item = entry.work_item_id
                    ? workItems.find(
                        (workItem) =>
                          workItem.plane_work_item_id === entry.work_item_id,
                      )
                    : undefined;
                  const title = item
                    ? `${item.identifier ?? ''} ${item.name}`.trim()
                    : entry.description ?? 'No work item';
                  return (
                    <div className="entry" key={entry.id}>
                      <span className="entry-time">{formatDate(entry.started_at)}</span>
                      <span className="entry-main">
                        <span className="entry-title">{title}</span>
                        <span className="entry-meta">
                          {entry.source === 'timer' ? 'Timer' : 'Manual'}
                          {item && entry.description ? ` · ${entry.description}` : ''}
                        </span>
                      </span>
                      <span className="entry-amount mono">
                        {formatDuration(entry.duration_minutes)}
                      </span>
                      <span />
                    </div>
                  );
                })
              )}
            </section>

            <section className="card card-pad stack">
              <div className="row-between">
                <h2>Expenses</h2>
                <Badge tone="warning">planned · AIRTIME-25</Badge>
              </div>
              <p className="muted small">
                Expenses are not tracked yet. Licences, travel and hardware will
                count toward Cost, Margin and Profit. Backlog item AIRTIME-25
                covers it.
              </p>
            </section>
          </div>
        </>
      ) : null}

      {editing ? (
        <BudgetDialog
          project={{ ...project, summary: summary ?? undefined }}
          defaultCurrency={organisation?.reportingCurrency ?? 'EUR'}
          onClose={() => {
            setEditing(false);
            reload();
          }}
        />
      ) : null}
    </div>
  );
}
