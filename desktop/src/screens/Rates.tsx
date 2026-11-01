import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../state/AppContext';
import { Badge, Field } from '../components/ui';
import { currencyOptions } from '../lib/currency';
import { formatMoney } from '../lib/format';
import type { Member, Project, Rate, RateScope } from '../lib/types';

type RateSort = 'target' | 'date';

const SCOPE_LABEL: Record<RateScope, string> = {
  member: 'Member',
  project: 'Project',
  project_member: 'Project + member',
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function Rates() {
  const {
    member,
    organisation,
    loadRates,
    loadMembers,
    projects,
    setRate,
    removeRate,
  } = useApp();

  const [rates, setRates] = useState<Rate[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<RateScope>('project');
  const [projectId, setProjectId] = useState('');
  const [memberId, setMemberId] = useState('');
  const [fromDate, setFromDate] = useState(today);
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(
    organisation?.reportingCurrency ?? 'EUR',
  );
  const [sort, setSort] = useState<RateSort>('target');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [rateList, memberList] = await Promise.all([loadRates(), loadMembers()]);
    setRates(rateList);
    setMembers(memberList);
  }, [loadRates, loadMembers]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadRates(), loadMembers()])
      .then(([rateList, memberList]) => {
        if (!cancelled) {
          setRates(rateList);
          setMembers(memberList);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : 'Could not load rates',
          );
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
  }, [loadRates, loadMembers]);

  const save = async () => {
    const value = Number(amount);
    const needsMember = scope === 'member' || scope === 'project_member';
    const needsProject = scope === 'project' || scope === 'project_member';
    if (needsMember && !memberId) {
      setError('Choose the member this rate applies to.');
      return;
    }
    if (needsProject && !projectId) {
      setError('Choose the project this rate applies to.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) {
      setError('Choose the date this rate applies from.');
      return;
    }
    if (amount.trim() === '' || !Number.isFinite(value) || value < 0) {
      setError('Enter an hourly rate of zero or more.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await setRate({
        scope,
        memberId: needsMember ? memberId : null,
        projectId: needsProject ? projectId : null,
        fromDate,
        currency,
        hourlyAmount: value,
      });
      setAmount('');
      await reload();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save rate');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await removeRate(id);
      setConfirmingId(null);
      await reload();
    } catch (removeError) {
      setError(
        removeError instanceof Error ? removeError.message : 'Could not remove rate',
      );
    } finally {
      setBusy(false);
    }
  };

  const memberName = (id: string | null): string =>
    members.find((candidate) => candidate.id === id)?.displayName ?? id ?? '—';
  const projectName = (id: string | null): string =>
    projects.find((candidate) => candidate.id === id)?.name ?? id ?? '—';

  const referenceName = (rate: Rate): string => {
    if (rate.scope === 'member') {
      return memberName(rate.member_id);
    }
    if (rate.scope === 'project') {
      return projectName(rate.project_id);
    }
    return `${memberName(rate.member_id)} on ${projectName(rate.project_id)}`;
  };

  // Target first, then newest from-date first; "from date" orders by date alone.
  const sortedRates = [...rates].sort((left, right) => {
    const byDate = right.from_date.localeCompare(left.from_date);
    if (sort === 'date') {
      return byDate || referenceName(left).localeCompare(referenceName(right));
    }
    return (
      referenceName(left).localeCompare(referenceName(right)) ||
      left.scope.localeCompare(right.scope) ||
      byDate
    );
  });

  const defaultRateText = `${organisation?.defaultHourlyRate ?? 200} NZD`;

  const canManage =
    member?.role === 'manager' || member?.role === 'administrator';

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Budgets and rates</h1>
          <span className="sub">Rates resolve project + member, then project, then member, then the default rate.</span>
        </div>
        <Badge tone="neutral">
          Reporting currency {organisation?.reportingCurrency ?? '—'}
        </Badge>
      </div>

      {!canManage ? (
        <div className="banner">
          Only managers and administrators can change rates.
        </div>
      ) : null}
      {error ? (
        <div className="banner banner-error" role="alert">
          {error}
        </div>
      ) : null}

      {canManage ? (
        <section className="card card-pad stack">
          <h2>Set a rate</h2>
          <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 140 }}>
              <Field label="Applies to">
                <select
                  className="select"
                  value={scope}
                  onChange={(event) => setScope(event.target.value as RateScope)}
                >
                  <option value="member">{SCOPE_LABEL.member}</option>
                  <option value="project">{SCOPE_LABEL.project}</option>
                  <option value="project_member">{SCOPE_LABEL.project_member}</option>
                </select>
              </Field>
            </div>
            {scope === 'member' || scope === 'project_member' ? (
              <div style={{ flex: 2, minWidth: 180 }}>
                <Field label="Member">
                  <select
                    className="select"
                    value={memberId}
                    onChange={(event) => setMemberId(event.target.value)}
                  >
                    <option value="">Choose a member</option>
                    {members.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.displayName}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            ) : null}
            {scope === 'project' || scope === 'project_member' ? (
              <div style={{ flex: 2, minWidth: 180 }}>
                <Field label="Project">
                  <select
                    className="select"
                    value={projectId}
                    onChange={(event) => setProjectId(event.target.value)}
                  >
                    <option value="">Choose a project</option>
                    {projects.map((project: Project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            ) : null}
            <div style={{ flex: 1, minWidth: 150 }}>
              <Field label="From date" hint="Applies to time on or after this date.">
                <input
                  className="input"
                  type="date"
                  required
                  value={fromDate}
                  onChange={(event) => setFromDate(event.target.value)}
                />
              </Field>
            </div>
            <div style={{ flex: 1, minWidth: 120 }}>
              <Field label="Hourly rate">
                <input
                  className="input"
                  type="number"
                  required
                  min={0}
                  step="0.01"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="0.00"
                />
              </Field>
            </div>
            <div style={{ flex: 1, minWidth: 100 }}>
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
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void save()}
              disabled={busy}
            >
              {busy ? 'Saving…' : 'Save rate'}
            </button>
          </div>
        </section>
      ) : null}

      <section className="card">
        {loading ? (
          <div className="empty">
            <p>Loading rates…</p>
          </div>
        ) : rates.length === 0 ? (
          <div className="empty">
            <p>No rates yet.</p>
            <p className="small">
              Time is costed at the default rate of {defaultRateText}.
            </p>
          </div>
        ) : (
          <>
            <div className="row" style={{ padding: '12px 16px', justifyContent: 'flex-end' }}>
              <div style={{ minWidth: 200 }}>
                <Field label="Order by">
                  <select
                    className="select"
                    value={sort}
                    onChange={(event) => setSort(event.target.value as RateSort)}
                  >
                    <option value="target">Target, then newest first</option>
                    <option value="date">From date, newest first</option>
                  </select>
                </Field>
              </div>
            </div>
            <table className="table">
              <caption className="sr-only">Rates by target and from date</caption>
              <thead>
                <tr>
                  <th scope="col">Scope</th>
                  <th scope="col">Applies to</th>
                  <th scope="col">From date</th>
                  <th scope="col" className="num">
                    Rate
                  </th>
                  <th scope="col">Currency</th>
                  {canManage ? (
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {sortedRates.map((rate) => {
                  const description = `${SCOPE_LABEL[rate.scope]} rate for ${referenceName(rate)} from ${rate.from_date}`;
                  return (
                    <tr key={rate.id}>
                      <td>
                        <Badge tone="neutral">{SCOPE_LABEL[rate.scope]}</Badge>
                      </td>
                      <td>{referenceName(rate)}</td>
                      <td>
                        <time dateTime={rate.from_date}>{rate.from_date}</time>
                      </td>
                      <td className="num">
                        {formatMoney(Number(rate.hourly_amount), rate.currency)} / hour
                      </td>
                      <td>{rate.currency}</td>
                      {canManage ? (
                        <td className="num">
                          {confirmingId === rate.id ? (
                            <div className="row" style={{ justifyContent: 'flex-end' }}>
                              <span className="small" role="status">
                                Removing this rate can change past costs and reports.
                              </span>
                              <button
                                type="button"
                                className="btn btn-sm"
                                onClick={() => setConfirmingId(null)}
                                disabled={busy}
                              >
                                Keep
                              </button>
                              <button
                                type="button"
                                className="btn btn-sm btn-danger"
                                aria-label={`Confirm removing ${description}`}
                                onClick={() => void remove(rate.id)}
                                disabled={busy}
                              >
                                Remove rate
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="btn btn-sm btn-danger"
                              aria-label={`Remove ${description}`}
                              onClick={() => setConfirmingId(rate.id)}
                              disabled={busy}
                            >
                              Remove
                            </button>
                          )}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </section>
    </div>
  );
}
