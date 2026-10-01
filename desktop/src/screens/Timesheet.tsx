import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  useApp,
  type EntryUpdateInput,
  type ManualEntryInput,
} from '../state/AppContext';
import { Metric, Badge } from '../components/ui';
import { EntryDialog } from '../components/EntryDialog';
import { DurationInput } from '../components/DurationInput';
import { NetworkError } from '../lib/api';
import {
  billableMinutes,
  dateInputValue,
  durationError,
  formatDate,
  formatDuration,
  formatMoney,
  parseDuration,
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

type DraftRow = {
  key: string;
  date: string;
  workItemId: string;
  duration: string;
};

function workItemLabel(entry: TimeEntry, workItems: WorkItem[]): string {
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
  const billableTotal = inRange.reduce(
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
      billableMinutes: billableTotal,
      cost: 0,
      currency,
      currencyTotals: {},
      conversions: {},
      fxStale: false,
      fxDate: null,
      uncosted: { entries: inRange.length, minutes: billableTotal },
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
    addManualEntries,
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
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [bulkNotice, setBulkNotice] = useState<string | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const pendingFocusRef = useRef<string | null>(null);

  const range = periodRange(mode, anchor);
  const canExport = member?.role === 'manager' || member?.role === 'administrator';

  useEffect(() => {
    let cancelled = false;
    const activeRange = periodRange(mode, anchor);
    const run = async () => {
      setStatus((current) => (current === 'ready' ? current : 'loading'));
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
          loadError instanceof Error
            ? loadError.message
            : 'Could not load the timesheet',
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

  const addDraft = (options: { date?: string; workItemId?: string } = {}) => {
    const row: DraftRow = {
      key: crypto.randomUUID(),
      date: options.date ?? dateInputValue(new Date().toISOString()),
      workItemId: options.workItemId ?? '',
      duration: '',
    };
    pendingFocusRef.current = row.key;
    setDrafts((current) => [...current, row]);
  };

  const updateDraft = (key: string, patch: Partial<DraftRow>) => {
    setDrafts((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  };

  const removeDraft = (key: string) => {
    setDrafts((current) => current.filter((row) => row.key !== key));
    setRowErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const saveDrafts = async (rowsToSave: DraftRow[], nextWorkItemId?: string) => {
    setBulkError(null);
    setBulkNotice(null);
    const valid: Array<{ row: DraftRow; input: ManualEntryInput }> = [];
    for (const row of rowsToSave) {
      const minutes = parseDuration(row.duration);
      if (durationError(row.duration) !== null || minutes === null || !row.date) {
        continue;
      }
      valid.push({
        row,
        input: {
          workItemId: row.workItemId || null,
          date: row.date,
          durationMinutes: minutes,
        },
      });
    }
    if (valid.length === 0) {
      setBulkError(
        rowsToSave.some((row) => row.duration.trim() === '')
          ? 'Enter a duration before saving.'
          : 'Fix the highlighted duration before saving.',
      );
      return;
    }
    setSaving(true);
    try {
      const result = await addManualEntries(valid.map((pair) => pair.input));
      const failedByInput = new Map(
        result.failed.map((failure) => [failure.input, failure.message]),
      );
      const savedKeys = new Set(
        valid
          .filter((pair) => !failedByInput.has(pair.input))
          .map((pair) => pair.row.key),
      );
      setDrafts((current) => current.filter((row) => !savedKeys.has(row.key)));
      const nextErrors: Record<string, string> = {};
      for (const pair of valid) {
        const message = failedByInput.get(pair.input);
        if (message) {
          nextErrors[pair.row.key] = message;
        }
      }
      setRowErrors((current) => ({ ...current, ...nextErrors }));
      const parts: string[] = [];
      if (result.saved > 0) {
        parts.push(
          `${result.saved} ${result.saved === 1 ? 'entry' : 'entries'} saved`,
        );
      }
      if (result.queued > 0) {
        parts.push(
          `${result.queued} ${result.queued === 1 ? 'entry' : 'entries'} queued offline`,
        );
      }
      if (result.failed.length > 0) {
        parts.push(
          `${result.failed.length} ${result.failed.length === 1 ? 'row' : 'rows'} failed`,
        );
      }
      const skipped = rowsToSave.length - valid.length;
      if (skipped > 0) {
        parts.push(
          `${skipped} ${skipped === 1 ? 'row needs' : 'rows need'} a duration`,
        );
      }
      if (parts.length > 0) {
        setBulkNotice(`${parts.join(' · ')}.`);
      }
      if (
        rowsToSave.length === 1 &&
        savedKeys.has(rowsToSave[0].key)
      ) {
        addDraft({
          date: rowsToSave[0].date,
          workItemId: nextWorkItemId,
        });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleRowKeyDown = (
    event: KeyboardEvent<HTMLElement>,
    row: DraftRow,
  ) => {
    if (event.key !== 'Enter') {
      return;
    }
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      void saveDrafts(drafts);
      return;
    }
    void saveDrafts([row], event.shiftKey ? row.workItemId : undefined);
  };

  const validDrafts = drafts.filter(
    (row) => durationError(row.duration) === null && row.date,
  );

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
          <h1>My time</h1>
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
              offline
                ? '—'
                : formatMoney(totals.cost, totals.currency, { compact: true })
            }
            detail={offline ? 'needs the server' : 'at internal cost levels'}
          />
        </div>
      ) : null}

      {status === 'ready' && summary ? (
        <section className="card">
          <div className="card-pad row-between">
            <h2>Bulk entry</h2>
            <span className="muted small">
              Type a duration, press Tab, repeat. Enter saves the row.
            </span>
          </div>
          {summary.entries.length === 0 && drafts.length === 0 ? (
            <div className="empty">
              <p>No entries in this period.</p>
              <p className="small">
                Add a row below, or back-fill time for {range.label}.
              </p>
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
                  <th>Duration</th>
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
                        <>
                          {' '}
                          <Badge tone="brand">Timer</Badge>
                        </>
                      ) : null}
                    </td>
                    <td className="mono">
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
                {drafts.map((row) => {
                  const minutes = parseDuration(row.duration);
                  const draftValid = minutes !== null && minutes > 0;
                  return (
                    <tr key={row.key}>
                      <td>
                        <input
                          className="input mono"
                          type="date"
                          value={row.date}
                          ref={(element) => {
                            if (element && pendingFocusRef.current === row.key) {
                              pendingFocusRef.current = null;
                              element.focus();
                            }
                          }}
                          onChange={(event) =>
                            updateDraft(row.key, { date: event.target.value })
                          }
                          onKeyDown={(event) => handleRowKeyDown(event, row)}
                          aria-label="Date"
                        />
                      </td>
                      <td>
                        <select
                          className="select"
                          value={row.workItemId}
                          onChange={(event) =>
                            updateDraft(row.key, {
                              workItemId: event.target.value,
                            })
                          }
                          onKeyDown={(event) => handleRowKeyDown(event, row)}
                          aria-label="Work item"
                        >
                          <option value="">No work item</option>
                          {workItems.map((item) => (
                            <option key={item.id} value={item.plane_work_item_id}>
                              {item.identifier ? `${item.identifier} · ` : ''}
                              {item.name}
                            </option>
                          ))}
                        </select>
                        {rowErrors[row.key] ? (
                          <span className="err">{rowErrors[row.key]}</span>
                        ) : null}
                      </td>
                      <td>
                        <DurationInput
                          id={`draft-${row.key}`}
                          value={row.duration}
                          onChange={(value) =>
                            updateDraft(row.key, { duration: value })
                          }
                          onKeyDown={(event) => handleRowKeyDown(event, row)}
                        />
                      </td>
                      <td className="mono">
                        {draftValid ? formatDuration(billableMinutes(minutes)) : '—'}
                      </td>
                      <td className="num muted">—</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => removeDraft(row.key)}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <div className="card-pad row-between">
            <div className="row">
              <button
                type="button"
                className="btn"
                onClick={() => addDraft()}
              >
                Add row
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void saveDrafts(drafts)}
                disabled={saving || validDrafts.length === 0}
              >
                {saving
                  ? 'Saving…'
                  : `Save ${validDrafts.length} ${validDrafts.length === 1 ? 'entry' : 'entries'}`}
              </button>
            </div>
            <span className="muted small">
              Tab moves across Date, Work item, Duration, Billable, Cost.
              Ctrl+Enter saves.
            </span>
          </div>
          {bulkNotice ? (
            <div className="card-pad">
              <span className="small muted">{bulkNotice}</span>
            </div>
          ) : null}
          {bulkError ? (
            <div className="card-pad">
              <span className="err">{bulkError}</span>
            </div>
          ) : null}
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
