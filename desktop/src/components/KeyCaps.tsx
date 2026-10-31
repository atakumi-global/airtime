import {
  announce,
  ariaKeyShortcuts,
  keyCaps,
  shortcutDef,
  speakBinding,
  type Binding,
  type Bindings,
  type ShortcutId,
} from '../lib/shortcuts';
import { useShortcuts } from '../state/ShortcutsContext';

/**
 * A binding as key caps. Sighted users see the caps; a screen reader hears the
 * spoken form ("Control Alt T") once, so the caps themselves are hidden from it.
 */
export function KeyCaps({ binding }: { binding: Binding }) {
  return (
    <span className="keycaps">
      <span aria-hidden="true">
        {keyCaps(binding).map((cap) => (
          <kbd key={cap}>{cap}</kbd>
        ))}
      </span>
      <span className="sr-only">{speakBinding(binding)}</span>
    </span>
  );
}

/**
 * Visible key caps for a control that carries the shortcut, with the spoken form
 * in a hidden node the control points to through `aria-describedby`. Place it
 * inside the control and spread `shortcutAria(...)` on the control.
 */
export function ShortcutHint({ id, domId }: { id: ShortcutId; domId: string }) {
  const { bindings } = useShortcuts();
  return (
    <>
      <span className="keycaps" aria-hidden="true">
        {keyCaps(bindings[id]).map((cap) => (
          <kbd key={cap}>{cap}</kbd>
        ))}
      </span>
      <span id={domId} hidden>
        {`Shortcut: ${announce(shortcutDef(id), bindings[id])}`}
      </span>
    </>
  );
}

/** ARIA attributes for a control that triggers a shortcut and renders `ShortcutHint`. */
export function shortcutAria(
  bindings: Bindings,
  id: ShortcutId,
  domId: string,
): { 'aria-keyshortcuts': string; 'aria-describedby': string } {
  return {
    'aria-keyshortcuts': ariaKeyShortcuts(bindings[id]),
    'aria-describedby': domId,
  };
}
