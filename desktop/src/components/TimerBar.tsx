import { useEffect, useState } from 'react';
import { useApp } from '../state/AppContext';
import { formatElapsed } from '../lib/format';
import { Badge } from './ui';

export function TimerBar() {
  const { timer, timerPending, workItems, startTimer, stopTimer, online, queue, member } =
    useApp();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!timer) {
      return;
    }
    const handle = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(handle);
  }, [timer]);

  const item = timer?.work_item_id
    ? workItems.find((entry) => entry.plane_work_item_id === timer.work_item_id)
    : undefined;
  const label = item
    ? `${item.identifier ?? ''} · ${item.name}`.replace(/^ · /, '')
    : timer?.description ?? (timer ? 'Timer running' : 'No timer running');

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.altKey && event.key.toLowerCase() === 't') {
        event.preventDefault();
        if (timer) {
          void stopTimer();
        } else {
          const first = workItems[0];
          void startTimer(first?.plane_work_item_id ?? null);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [startTimer, stopTimer, timer, workItems]);

  return (
    <footer className="timerbar" role="region" aria-label="Timer">
      <span className="state">
        {timer ? 'Running' : 'Stopped'}
        {timer ? <span className="sr-only">, timer running</span> : null}
      </span>
      <span className="elapsed mono" aria-live="off">
        {timer ? formatElapsed(timer.started_at, now) : '00:00:00'}
      </span>
      <span className="workitem" title={label}>
        {label}
      </span>

      {!online ? <Badge tone="warning" icon="⚠">Offline</Badge> : null}
      {queue.length > 0 ? (
        <Badge tone="neutral">{queue.length} queued</Badge>
      ) : null}

      <span className="spacer" />
      <span className="hint">
        <kbd>Ctrl</kbd>
        <kbd>Alt</kbd>
        <kbd>T</kbd>
        {timer ? 'stop' : 'start'}
      </span>
      {timer ? (
        <button
          type="button"
          className="btn btn-danger"
          onClick={() => void stopTimer()}
          disabled={timerPending}
        >
          Stop &amp; save
        </button>
      ) : (
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void startTimer(workItems[0]?.plane_work_item_id ?? null)}
          disabled={timerPending || !member}
          title={
            workItems.length === 0
              ? 'No work items yet. Connect Plane in Settings.'
              : `Start on ${workItems[0]?.identifier ?? workItems[0]?.name ?? ''}`
          }
        >
          Start timer
        </button>
      )}
    </footer>
  );
}
