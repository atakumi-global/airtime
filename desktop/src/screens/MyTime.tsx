import { useMemo, useState } from 'react';
import { useApp, type EntryUpdateInput } from '../state/AppContext';
import { Metric, Badge } from '../components/ui';
import { EntryDialog } from '../components/EntryDialog';
import {
  formatDayHeading,
  formatDuration,
  formatTime,
  startOfWeek,
} from '../lib/format';
import type { TimeEntry } from '../lib/types';

function groupByDay(entries: TimeEntry[]): Map<string, TimeEntry[]> {
  const groups = new Map<string, TimeEntry[]>();
  for (const entry of entries) {
    const key = new Date(entry.started_at).toDateString();
    const list = groups.get(key);
    if (list) {
      list.push(entry);
    } else {
      groups.set(key, [entry]);
    }
  }
  return groups;
}

export function MyTime({ onBackfill }: { onBackfill: () => void }) {
  const { entries, workItems, timer, organisation, online, updateEntry } =
    useApp();
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const [undo, setUndo] = useState<{
    id: string;
    previous: EntryUpdateInput;
  } | null>(null);

  const weekStart = startOfWeek().getTime();
  const today = new Date().toDateString();

  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return entries
      .filter((entry) => !needle || entrySourceLabel(entry, workItems).toLowerCase().includes(needle))
      .filter((entry) => new Date(entry.started_at).getTime() >= weekStart)
      .sort(
        (a, b) =>
          new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
      );
  }, [entries, filter, weekStart, workItems]);

  const todayEntries = filtered.filter(
    (entry) => new Date(entry.started_at).toDateString() === today,
  );
  const weekMinutes = filtered.reduce((sum, entry) => sum + entry.billable_minutes, 0);
  const weekActual = filtered.reduce((sum, entry) => sum + entry.duration_minutes, 0);
  const billableShare = weekActual > 0 ? Math.round((weekMinutes / weekActual) * 100) : 0;
  const uncostedMinutes = weekActual - weekMinutes;

  const groups = groupByDay(filtered);
  const sortedDays = [...groups.keys()].sort(
    (a, b) => new Date(b).getTime() - new Date(a).getTime(),
  );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>My time</h1>
          <span className="sub">
            Week of {startOfWeek().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
            {organisation ? ` · ${organisation.reportingCurrency}` : ''}
          </span>
        </div>
        <div className="filters">
          <input
            className="input"
            style={{ width: 200 }}
            placeholder="Filter entries"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          <button type="button" className="btn btn-primary" onClick={onBackfill}>
            Back-fill time
          </button>
        </div>
      </div>

      {!online ? (
        <div className="banner banner-warning">
          Offline. Showing cached entries; new time is queued until the server is
          reachable.
        </div>
      ) : null}

      <div className="grid-cards">
        <Metric
          label="Today"
          value={formatDuration(
            todayEntries.reduce((sum, entry) => sum + entry.duration_minutes, 0),
          )}
          detail={`${todayEntries.length} ${todayEntries.length === 1 ? 'entry' : 'entries'}`}
        />
        <Metric
          label="This week"
          value={formatDuration(weekActual)}
          detail={`${filtered.length} ${filtered.length === 1 ? 'entry' : 'entries'}`}
        />
        <Metric
          label="Billable"
          value={`${billableShare}%`}
          detail={formatDuration(weekMinutes)}
        />
        <Metric
          label="Uncosted"
          value={formatDuration(Math.max(0, uncostedMinutes))}
          detail={timer ? 'Timer running' : 'No timer running'}
        />
      </div>

      <section className="card">
        <div className="card-pad row-between">
          <h2>Entries</h2>
          {timer ? <Badge tone="brand">1 running</Badge> : null}
        </div>
        {filtered.length === 0 ? (
          <div className="empty">
            <p>No entries this week.</p>
            <p className="small">
              Pick a work item and press Start, or back-fill time you forgot.
            </p>
            <button type="button" className="btn btn-primary" onClick={onBackfill}>
              Start tracking
            </button>
          </div>
        ) : (
          sortedDays.map((day) => {
            const dayEntries = groups.get(day) ?? [];
            const dayMinutes = dayEntries.reduce(
              (sum, entry) => sum + entry.duration_minutes,
              0,
            );
            return (
              <div key={day}>
                <div className="card-pad day-head">
                  <strong>{formatDayHeading(new Date(day).toISOString(), new Date().toISOString())}</strong>
                  <span className="muted small">{formatDuration(dayMinutes)}</span>
                </div>
                {dayEntries.map((entry) => {
                  const item = entry.work_item_id
                    ? workItems.find(
                        (candidate) =>
                          candidate.plane_work_item_id === entry.work_item_id,
                      )
                    : undefined;
                  return (
                    <div className="entry" key={entry.id}>
                      <span className="entry-time mono">
                        {formatTime(entry.started_at)}
                      </span>
                      <div className="entry-main">
                        <span className="entry-title">
                          {item
                            ? `${item.identifier ? `${item.identifier} · ` : ''}${item.name}`
                            : entry.description ?? 'No work item'}
                        </span>
                        <span className="entry-meta">
                          <Badge tone={entry.source === 'timer' ? 'brand' : 'neutral'}>
                            {entry.source === 'timer' ? 'Timer' : 'Manual'}
                          </Badge>
                          <span>Billable {formatDuration(entry.billable_minutes)}</span>
                        </span>
                      </div>
                      <span className="entry-amount">
                        {formatDuration(entry.duration_minutes)}
                      </span>
                      <span className="entry-actions">
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => setEditing(entry)}
                          aria-label={`Edit entry ${formatTime(entry.started_at)}`}
                        >
                          Edit
                        </button>
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
      </section>

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

function entrySourceLabel(
  entry: TimeEntry,
  workItems: { plane_work_item_id: string; name: string; identifier: string | null }[],
): string {
  const item = entry.work_item_id
    ? workItems.find((candidate) => candidate.plane_work_item_id === entry.work_item_id)
    : undefined;
  return [item?.identifier, item?.name, entry.description].filter(Boolean).join(' ');
}
