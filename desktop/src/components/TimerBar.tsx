import { useEffect, useState } from 'react';
import { useApp } from '../state/AppContext';
import { formatTimerElapsed } from '../lib/format';
import { enterable } from '../lib/workItemSearch';
import { useShortcut, useShortcuts } from '../state/ShortcutsContext';
import { shortcutAria, ShortcutHint } from './KeyCaps';
import { Badge } from './ui';

export function TimerBar() {
  const {
    timer,
    timerState,
    timerPending,
    workItems: allWorkItems,
    startTimer,
    pauseTimer,
    resumeTimer,
    stopTimer,
    online,
    queue,
    member,
  } = useApp();
  const [now, setNow] = useState(() => Date.now());
  // A running timer may sit on a history-only item; only new starts are limited.
  const workItems = enterable(allWorkItems);

  useEffect(() => {
    if (timerState !== 'running') {
      return;
    }
    const handle = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(handle);
  }, [timerState]);

  const item = timer?.work_item_id
    ? allWorkItems.find((entry) => entry.plane_work_item_id === timer.work_item_id)
    : undefined;
  const label = item
    ? `${item.identifier ?? ''} · ${item.name}`.replace(/^ · /, '')
    : timer?.description ??
      (timerState === 'paused'
        ? 'Timer paused'
        : timer
          ? 'Timer running'
          : 'No timer running');

  const { bindings } = useShortcuts();
  useShortcut(
    'timer',
    () => {
      if (timer) {
        void stopTimer();
      } else {
        const first = workItems[0];
        void startTimer(first?.plane_work_item_id ?? null);
      }
    },
    { whenModalOpen: true },
  );

  const stateWord =
    timerState === 'paused' ? 'Paused' : timerState === 'running' ? 'Running' : 'Stopped';
  const elapsedText = timer ? formatTimerElapsed(timer, now) : '00:00:00';

  return (
    <footer
      className={`timerbar timerbar-${timerState}`}
      role="region"
      aria-label="Timer"
      data-timer-state={timerState}
    >
      <span className="state">
        {timerState === 'paused' ? (
          <span className="flag-paused">
            <span aria-hidden="true">⏸</span> Paused
          </span>
        ) : (
          stateWord
        )}
        {timerState === 'running' ? <span className="sr-only">, timer running</span> : null}
        {timerState === 'paused' ? <span className="sr-only">, timer paused</span> : null}
      </span>
      <span className="elapsed mono" role="timer" aria-live="off" aria-label={`Elapsed time ${elapsedText}`}>
        {elapsedText}
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
        <ShortcutHint id="timer" domId="shortcut-timer-hint" />
        {timer ? 'stop' : 'start'}
      </span>
      {timerState === 'running' ? (
        <button
          type="button"
          className="btn btn-icon"
          onClick={() => void pauseTimer()}
          disabled={timerPending}
          aria-label="Pause timer"
          title="Pause timer"
        >
          <span aria-hidden="true">⏸</span>
        </button>
      ) : null}
      {timerState === 'paused' ? (
        <button
          type="button"
          className="btn"
          onClick={() => void resumeTimer()}
          disabled={timerPending}
        >
          <span aria-hidden="true">▶</span> Resume
        </button>
      ) : null}
      {timer ? (
        <button
          type="button"
          className="btn btn-danger"
          onClick={() => void stopTimer()}
          disabled={timerPending}
          {...shortcutAria(bindings, 'timer', 'shortcut-timer-hint')}
        >
          Stop &amp; save
        </button>
      ) : (
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void startTimer(workItems[0]?.plane_work_item_id ?? null)}
          disabled={timerPending || !member}
          {...shortcutAria(bindings, 'timer', 'shortcut-timer-hint')}
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
