import type { TrayAction, TrayPayload } from './trayState';

export type TrayMenuItem = {
  action: TrayAction;
  label: string;
  enabled: boolean;
};

/**
 * The tray menu's actions for the reported state, in the order the native tray
 * shows them (see `src-tauri/src/tray/model.rs`), so the in-window copy never
 * disagrees with the tray.
 */
export function trayMenuItems(payload: TrayPayload): TrayMenuItem[] {
  const item = (action: TrayAction, label: string, enabled = true): TrayMenuItem => ({
    action,
    label,
    enabled,
  });
  const items: TrayMenuItem[] = [];
  switch (payload.status) {
    case 'idle':
      items.push(item('start-last', 'Start last work item', payload.canStart));
      break;
    case 'running':
      items.push(item('pause', 'Pause timer'), item('stop', 'Stop timer'));
      break;
    case 'paused':
      items.push(item('resume', 'Resume timer'), item('stop', 'Stop timer'));
      break;
    case 'error':
      items.push(item('retry', 'Retry sync now'));
      items.push(
        payload.hasTimer
          ? item('stop', 'Stop timer')
          : item('start-last', 'Start last work item', payload.canStart),
      );
      break;
  }
  items.push(
    item('backfill', 'Back-fill time'),
    item('timesheet', 'Timesheet'),
    item('settings', 'Settings'),
  );
  return items;
}
