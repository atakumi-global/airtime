import { useMemo, useState } from 'react';
import { useApp } from '../state/AppContext';
import { Badge, healthBadge } from '../components/ui';
import { BudgetDialog } from '../components/BudgetDialog';
import { formatMoney } from '../lib/format';
import type { Project } from '../lib/types';

export function Projects() {
  const { member, projects, workItems, organisation, online } = useApp();
  const [editing, setEditing] = useState<Project | null>(null);
  const canManage =
    member?.role === 'manager' || member?.role === 'administrator';

  const openCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of workItems) {
      if (!item.is_open || !item.project_id) {
        continue;
      }
      counts.set(item.project_id, (counts.get(item.project_id) ?? 0) + 1);
    }
    return counts;
  }, [workItems]);

  const flagged = projects.filter(
    (project) => project.summary && project.summary.flag !== 'ok' && project.summary.flag !== 'none',
  );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Projects</h1>
          <span className="sub">read-only from Plane · Airtime adds budgets and cost</span>
        </div>
        <Badge tone="neutral">
          Reporting currency {organisation?.reportingCurrency ?? '—'}
        </Badge>
      </div>

      <p className="muted small">
        Projects, work items and clients come from Plane. Airtime adds budgets,
        rates and time — it never edits a project.
      </p>

      {!online ? (
        <div className="banner banner-warning">
          Offline. Showing cached projects and budgets.
        </div>
      ) : null}

      {flagged.length > 0 ? (
        <div className="banner banner-warning">
          {flagged.length === 1
            ? `${flagged[0]!.name} needs attention.`
            : `${flagged.length} projects need attention.`}{' '}
          Review flagged rows below.
        </div>
      ) : null}

      <section className="card">
        {projects.length === 0 ? (
          <div className="empty">
            <p>No projects yet.</p>
            <p className="small">
              Connect Plane in Settings to sync projects and work items.
            </p>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Project</th>
                <th scope="col">Health</th>
                <th scope="col" className="num">
                  Budget
                </th>
                <th scope="col" className="num">
                  Cost
                </th>
                <th scope="col" className="num">
                  Margin
                </th>
                <th scope="col">Burn</th>
                {canManage ? <th scope="col" /> : null}
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => {
                const summary = project.summary;
                const badge = healthBadge(summary);
                const currency = summary?.currency ?? organisation?.reportingCurrency ?? 'USD';
                const open = openCounts.get(project.id) ?? 0;
                const rowClass =
                  summary?.flag === 'over'
                    ? 'row-over'
                    : summary?.flag === 'warning'
                      ? 'row-warning'
                      : undefined;
                const percent = summary?.percentUsed;
                return (
                  <tr key={project.id} className={rowClass}>
                    <td>
                      <div className="stack" style={{ gap: 2 }}>
                        <strong>{project.name}</strong>
                        <span className="muted small">
                          {open} open {open === 1 ? 'item' : 'items'} · from Plane
                        </span>
                      </div>
                    </td>
                    <td>
                      <Badge tone={badge.tone} icon={badge.icon}>
                        {badge.label}
                      </Badge>
                    </td>
                    <td className="num">
                      {summary?.convertedBudget != null
                        ? formatMoney(summary.convertedBudget, currency, { compact: true })
                        : summary?.budget
                          ? formatMoney(summary.budget.amount, summary.budget.currency, {
                              compact: true,
                            })
                          : '—'}
                    </td>
                    <td className="num">
                      {summary ? formatMoney(summary.spent, currency, { compact: true }) : '—'}
                    </td>
                    <td className="num">
                      {summary?.remaining != null
                        ? formatMoney(summary.remaining, currency, { compact: true })
                        : '—'}
                    </td>
                    <td style={{ minWidth: 130 }}>
                      {summary?.budget ? (
                        <div className="stack" style={{ gap: 4 }}>
                          <div
                            role="meter"
                            aria-label={`Budget used for ${project.name}`}
                            aria-valuenow={Math.round(percent ?? 0)}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            style={{
                              height: 6,
                              borderRadius: 999,
                              background: 'var(--layer-3)',
                              overflow: 'hidden',
                            }}
                          >
                            <div
                              style={{
                                width: `${Math.min(100, Math.max(0, percent ?? 0))}%`,
                                height: '100%',
                                background:
                                  summary.flag === 'over'
                                    ? 'var(--danger)'
                                    : summary.flag === 'warning'
                                      ? 'var(--warning)'
                                      : 'var(--success)',
                              }}
                            />
                          </div>
                          <span className="muted small">
                            {percent != null ? `${Math.round(percent)}% used` : '—'}
                            {summary.fxStale ? ' · FX stale' : ''}
                          </span>
                        </div>
                      ) : (
                        <span className="muted small">—</span>
                      )}
                    </td>
                    {canManage ? (
                      <td className="num">
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => setEditing(project)}
                        >
                          {summary?.budget ? 'Edit budget' : 'Set budget'}
                        </button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {editing ? (
        <BudgetDialog
          project={editing}
          defaultCurrency={organisation?.reportingCurrency ?? 'EUR'}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
