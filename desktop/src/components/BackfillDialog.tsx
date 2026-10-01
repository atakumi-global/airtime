import { useState } from 'react';
import { useApp } from '../state/AppContext';
import { durationError, parseDuration } from '../lib/format';
import { DurationInput } from './DurationInput';
import { Field } from './ui';

export function BackfillDialog({ onClose }: { onClose: () => void }) {
  const { workItems, addManualEntry } = useApp();
  const [workItemId, setWorkItemId] = useState(workItems[0]?.plane_work_item_id ?? '');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [duration, setDuration] = useState('1h');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const minutes = parseDuration(duration);
    if (minutes === null || minutes <= 0) {
      setError(durationError(duration));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await addManualEntry({
        workItemId: workItemId || null,
        date,
        durationMinutes: minutes,
        description: description || null,
      });
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not save entry');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Back-fill time"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="section-title">
          <h2>Back-fill time</h2>
          <button type="button" className="btn btn-sm" onClick={onClose}>
            Close
          </button>
        </div>

        <Field label="Work item">
          <select
            className="select"
            value={workItemId}
            onChange={(event) => setWorkItemId(event.target.value)}
          >
            <option value="">No work item</option>
            {workItems.map((item) => (
              <option key={item.id} value={item.plane_work_item_id}>
                {item.identifier ? `${item.identifier} · ` : ''}
                {item.name}
              </option>
            ))}
          </select>
        </Field>

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
            <Field label="Duration">
              <DurationInput
                id="backfill-duration"
                value={duration}
                onChange={setDuration}
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

        {error ? <div className="banner banner-error">{error}</div> : null}

        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void submit()}
            disabled={saving || durationError(duration) !== null}
          >
            {saving ? 'Saving…' : 'Save entry'}
          </button>
        </div>
      </div>
    </div>
  );
}
