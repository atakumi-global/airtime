import { useEffect, useState } from 'react';
import { useApp, type EntryUpdateInput } from '../state/AppContext';
import { dateInputValue, formatDuration, rescheduleEntry } from '../lib/format';
import type { EntryHistoryEvent, TimeEntry } from '../lib/types';
import { Badge, Field } from './ui';

const ACTION_LABEL: Record<string, string> = {
  created: 'Entry created',
  updated: 'Entry updated',
  deleted: 'Entry deleted',
};

function actionLabel(action: string): string {
  return ACTION_LABEL[action] ?? action;
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function EntryDialog({
  entry,
  onClose,
  onSaved,
}: {
  entry: TimeEntry;
  onClose: () => void;
  onSaved: (previous: EntryUpdateInput) => void;
}) {
  const { member, updateEntry, deleteEntry, entryHistory } = useApp();
  const [date, setDate] = useState(() => dateInputValue(entry.started_at));
  const [duration, setDuration] = useState(String(entry.duration_minutes));
  const [description, setDescription] = useState(entry.description ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [history, setHistory] = useState<EntryHistoryEvent[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    let cancelled = false;
    entryHistory(entry.id)
      .then((events) => {
        if (!cancelled) {
          setHistory(events);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setHistoryError(
            loadError instanceof Error ? loadError.message : 'Could not load history',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [entry.id, entryHistory]);

  const submit = async () => {
    setError(null);
    let times;
    try {
      times = rescheduleEntry(entry, date, Number(duration));
    } catch (validationError) {
      setError(
        validationError instanceof Error ? validationError.message : 'Invalid entry',
      );
      return;
    }
    setSaving(true);
    try {
      await updateEntry(entry.id, {
        startedAt: times.startedAt,
        endedAt: times.endedAt,
        description: description || null,
      });
      onSaved({
        startedAt: entry.started_at,
        endedAt: entry.ended_at,
        description: entry.description,
      });
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : 'Could not save entry',
      );
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    setError(null);
    try {
      await deleteEntry(entry.id);
      onClose();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : 'Could not delete entry',
      );
      setDeleting(false);
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Edit entry"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="section-title">
          <h2>Edit entry</h2>
          <button type="button" className="btn btn-sm" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <Field label="Date">
              <input
                className="input"
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </Field>
          </div>
          <div style={{ flex: 1 }}>
            <Field label="Duration (minutes)">
              <input
                className="input"
                type="number"
                min={1}
                value={duration}
                onChange={(event) => setDuration(event.target.value)}
              />
            </Field>
          </div>
        </div>

        <Field label="Note" hint="Optional. Never sent to Plane.">
          <input
            className="input"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What did you work on?"
          />
        </Field>

        <p className="muted small">
          Changing the duration updates project cost immediately.
        </p>

        {error ? (
          <div className="banner banner-error" role="alert">
            {error}
          </div>
        ) : null}

        <div className="row-between">
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => setConfirmDelete(true)}
            disabled={saving || deleting}
          >
            Delete
          </button>
          <div className="row">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void submit()}
              disabled={saving || deleting}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>

        <div className="row-between">
          <button
            type="button"
            className="btn btn-sm"
            aria-expanded={showHistory}
            onClick={() => setShowHistory((value) => !value)}
          >
            {showHistory ? 'Hide history' : 'History'}
          </button>
          <span className="muted small">
            Billable {formatDuration(entry.billable_minutes)}
          </span>
        </div>

        {showHistory ? (
          <div className="history">
            {historyError ? (
              <p className="muted small">{historyError}</p>
            ) : history.length === 0 ? (
              <p className="muted small">No changes recorded yet.</p>
            ) : (
              history.map((event) => (
                <div className="history-item" key={event.id}>
                  <Badge
                    tone={
                      event.action === 'deleted'
                        ? 'danger'
                        : event.action === 'created'
                          ? 'brand'
                          : 'neutral'
                    }
                  >
                    {actionLabel(event.action)}
                  </Badge>
                  <span className="small">
                    {event.actor_member_id === member?.id
                      ? 'You'
                      : `Member ${event.actor_member_id.slice(0, 8)}`}
                  </span>
                  <span className="muted small">{formatTimestamp(event.created_at)}</span>
                </div>
              ))
            )}
            <p className="muted small">
              Before and after values, author and timestamp are retained and visible
              to managers.
            </p>
          </div>
        ) : null}

        {confirmDelete ? (
          <div className="dialog-backdrop" role="presentation">
            <div
              className="dialog"
              role="alertdialog"
              aria-modal="true"
              aria-label="Delete entry"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="section-title">
                <h2>Delete this entry?</h2>
              </div>
              <p className="small muted">
                The entry leaves the project cost and is recorded in the history with
                your name and the time.
              </p>
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setConfirmDelete(false)}
                  disabled={deleting}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => void remove()}
                  disabled={deleting}
                >
                  {deleting ? 'Deleting…' : 'Delete entry'}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
