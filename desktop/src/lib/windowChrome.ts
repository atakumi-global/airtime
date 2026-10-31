import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauri } from './native';

/** Window controls for the custom title bar. All are no-ops outside the desktop shell. */
export async function minimizeWindow(): Promise<void> {
  if (isTauri) {
    await getCurrentWindow().minimize();
  }
}

export async function toggleMaximizeWindow(): Promise<void> {
  if (isTauri) {
    await getCurrentWindow().toggleMaximize();
  }
}

/** Requests close; the shell turns this into hide-to-tray (see src-tauri/src/tray). */
export async function closeWindow(): Promise<void> {
  if (isTauri) {
    await getCurrentWindow().close();
  }
}

export async function isWindowMaximized(): Promise<boolean> {
  return isTauri ? getCurrentWindow().isMaximized() : false;
}

/** Calls `handler` whenever the window is resized; returns an unsubscribe function. */
export async function onWindowResized(handler: () => void): Promise<() => void> {
  if (!isTauri) {
    return () => {};
  }
  return getCurrentWindow().onResized(handler);
}
