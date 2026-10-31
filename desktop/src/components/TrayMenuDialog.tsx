import { useState } from 'react';
import { useApp } from '../state/AppContext';
import { buildTrayPayload, type TrayAction } from '../lib/trayState';
import { trayMenuItems } from '../lib/trayMenu';
import { ModalDialog } from './ModalDialog';

/**
 * The tray menu inside the window (Ctrl+Alt+M). It lists the same state-aware actions
 * as the tray icon's menu and runs them through the same code (`useTrayActions`).
 */
export function TrayMenuDialog({
  onClose,
  onAction,
}: {
  onClose: () => void;
  onAction: (action: TrayAction) => void;
}) {
  const { timer, timerState, workItems, entries, queue, online } = useApp();
  // The dialog is a snapshot taken when it opens, like the menu the tray shows.
  const [opened] = useState(() => Date.now());
  const payload = buildTrayPayload({
    signedIn: true,
    online,
    timer,
    timerState,
    workItems,
    entries,
    queued: queue.length,
    now: opened,
  });
  const items = trayMenuItems(payload);

  return (
    <ModalDialog
      label="Tray menu"
      title="Tray menu"
      subtitle={<span className="muted small">The same actions as the tray icon</span>}
      onClose={onClose}
      initialFocus="button.menu-item:not(:disabled)"
    >
      <p className="small" role="status">
        <strong>{payload.status.charAt(0).toUpperCase() + payload.status.slice(1)}</strong>
        {payload.headline ? ` · ${payload.headline}` : ''}
        {payload.detail ? (
          <>
            <br />
            <span className="muted">{payload.detail}</span>
          </>
        ) : null}
      </p>
      <div className="stack" role="group" aria-label="Tray actions">
        {items.map((item) => (
          <button
            key={item.action}
            type="button"
            className="btn menu-item"
            disabled={!item.enabled}
            onClick={() => {
              onClose();
              onAction(item.action);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </ModalDialog>
  );
}
