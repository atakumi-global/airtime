import { useMemo, useState } from 'react';
import { useApp } from '../state/AppContext';
import { Badge, Field, healthBadge } from '../components/ui';
import { BudgetDialog } from '../components/BudgetDialog';
import { ProjectDetail } from './ProjectDetail';
import { formatMoney } from '../lib/format';
import type { Project } from '../lib/types';
import {
  NO_WORKSPACE,
  sameWorkspace,
  workspaceNames,
  workspaceTotals,
} from '../lib/workspaces';
import type { View } from '../components/Shell';

export function Projects({ onNavigate }: { onNavigate: (view: View) => void }) {
  const {
    member,
    projects: allProjects,
    workItems,
    organisation,
    online,
    planeConnection,
    workspaceFilter,
    setWorkspaceFilter,
  } = useApp();
  const [editing, setEditing] = useState<Project | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
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

  const workspaces = useMemo(
    () => workspaceNames(allProjects, planeConnection),
    [allProjects, planeConnection],
  );
  // A remembered filter for a workspace that is gone must not hide everything.
  const activeFilter = workspaces.some((name) => sameWorkspace(name, workspaceFilter))
    ? workspaceFilter
    : '';
  const projects = useMemo(
    () =>
      activeFilter === ''
        ? allProjects
        : allProjects.filter((project) => sameWorkspace(project.workspace_slug, activeFilter)),
    [allProjects, activeFilter],
  );
  const totals = useMemo(() => workspaceTotals(projects), [projects]);
  const currencyCode = organisation?.reportingCurrency ?? 'USD';
  const noWorkspaceConfigured =
    allProjects.length === 0 && (planeConnection?.workspaces.length ?? 0) === 0;

  const flagged = projects.filter(
    (project) => project.summary && project.summary.flag !== 'ok' && project.summary.flag !== 'none',
  );

  const selected = allProjects.find((project) => project.id === selectedId);
  if (selected) {
    return (
      <ProjectDetail
        project={selected}
        onBack={() => setSelectedId(null)}
        onNavigate={onNavigate}
      />
    );
  }

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

      {workspaces.length > 0 ? (
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div style={{ minWidth: 220 }}>
            <Field label="Workspace">
              <select
                className="select"
                value={activeFilter}
                onChange={(event) => setWorkspaceFilter(event.target.value)}
              >
                <option value="">All workspaces</option>
                {workspaces.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <span className="muted small" role="status">
            {projects.length} {projects.length === 1 ? 'project' : 'projects'}
            {activeFilter ? ` in ${activeFilter}` : ''}
          </span>
        </div>
      ) : null}

      <section className="card">
        {noWorkspaceConfigured ? (
          <div className="empty">
            <p>No workspace has been added.</p>
            <p className="small">
              Add the Plane workspaces you work in under Settings to sync their projects and
              work items.
            </p>
            <button type="button" className="btn btn-primary" onClick={() => onNavigate('settings')}>
              Open Settings
            </button>
          </div>
        ) : allProjects.length === 0 ? (
          <div className="empty">
            <p>No projects yet.</p>
            <p className="small">
              The workspaces you added have no projects you belong to, or the first sync has
              not finished. Check their state in Settings.
            </p>
          </div>
        ) : projects.length === 0 ? (
          <div className="empty">
            <p>No projects in {activeFilter}.</p>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Project</th>
                <th scope="col">Workspace</th>
                <th scope="col">Health</th>
                <th scope="col" className="num">
                  Price
                </th>
                <th scope="col" className="num">
                  Budget
                </th>
                <th scope="col" className="num">
                  Cost
                </th>
                <th scope="col" className="num">
                  Profit
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
                        <button
                          type="button"
                          className="link-btn"
                          onClick={() => setSelectedId(project.id)}
                        >
                          {project.name}
                        </button>
                        <span className="muted small">
                          {open} open {open === 1 ? 'item' : 'items'} · from Plane
                        </span>
                        {project.archived ? (
                          <span className="muted small">
                            Archived in Plane · history only, no new time
                          </span>
                        ) : project.can_enter_time === false ? (
                          <span className="muted small">
                            History only · you are not a member of this project in Plane
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td>{project.workspace_slug ?? NO_WORKSPACE}</td>
                    <td>
                      <Badge tone={badge.tone} icon={badge.icon}>
                        {badge.label}
                      </Badge>
                    </td>
                    <td className="num">
                      {summary?.price != null
                        ? formatMoney(summary.price, currency, { compact: true })
                        : '—'}
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
                      {summary?.profit != null
                        ? formatMoney(summary.profit, currency, { compact: true })
                        : '—'}
                    </td>
                    <td className="num">
                      {summary?.margin != null
                        ? formatMoney(summary.margin, currency, { compact: true })
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

      {totals.length > 0 && projects.length > 0 ? (
        <section className="card" aria-label="Totals per workspace">
          <table className="table">
            <caption className="sr-only">Totals per workspace, in {currencyCode}</caption>
            <thead>
              <tr>
                <th scope="col">Workspace</th>
                <th scope="col" className="num">
                  Projects
                </th>
                <th scope="col" className="num">
                  Budget
                </th>
                <th scope="col" className="num">
                  Cost
                </th>
              </tr>
            </thead>
            <tbody>
              {totals.map((total) => (
                <tr key={total.label}>
                  <th scope="row">{total.label}</th>
                  <td className="num">
                    {total.projectCount}
                    {total.archivedCount > 0 ? ` (${total.archivedCount} archived)` : ''}
                  </td>
                  <td className="num">
                    {formatMoney(total.budget, currencyCode, { compact: true })}
                  </td>
                  <td className="num">
                    {formatMoney(total.cost, currencyCode, { compact: true })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

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
