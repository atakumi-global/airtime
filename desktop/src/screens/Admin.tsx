import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../state/AppContext';
import { Badge, Field } from '../components/ui';
import type { AuditEntry, FeedbackEvent, Member, Role } from '../lib/types';

type Tab = 'members' | 'audit' | 'feedback';

const ROLES: Role[] = ['administrator', 'manager', 'member'];

function formatStamp(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function Admin() {
  const {
    member,
    loadMembers,
    createMember,
    setMemberRole,
    removeMember,
    loadAudit,
    loadFeedback,
    loadFeedbackExport,
  } = useApp();
  const [tab, setTab] = useState<Tab>('members');
  const [members, setMembers] = useState<Member[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [feedback, setFeedback] = useState<FeedbackEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [password, setPassword] = useState('');

  const canAdmin = member?.role === 'administrator';

  const reloadMembers = useCallback(async () => {
    setMembers(await loadMembers());
  }, [loadMembers]);

  useEffect(() => {
    if (!canAdmin) {
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        if (tab === 'members') {
          const list = await loadMembers();
          if (!cancelled) {
            setMembers(list);
          }
        } else if (tab === 'audit') {
          const entries = await loadAudit(200);
          if (!cancelled) {
            setAudit(entries);
          }
        } else {
          const events = await loadFeedback(200);
          if (!cancelled) {
            setFeedback(events);
          }
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : 'Could not load data',
          );
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [canAdmin, tab, loadMembers, loadAudit, loadFeedback]);

  if (!canAdmin) {
    return (
      <div className="page">
        <div className="banner">Only administrators can open this screen.</div>
      </div>
    );
  }

  const addMember = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await createMember({
        email,
        displayName,
        role,
        ...(password ? { password } : {}),
      });
      setEmail('');
      setDisplayName('');
      setPassword('');
      setRole('member');
      setMessage('Member added.');
      await reloadMembers();
    } catch (createError) {
      setError(
        createError instanceof Error ? createError.message : 'Could not add member',
      );
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (id: string, next: Role) => {
    setBusy(true);
    setError(null);
    try {
      await setMemberRole(id, next);
      await reloadMembers();
    } catch (roleError) {
      setError(
        roleError instanceof Error ? roleError.message : 'Could not change role',
      );
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await removeMember(id);
      setMessage('Member removed. Their historical entries are kept.');
      await reloadMembers();
    } catch (removeError) {
      setError(
        removeError instanceof Error ? removeError.message : 'Could not remove member',
      );
    } finally {
      setBusy(false);
    }
  };

  const exportFeedback = async () => {
    setBusy(true);
    setError(null);
    try {
      const dataset = await loadFeedbackExport();
      const blob = new Blob([JSON.stringify(dataset, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'airtime-feedback.json';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setMessage(`Exported ${dataset.length} anonymised events.`);
    } catch (exportError) {
      setError(
        exportError instanceof Error ? exportError.message : 'Export failed',
      );
    } finally {
      setBusy(false);
    }
  };

  const memberName = (id: string): string =>
    members.find((candidate) => candidate.id === id)?.displayName ?? id.slice(0, 8);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Admin</h1>
          <span className="sub">Members, audit log and feedback</span>
        </div>
        <div className="row">
          {(['members', 'audit', 'feedback'] as Tab[]).map((id) => (
            <button
              key={id}
              type="button"
              className="btn btn-sm"
              aria-pressed={tab === id}
              aria-current={tab === id ? 'page' : undefined}
              onClick={() => setTab(id)}
            >
              {id === 'members' ? 'Members' : id === 'audit' ? 'Audit log' : 'Feedback'}
            </button>
          ))}
        </div>
      </div>

      {message ? <div className="banner">{message}</div> : null}
      {error ? <div className="banner banner-error">{error}</div> : null}

      {tab === 'members' ? (
        <>
          <section className="card card-pad stack">
            <h2>Add a member</h2>
            <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 180 }}>
                <Field label="Display name">
                  <input
                    className="input"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                  />
                </Field>
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <Field label="Email">
                  <input
                    className="input"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </Field>
              </div>
              <div style={{ flex: 1, minWidth: 130 }}>
                <Field label="Role">
                  <select
                    className="select"
                    value={role}
                    onChange={(event) => setRole(event.target.value as Role)}
                  >
                    {ROLES.map((candidate) => (
                      <option key={candidate} value={candidate}>
                        {candidate}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <div style={{ flex: 1, minWidth: 160 }}>
                <Field label="Password" hint="Optional for OIDC members.">
                  <input
                    className="input"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </Field>
              </div>
            </div>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void addMember()}
                disabled={busy || !email || !displayName}
              >
                Add member
              </button>
            </div>
          </section>

          <section className="card">
            {members.length === 0 ? (
              <div className="empty">
                <p>No members yet.</p>
              </div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Member</th>
                    <th scope="col">Role</th>
                    <th scope="col">Status</th>
                    <th scope="col" />
                  </tr>
                </thead>
                <tbody>
                  {members.map((entry) => (
                    <tr key={entry.id}>
                      <td>
                        <div className="stack" style={{ gap: 2 }}>
                          <strong>{entry.displayName}</strong>
                          <span className="muted small">{entry.email}</span>
                        </div>
                      </td>
                      <td>
                        <select
                          className="select"
                          value={entry.role}
                          disabled={busy || entry.id === member?.id}
                          onChange={(event) =>
                            void changeRole(entry.id, event.target.value as Role)
                          }
                        >
                          {ROLES.map((candidate) => (
                            <option key={candidate} value={candidate}>
                              {candidate}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <Badge tone={entry.status === 'active' ? 'success' : 'danger'}>
                          {entry.status}
                        </Badge>
                      </td>
                      <td className="num">
                        <button
                          type="button"
                          className="btn btn-sm btn-danger"
                          onClick={() => void remove(entry.id)}
                          disabled={busy || entry.id === member?.id}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      ) : null}

      {tab === 'audit' ? (
        <section className="card">
          {audit.length === 0 ? (
            <div className="empty">
              <p>No audit entries yet.</p>
              <p className="small">Budget, rate and member changes appear here.</p>
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Action</th>
                  <th scope="col">Entity</th>
                  <th scope="col">Actor</th>
                  <th scope="col">When</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.action}</td>
                    <td>
                      <span className="muted small">
                        {entry.entity_type}
                        {entry.entity_id ? ` · ${entry.entity_id.slice(0, 8)}` : ''}
                      </span>
                    </td>
                    <td>{memberName(entry.actor_member_id)}</td>
                    <td>{formatStamp(entry.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : null}

      {tab === 'feedback' ? (
        <>
          <section className="card card-pad stack">
            <div className="row-between">
              <div>
                <h2>Anonymised feedback</h2>
                <p className="muted small">
                  Create, edit and delete events from members who opted in, with
                  identifying data removed. Nothing is captured while a member is
                  opted out.
                </p>
              </div>
              <button
                type="button"
                className="btn"
                onClick={() => void exportFeedback()}
                disabled={busy}
              >
                Export JSON
              </button>
            </div>
          </section>
          <section className="card">
            {feedback.length === 0 ? (
              <div className="empty">
                <p>No feedback events yet.</p>
              </div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Action</th>
                    <th scope="col">Source</th>
                    <th scope="col">Member hash</th>
                    <th scope="col">When</th>
                  </tr>
                </thead>
                <tbody>
                  {feedback.map((event) => (
                    <tr key={event.id}>
                      <td>
                        <Badge tone="neutral">{event.action}</Badge>
                      </td>
                      <td>{event.source ?? '—'}</td>
                      <td className="mono small">{event.member_hash.slice(0, 12)}…</td>
                      <td>{formatStamp(event.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
