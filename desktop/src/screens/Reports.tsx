import { useEffect, useState } from 'react';
import { useApp } from '../state/AppContext';
import { Field } from '../components/ui';
import { startOfWeek } from '../lib/format';
import type { Member } from '../lib/types';

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function Reports() {
  const { projects, member, exportCsv, loadMembers } = useApp();
  const [from, setFrom] = useState(() => isoDate(startOfWeek()));
  const [to, setTo] = useState(() => isoDate(new Date()));
  const [projectId, setProjectId] = useState('');
  const [memberId, setMemberId] = useState('');
  const [members, setMembers] = useState<Member[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadMembers()
      .then((list) => {
        if (!cancelled) {
          setMembers(list);
        }
      })
      .catch(() => {
        // member filter stays empty if the caller cannot list members
      });
    return () => {
      cancelled = true;
    };
  }, [loadMembers]);

  const canExport = member?.role === 'manager' || member?.role === 'administrator';

  const run = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const csv = await exportCsv({
        from,
        to,
        projectId: projectId || undefined,
        memberId: memberId || undefined,
      });
      const rows = Math.max(0, csv.trim() === '' ? 0 : csv.trim().split(/\r?\n/).length - 1);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'airtime-time-entries.csv';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setMessage(`Exported ${rows} ${rows === 1 ? 'entry' : 'entries'} to CSV.`);
    } catch (exportError) {
      setError(
        exportError instanceof Error ? exportError.message : 'Export failed',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Reports</h1>
          <span className="sub">Export time and cost for billing</span>
        </div>
      </div>

      {!canExport ? (
        <div className="banner">
          Only managers and administrators can export time and cost data.
        </div>
      ) : null}
      {message ? <div className="banner">{message}</div> : null}
      {error ? <div className="banner banner-error">{error}</div> : null}

      <section className="card card-pad stack">
        <h2>Time entries (CSV)</h2>
        <p className="muted small">
          One row per entry with member, date, duration, work item, rate, currency
          and cost, plus the converted cost and the FX rate and date used. Opens
          directly in Excel.
        </p>
        <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 140 }}>
            <Field label="From">
              <input
                className="input"
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
            </Field>
          </div>
          <div style={{ flex: 1, minWidth: 140 }}>
            <Field label="To">
              <input
                className="input"
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
              />
            </Field>
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <Field label="Project">
              <select
                className="select"
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
              >
                <option value="">All projects</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <Field label="Member">
              <select
                className="select"
                value={memberId}
                onChange={(event) => setMemberId(event.target.value)}
              >
                <option value="">All members</option>
                {members.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.displayName}
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
            onClick={() => void run()}
            disabled={busy || !canExport}
          >
            {busy ? 'Exporting…' : 'Export CSV'}
          </button>
        </div>
      </section>

      <section className="card card-pad stack">
        <h2>PDF summary</h2>
        <p className="muted small">
          PDF export is deferred to AIRTIME-27 so its layout gets a visual review
          first. CSV is the supported export in this release.
        </p>
      </section>
    </div>
  );
}
