import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  bindingError,
  defaultBindings,
  findConflict,
  keyCaps,
  loadOverrides,
  matchesBinding,
  resolveBindings,
  saveOverrides,
  shortcutDef,
  type Binding,
  type Bindings,
  type Overrides,
  type ShortcutId,
} from '../lib/shortcuts';

type ShortcutsValue = {
  bindings: Bindings;
  /** Rebind one shortcut. Returns why it was refused, or null when it was saved. */
  setBinding: (id: ShortcutId, binding: Binding) => string | null;
  resetBinding: (id: ShortcutId) => void;
  resetAll: () => void;
  isCustom: (id: ShortcutId) => boolean;
  /** True while Settings listens for a new combination; no shortcut may fire then. */
  capturing: boolean;
  setCapturing: (capturing: boolean) => void;
};

const DEFAULT_VALUE: ShortcutsValue = {
  bindings: defaultBindings(),
  setBinding: () => 'Shortcuts cannot be changed here.',
  resetBinding: () => {},
  resetAll: () => {},
  isCustom: () => false,
  capturing: false,
  setCapturing: () => {},
};

const ShortcutsContext = createContext<ShortcutsValue>(DEFAULT_VALUE);

/** Holds the shortcut bindings and stores the user's rebindings on this device. */
export function ShortcutsProvider({ children }: { children: ReactNode }) {
  const [overrides, setOverrides] = useState<Overrides>(() => loadOverrides());
  const [capturing, setCapturing] = useState(false);
  const bindings = useMemo(() => resolveBindings(overrides), [overrides]);

  const commit = useCallback((next: Overrides) => {
    setOverrides(next);
    saveOverrides(next);
  }, []);

  const setBinding = useCallback(
    (id: ShortcutId, binding: Binding): string | null => {
      const invalid = bindingError(binding);
      if (invalid) {
        return invalid;
      }
      const conflict = findConflict(bindings, id, binding);
      if (conflict) {
        return `${keyCaps(binding).join('+')} is already used for "${shortcutDef(conflict).label}".`;
      }
      commit({ ...overrides, [id]: binding });
      return null;
    },
    [bindings, commit, overrides],
  );

  const resetBinding = useCallback(
    (id: ShortcutId) => {
      const next = { ...overrides };
      delete next[id];
      commit(next);
    },
    [commit, overrides],
  );

  const resetAll = useCallback(() => commit({}), [commit]);

  const isCustom = useCallback((id: ShortcutId) => overrides[id] !== undefined, [overrides]);

  const value = useMemo(
    () => ({
      bindings,
      setBinding,
      resetBinding,
      resetAll,
      isCustom,
      capturing,
      setCapturing,
    }),
    [bindings, setBinding, resetBinding, resetAll, isCustom, capturing],
  );

  return <ShortcutsContext.Provider value={value}>{children}</ShortcutsContext.Provider>;
}

export function useShortcuts(): ShortcutsValue {
  return useContext(ShortcutsContext);
}

/** True while a modal dialog is on screen. */
export function modalOpen(): boolean {
  return document.querySelector('[aria-modal="true"]') !== null;
}

/**
 * Run `handler` when the shortcut's current binding is pressed anywhere in the
 * window. Navigation shortcuts stay quiet while a dialog is open; pass
 * `whenModalOpen` for the ones that belong to it (timer, save).
 */
export function useShortcut(
  id: ShortcutId,
  handler: () => void,
  options: { whenModalOpen?: boolean; enabled?: boolean } = {},
): void {
  const { bindings, capturing } = useShortcuts();
  const binding = bindings[id];
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  const { whenModalOpen = false, enabled = true } = options;

  useEffect(() => {
    if (!enabled || capturing) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || !matchesBinding(event, binding)) {
        return;
      }
      if (!whenModalOpen && modalOpen()) {
        return;
      }
      event.preventDefault();
      latest.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [binding, capturing, enabled, whenModalOpen]);
}
