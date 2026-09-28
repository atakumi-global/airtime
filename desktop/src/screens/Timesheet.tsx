import { useEffect, useState } from 'react';
import { useApp, type EntryUpdateInput } from '../state/AppContext';
import { Metric, Badge } from '../components/ui';
import { EntryDialog } from '../components/EntryDialog';
import { NetworkError } from '../lib/api';
import {
  formatDate,
  formatDuration,
  formatMoney,
  periodRange,
  shiftPeriod,
  type PeriodMode,
} from '../lib/format';
import type {
  CostedTimeEntry,
  TimeEntry,
  Timesheet as TimesheetData,
  WorkItem,
} from '../lib/types';

function workItemLabel(
  entry: TimeEntry,
  workItems: WorkItem[],
): string {
  const item = entry.work_item_id
    ? workItems.find(
        (candidate) => candidate.plane_work_item_id === entry.work_item_id,
      )
    : undefined;
  if (item) {
    return `${item.identifier ? `${item.identifier} · ` : ''}${item.name}`;
  }
  return entry.description ?? 'No work item';
}

function cachedSummary(
  entries: TimeEntry[],
  from: string,
  to: string,
  currency: string,
): TimesheetData {
  const inRange = entries.filter((entry) => {
    const started = new Date(entry.started_at).getTime();
    return started >= new Date(from).getTime() && started < new Date(to).getTime();
  });
  const totalMinutes = inRange.reduce(
    (sum, entry) => sum + entry.duration_minutes,
    0,
  );
  const billableMinutes = inRange.reduce(
    (sum, entry) => sum + entry.billable_minutes,
    0,
  );
  return {
    entries: inRange.map((entry) => ({
      ...entry,
      cost: null,
      cost_currency: null,
      cost_uncosted: true,
    })),
    totals: {
      entryCount: inRange.length,
      totalMinutes,
      billableMinutes,
      cost: 0,
      currency,
      currencyTotals: {},
      conversions: {},
      fxStale: false,
      fxDate: null,
      uncosted: { entries: inRange.length, minutes: billableMinutes },
      unconverted: { entries: 0, minutes: 0 },
    },
  };
}

export function Timesheet({ onBackfill }: { onBackfill: () => void }) {
  const {
    loadTimesheet,
    exportCsv,
    member,
    organisation,
    entries,
    workItems,
    updateEntry,
  } = useApp();
  const [mode, setMode] = useState<PeriodMode>('week');
  const [anchor, setAnchor] = useState(() => new Date());
  const [summary, setSummary] = useState<TimesheetData | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const [undo, setUndo] = useState<{
    id: string;
    previous: EntryUpdateInput;
  } | null>(null);

  const range = periodRange(mode, anchor);
  const canExport = member?.role === 'manager' || member?.role === 'administrator';

  useEffect(() => {
    let cancelled = false;
    const activeRange = periodRange(mode, anchor);
    const run = async () => {
      setStatus('loading');
      setError(null);
      setOffline(false);
      try {
        const data = await loadTimesheet(activeRange.from, activeRange.to);
        if (!cancelled) {
          setSummary(data);
          setStatus('ready');
        }
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        if (loadError instanceof NetworkError) {
          setSummary(
            cachedSummary(
              entries,
              activeRange.from,
              activeRange.to,
              organisation?.reportingCurrency ?? 'USD',
            ),
          );
          setOffline(true);
          setStatus('ready');
          return;
        }
        setError(
          loadError instanceof Error ? loadError.message : 'Could not load the timesheet',
        );
        setStatus('error');
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [mode, anchor, loadTimesheet, entries, organisation]);

  const totals = summary?.totals;
  const billableShare =
    totals && totals.totalMinutes > 0
      ? Math.round((totals.billableMinutes / totals.totalMinutes) * 100)
      : 0;

  const exportRange = async () => {
    setExporting(true);
    setError(null);
    setNotice(null);
    try {
      const csv = await exportCsv({
        from: range.from.slice(0, 10),
        to: range.to.slice(0, 10),
      });
      const rows = Math.max(
        0,
        csv.trim() === '' ? 0 : csv.trim().split(/\r?\n/).length - 1,
      );
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchorElement = document.createElement('a');
      anchorElement.href = url;
      anchorElement.download = 'airtime-time-entries.csv';
      document.body.appendChild(anchorElement);
      anchorElement.click();
      anchorElement.remove();
      URL.revokeObjectURL(url);
      setNotice(`Exported ${rows} ${rows === 1 ? 'entry' : 'entries'} to CSV.`);
    } catch (exportError) {
      setError(
        exportError instanceof Error ? exportError.message : 'Export failed',
      );
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Timesheet</h1>
          <span className="sub">{range.label}</span>
        </div>
        <div className="filters">
          <div className="seg" role="group" aria-label="Range">
            <button
              type="button"
              aria-pressed={mode === 'week'}
              onClick={() => setMode('week')}
            >
              Week
            </button>
            <button
              type="button"
              aria-pressed={mode === 'month'}
              onClick={() => setMode('month')}
            >
              Month
            </button>
          </div>
          <button
            type="button"
            className="btn"
            aria-label="Previous period"
            onClick={() => setAnchor((current) => shiftPeriod(current, mode, -1))}
          >
            ‹
          </button>
          <button
            type="button"
            className="btn"
            aria-label="Next period"
            onClick={() => setAnchor((current) => shiftPeriod(current, mode, 1))}
          >
            ›
          </button>
          {canExport ? (
            <button
              type="button"
              className="btn"
              onClick={() => void exportRange()}
              disabled={exporting}
            >
              {exporting ? 'Exporting…' : 'Export'}
            </button>
          ) : null}
          <button type="button" className="btn btn-primary" onClick={onBackfill}>
            Back-fill
          </button>
        </div>
      </div>

      {offline ? (
        <div className="banner banner-warning">
          Offline. Showing cached entries for this period; cost and uncosted
          totals need the server.
        </div>
      ) : null}
      {notice ? <div className="banner">{notice}</div> : null}

      {status === 'error' ? (
        <div className="banner banner-error">
          <div className="row-between">
            <span>{error}</span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setAnchor((current) => new Date(current))}
            >
              Retry
            </button>
          </div>
        </div>
      ) : null}

      {status === 'loading' ? (
        <div className="grid-cards">
          {[0, 1, 2, 3].map((index) => (
            <div className="card card-pad stack" key={index} style={{ gap: 8 }}>
              <span className="skel" style={{ width: '45%', height: 12 }} />
              <span className="skel" style={{ width: '70%', height: 20 }} />
            </div>
          ))}
        </div>
      ) : totals ? (
        <div className="grid-cards">
          <Metric
            label="Total"
            value={formatDuration(totals.totalMinutes)}
            detail={`${totals.entryCount} ${totals.entryCount === 1 ? 'entry' : 'entries'}`}
          />
          <Metric
            label="Billable"
            value={formatDuration(totals.billableMinutes)}
            detail={`${billableShare}% of total`}
          />
          <Metric
            label="Uncosted"
            value={offline ? '—' : formatDuration(totals.uncosted.minutes)}
            detail={offline ? 'needs the server' : 'excluded from cost'}
          />
          <Metric
            label="Cost"
            value={
              offline ? '—' : formatMoney(totals.cost, totals.currency, { compact: true })
            }
            detail={offline ? 'needs the server' : 'at internal cost levels'}
          />
        </div>
      ) : null}

      {status === 'ready' && summary ? (
        <section className="card">
          <div className="card-pad row-between">
            <h2>Entries</h2>
            <span className="muted small">
              {summary.entries.length}{' '}
              {summary.entries.length === 1 ? 'entry' : 'entries'}
            </span>
          </div>
          {summary.entries.length === 0 ? (
            <div className="empty">
              <p>No entries in this period.</p>
              <p className="small">Back-fill time for {range.label}.</p>
              <button
                type="button"
                className="btn btn-primary"
                onClick={onBackfill}
              >
                Back-fill time
              </button>
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Work item</th>
                  <th className="num">Duration</th>
                  <th>Billable</th>
                  <th className="num">Cost</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {summary.entries.map((entry: CostedTimeEntry) => (
                  <tr key={entry.id}>
                    <td className="mono">{formatDate(entry.started_at)}</td>
                    <td>
                      {workItemLabel(entry, workItems)}
                      {entry.source === 'timer' ? (
                        <>{' '}<Badge tone="brand">Timer</Badge></>
                      ) : null}
                    </td>
                    <td className="num mono">
                      {formatDuration(entry.duration_minutes)}
                    </td>
                    <td>
                      {entry.cost_uncosted || offline ? (
                        <Badge>Uncosted</Badge>
                      ) : (
                        <Badge tone="success">Billable</Badge>
                      )}
                    </td>
                    <td className="num">
                      {offline
                        ? '—'
                        : entry.cost !== null && entry.cost_currency
                          ? formatMoney(entry.cost, entry.cost_currency)
                          : '—'}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => setEditing(entry)}
                        aria-label={`Edit entry ${formatDate(entry.started_at)}`}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : null}

      {editing ? (
        <EntryDialog
          entry={editing}
          onClose={() => setEditing(null)}
          onSaved={(previous) => {
            setUndo({ id: editing.id, previous });
            setEditing(null);
          }}
        />
      ) : null}

      {undo ? (
        <div className="toast" role="status">
          <span className="grow">Entry updated.</span>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              const target = undo;
              setUndo(null);
              void updateEntry(target.id, target.previous);
            }}
          >
            Undo
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setUndo(null)}
            aria-label="Dismiss"
          >
            Dismiss
          </button>
        </div>
      ) : null}
    </div>
  );
}
