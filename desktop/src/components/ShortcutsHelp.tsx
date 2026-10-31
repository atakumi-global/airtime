import { SHORTCUTS, announce } from '../lib/shortcuts';
import { useShortcuts } from '../state/ShortcutsContext';
import { KeyCaps } from './KeyCaps';
import { ModalDialog } from './ModalDialog';

/** Help, then Keyboard shortcuts: every shortcut with its current keys. */
export function ShortcutsHelp({
  onClose,
  onOpenSettings,
}: {
  onClose: () => void;
  onOpenSettings: () => void;
}) {
  const { bindings, isCustom } = useShortcuts();
  return (
    <ModalDialog
      label="Keyboard shortcuts"
      title="Keyboard shortcuts"
      subtitle={<span className="muted small">Help, then Keyboard shortcuts</span>}
      onClose={onClose}
    >
      <table className="shortcut-table">
        <caption className="sr-only">
          Keyboard shortcuts and the keys that trigger them
        </caption>
        <thead>
          <tr>
            <th scope="col">Action</th>
            <th scope="col">Where it works</th>
            <th scope="col" className="keys">
              Keys
            </th>
          </tr>
        </thead>
        <tbody>
          {SHORTCUTS.map((def) => (
            <tr key={def.id} data-shortcut={def.id}>
              <th scope="row">
                {def.label}
                {isCustom(def.id) ? <span className="muted small"> (changed)</span> : null}
              </th>
              <td className="muted small">{def.where}</td>
              <td className="keys">
                <KeyCaps binding={bindings[def.id]} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">
        A screen reader announces each one as, for example, "
        {announce(SHORTCUTS[0]!, bindings.timer)}". Shortcuts work while Airtime is the
        focused window.
      </p>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button
          type="button"
          className="btn"
          onClick={() => {
            onClose();
            onOpenSettings();
          }}
        >
          Change shortcuts in Settings
        </button>
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Done
        </button>
      </div>
    </ModalDialog>
  );
}
