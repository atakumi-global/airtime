import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../state/AppContext';
import { Badge, Field } from '../components/ui';
import { currencyOptions } from '../lib/currency';
import { formatMoney } from '../lib/format';
import type { Member, Project, Rate, RateScope } from '../lib/types';

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
  const [clientId, setClientId] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(
    organisation?.reportingCurrency ?? 'EUR',
  );

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

  const referenceId =
    scope === 'member' ? memberId : scope === 'project' ? projectId : clientId;

  const save = async () => {
    const value = Number(amount);
    if (!referenceId) {
      setError(`Choose the ${scope} this rate applies to.`);
      return;
    }
    if (!Number.isFinite(value) || value < 0) {
      setError('Enter an hourly rate of zero or more.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await setRate({
        scope,
        memberId: scope === 'member' ? memberId : null,
        projectId: scope === 'project' ? projectId : null,
        clientId: scope === 'client' ? clientId : null,
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
      await reload();
    } catch (removeError) {
      setError(
        removeError instanceof Error ? removeError.message : 'Could not remove rate',
      );
    } finally {
      setBusy(false);
    }
  };

  const referenceName = (rate: Rate): string => {
    if (rate.scope === 'member') {
      return (
        members.find((candidate) => candidate.id === rate.member_id)?.displayName ??
        rate.member_id ??
        '—'
      );
    }
    if (rate.scope === 'project') {
      return (
        projects.find((candidate) => candidate.id === rate.project_id)?.name ??
        rate.project_id ??
        '—'
      );
    }
    return rate.client_id ?? '—';
  };

  const canManage =
    member?.role === 'manager' || member?.role === 'administrator';

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Budgets and rates</h1>
          <span className="sub">Rates resolve member, then project, then client</span>
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
      {error ? <div className="banner banner-error">{error}</div> : null}

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
                  <option value="member">Member</option>
                  <option value="project">Project</option>
                  <option value="client">Client</option>
                </select>
              </Field>
            </div>
            <div style={{ flex: 2, minWidth: 200 }}>
              {scope === 'member' ? (
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
              ) : scope === 'project' ? (
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
              ) : (
                <Field label="Client id" hint="Plane has no client list; use the project's client id.">
                  <input
                    className="input"
                    value={clientId}
                    onChange={(event) => setClientId(event.target.value)}
                    placeholder="00000000-0000-0000-0000-000000000000"
                  />
                </Field>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 120 }}>
              <Field label="Hourly rate">
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
              Without a rate, time is recorded but left uncosted.
            </p>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Scope</th>
                <th scope="col">Applies to</th>
                <th scope="col" className="num">
                  Rate
                </th>
                {canManage ? <th scope="col" /> : null}
              </tr>
            </thead>
            <tbody>
              {rates.map((rate) => (
                <tr key={rate.id}>
                  <td>
                    <Badge tone="neutral">{rate.scope}</Badge>
                  </td>
                  <td>{referenceName(rate)}</td>
                  <td className="num">
                    {formatMoney(Number(rate.hourly_amount), rate.currency)} / hour
                  </td>
                  {canManage ? (
                    <td className="num">
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        onClick={() => void remove(rate.id)}
                        disabled={busy}
                      >
                        Remove
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
