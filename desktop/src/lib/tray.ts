import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from './native';
import { isTrayAction, type TrayAction, type TrayPayload } from './trayState';

/** Tell the native tray what the timer bar shows. No-op outside the desktop shell. */
export async function setTrayState(payload: TrayPayload): Promise<void> {
  if (!isTauri) {
    return;
  }
  await invoke('set_tray_state', { payload });
}

/**
 * Subscribe to tray menu choices. Returns an unsubscribe function; outside the
 * desktop shell there is no tray, so it returns a no-op.
 */
export async function onTrayAction(handler: (action: TrayAction) => void): Promise<() => void> {
  if (!isTauri) {
    return () => {};
  }
  return listen<unknown>('tray-action', (event) => {
    if (isTrayAction(event.payload)) {
      handler(event.payload);
    }
  });
}
