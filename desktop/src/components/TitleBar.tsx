import { useEffect, useState } from 'react';
import { useApp } from '../state/AppContext';
import { isTauri } from '../lib/native';
import { formatTimerElapsed } from '../lib/format';
import {
  closeWindow,
  isWindowMaximized,
  minimizeWindow,
  onWindowResized,
  toggleMaximizeWindow,
} from '../lib/windowChrome';

/** Mini-timer shown while a timer is running or paused. */
function MiniTimer() {
  const { timer, timerState } = useApp();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (timerState !== 'running') {
      return;
    }
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const handle = window.setInterval(tick, 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(handle);
    };
  }, [timerState]);

  if (!timer || timerState === 'idle') {
    return null;
  }
  const clock = formatTimerElapsed(timer, now);
  const paused = timerState === 'paused';
  return (
    <span
      className={`timermini ${paused ? 'timermini-paused' : ''}`}
      role="timer"
      aria-label={`${paused ? 'Timer paused' : 'Timer running'}, elapsed ${clock}`}
    >
      <span className="timermini-mark" aria-hidden="true">
        {paused ? '\u23f8' : '\u25b6'}
      </span>
      <span className="mono" aria-hidden="true">
        {clock}
      </span>
    </span>
  );
}

/**
 * Custom 36px title bar (v2 shell spec): drag region, live mini-timer and the three
 * window controls. Close hides to the tray. Only rendered inside the desktop shell,
 * where the native frame is switched off.
 */
export function TitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | null = null;
    const sync = () => {
      isWindowMaximized()
        .then((value) => {
          if (active) {
            setMaximized(value);
          }
        })
        .catch(() => {});
    };
    sync();
    onWindowResized(sync)
      .then((stop) => {
        if (active) {
          unlisten = stop;
        } else {
          stop();
        }
      })
      .catch(() => {});
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  if (!isTauri) {
    return null;
  }

  return (
    <div className="titlebar" data-tauri-drag-region>
      <span className="titlebar-mark" aria-hidden="true" data-tauri-drag-region>
        A
      </span>
      <span className="titlebar-title" data-tauri-drag-region>
        Airtime
      </span>
      <MiniTimer />
      <span className="titlebar-actions">
        <button
          type="button"
          className="wc"
          title="Minimise"
          aria-label="Minimise"
          onClick={() => void minimizeWindow().catch(() => {})}
        >
          <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
            <path d="M2 6h8" />
          </svg>
        </button>
        <button
          type="button"
          className="wc"
          title={maximized ? 'Restore' : 'Maximise'}
          aria-label={maximized ? 'Restore' : 'Maximise'}
          onClick={() => void toggleMaximizeWindow().catch(() => {})}
        >
          <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
            {maximized ? (
              <path d="M3.5 3.5v-1h6v6h-1M2.5 3.5h6v6h-6z" />
            ) : (
              <path d="M2.5 2.5h7v7h-7z" />
            )}
          </svg>
        </button>
        <button
          type="button"
          className="wc wc-close"
          title="Close to tray"
          aria-label="Close to tray"
          onClick={() => void closeWindow().catch(() => {})}
        >
          <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
            <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
          </svg>
        </button>
      </span>
    </div>
  );
}
