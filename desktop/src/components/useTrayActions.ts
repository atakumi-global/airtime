import { useCallback } from 'react';
import { useApp } from '../state/AppContext';
import { lastWorkItem, type TrayAction } from '../lib/trayState';

/**
 * Runs a tray menu action against the app state. Shared by the native tray
 * (`TrayBridge`) and the in-window tray menu opened by its shortcut, so the two
 * can never do different things for the same choice.
 */
export function useTrayActions({
  onBackfill,
  onTimesheet,
  onSettings,
}: {
  onBackfill: () => void;
  onTimesheet: () => void;
  onSettings: () => void;
}): (action: TrayAction) => void {
  const {
    timer,
    workItems,
    entries,
    startTimer,
    pauseTimer,
    resumeTimer,
    stopTimer,
    refresh,
  } = useApp();

  return useCallback(
    (action: TrayAction) => {
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
    },
    [
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
    ],
  );
}
