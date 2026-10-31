import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { matchesBinding } from '../lib/shortcuts';
import { KeyCaps } from './KeyCaps';
import { useShortcuts } from '../state/ShortcutsContext';

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A modal dialog that keeps the keyboard inside it: focus moves in on open, Tab
 * cycles within the innermost dialog, Escape closes it, the "save" shortcut
 * (Ctrl+Enter by default) runs `onSubmit`, and focus returns to where it was.
 * `initialFocus` is a selector inside the dialog; the first focusable element is
 * used when it matches nothing.
 */
export function ModalDialog({
  label,
  title,
  subtitle,
  onClose,
  onSubmit,
  initialFocus,
  children,
}: {
  label: string;
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  onSubmit?: () => void;
  initialFocus?: string;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const { bindings } = useShortcuts();

  useEffect(() => {
    const previous = document.activeElement;
    const dialog = dialogRef.current;
    const target =
      (initialFocus ? dialog?.querySelector<HTMLElement>(initialFocus) : null) ??
      dialog?.querySelector<HTMLElement>(FOCUSABLE);
    target?.focus();
    return () => {
      if (previous instanceof HTMLElement && document.contains(previous)) {
        previous.focus();
      }
    };
  }, [initialFocus]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    // A confirmation nested in this dialog (role="alertdialog") handles its own
    // Escape and save; only Tab is shared, cycling inside the innermost one.
    const scope = target?.closest<HTMLElement>('[role="dialog"], [role="alertdialog"]');
    const own = scope === dialogRef.current;
    if (own && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (own && onSubmit && matchesBinding(event.nativeEvent, bindings.save)) {
      event.preventDefault();
      event.stopPropagation();
      onSubmit();
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }
    const nodes = Array.from(scope?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (!first || !last) {
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="section-title">
          <div>
            <h2>{title}</h2>
            {subtitle}
          </div>
          <button type="button" className="btn btn-sm" onClick={onClose}>
            Close
          </button>
        </div>
        {children}
        {onSubmit ? (
          <p className="muted small row" style={{ gap: 6 }}>
            <KeyCaps binding={bindings.save} /> saves
          </p>
        ) : null}
      </div>
    </div>
  );
}
