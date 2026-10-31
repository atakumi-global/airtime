import { useEffect, useRef } from 'react';
import { useApp } from '../state/AppContext';
import { onTrayAction, setTrayState } from '../lib/tray';
import { buildTrayPayload, lastWorkItem, type TrayAction } from '../lib/trayState';

/** Re-report while a clock counts, so the tray cannot drift far from the timer bar. */
const RESYNC_MS = 30_000;

/**
 * Keeps the native tray in step with the timer bar and runs the tray menu's actions.
 * Renders nothing. Window destinations are handed to the shell via the callbacks.
 */
export function TrayBridge({
  onBackfill,
  onTimesheet,
  onSettings,
}: {
  onBackfill: () => void;
  onTimesheet: () => void;
  onSettings: () => void;
}) {
  const {
    status,
    timer,
    timerState,
    workItems,
    entries,
    queue,
    online,
    startTimer,
    pauseTimer,
    resumeTimer,
    stopTimer,
    refresh,
  } = useApp();

  const reported = useRef('');

  useEffect(() => {
    const report = () => {
      const payload = buildTrayPayload({
        signedIn: status === 'ready',
        online,
        timer,
        timerState,
        workItems,
        entries,
        queued: queue.length,
        now: Date.now(),
      });
      const key = JSON.stringify(payload);
      // Re-send a counting clock on every resync so a drifting tray is corrected.
      if (key === reported.current && !payload.clockRunning) {
        return;
      }
      reported.current = key;
      setTrayState(payload).catch(() => {
        // The tray is a convenience surface; a failed update must not break the app.
        reported.current = '';
      });
    };
    report();
    if (timerState !== 'running') {
      return;
    }
    const handle = window.setInterval(report, RESYNC_MS);
    return () => window.clearInterval(handle);
  }, [status, online, timer, timerState, workItems, entries, queue.length]);

  const latest = useRef<(action: TrayAction) => void>(() => {});
  useEffect(() => {
    latest.current = (action) => {
      if (status !== 'ready') {
        // Signed out or still loading: the window is shown, nothing else to run.
        return;
      }
      switch (action) {
        case 'start-last': {
          const last = lastWorkItem(entries, workItems);
          if (last && !timer) {
            void startTimer(last.plane_work_item_id);
          }
          break;
        }
        case 'pause':
          void pauseTimer();
          break;
        case 'resume':
          void resumeTimer();
          break;
        case 'stop':
          void stopTimer();
          break;
        case 'retry':
          void refresh();
          break;
        case 'backfill':
          onBackfill();
          break;
        case 'timesheet':
          onTimesheet();
          break;
        case 'settings':
          onSettings();
          break;
        case 'open':
          break;
      }
    };
  }, [
    status,
    entries,
    onBackfill,
    onSettings,
    onTimesheet,
    pauseTimer,
    refresh,
    resumeTimer,
    startTimer,
    stopTimer,
    timer,
    workItems,
  ]);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | null = null;
    onTrayAction((action) => latest.current(action))
      .then((stop) => {
        if (active) {
          unlisten = stop;
        } else {
          stop();
        }
      })
      .catch(() => {
        // No tray events in this environment; the in-window controls still work.
      });
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  return null;
}
