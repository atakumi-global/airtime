/**
 * The keyboard shortcut map (v2 shell design, "Shortcuts"): the defaults, how a
 * binding is matched, spoken and validated, and how a user's rebindings are stored.
 * Pure apart from `loadOverrides` and `saveOverrides`, which use the browser store.
 */

export type ShortcutId = 'timer' | 'backfill' | 'search' | 'timesheet' | 'tray' | 'save';

/** `key` is a normalised key name: `A`..`Z`, `0`..`9`, `Enter` or `F1`..`F12`. */
export type Binding = {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
};

export type ShortcutDef = {
  id: ShortcutId;
  /** Visible name, and the start of the screen reader announcement. */
  label: string;
  /** Where the shortcut works. */
  where: string;
  defaultBinding: Binding;
};

export const SHORTCUTS: readonly ShortcutDef[] = [
  {
    id: 'timer',
    label: 'Start or stop the timer',
    where: 'Anywhere in Airtime',
    defaultBinding: { ctrl: true, alt: true, shift: false, key: 'T' },
  },
  {
    id: 'backfill',
    label: 'Back-fill time',
    where: 'Anywhere in Airtime',
    defaultBinding: { ctrl: true, alt: true, shift: false, key: 'B' },
  },
  {
    id: 'search',
    label: 'Search work items',
    where: 'Anywhere in Airtime',
    defaultBinding: { ctrl: true, alt: false, shift: false, key: 'K' },
  },
  {
    id: 'timesheet',
    label: 'Open timesheet',
    where: 'Anywhere in Airtime',
    defaultBinding: { ctrl: true, alt: true, shift: false, key: 'S' },
  },
  {
    id: 'tray',
    label: 'Show tray menu',
    where: 'Anywhere in Airtime',
    defaultBinding: { ctrl: true, alt: true, shift: false, key: 'M' },
  },
  {
    id: 'save',
    label: 'Save entry from a dialog',
    where: 'Inside a dialog and the bulk entry table',
    defaultBinding: { ctrl: true, alt: false, shift: false, key: 'Enter' },
  },
];

export type Bindings = Record<ShortcutId, Binding>;
export type Overrides = Partial<Record<ShortcutId, Binding>>;

export const STORAGE_KEY = 'airtime.shortcuts';

export function shortcutDef(id: ShortcutId): ShortcutDef {
  const def = SHORTCUTS.find((entry) => entry.id === id);
  if (!def) {
    throw new Error(`unknown shortcut ${id}`);
  }
  return def;
}

export function defaultBindings(): Bindings {
  const result = {} as Bindings;
  for (const def of SHORTCUTS) {
    result[def.id] = { ...def.defaultBinding };
  }
  return result;
}

export type KeyLike = {
  key: string;
  /** Physical key, used when `key` is not a letter or digit (Alt changes it on some layouts). */
  code?: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
};

/** A key name a binding may use, or null for modifiers, dead keys and symbols. */
export function normalizeKey(key: string): string | null {
  if (/^[a-zA-Z0-9]$/.test(key)) {
    return key.toUpperCase();
  }
  if (key === 'Enter') {
    return 'Enter';
  }
  if (/^F([1-9]|1[0-2])$/.test(key)) {
    return key;
  }
  return null;
}

/** The binding key an event presses: its character, else its physical letter or digit. */
export function eventKey(event: Pick<KeyLike, 'key' | 'code'>): string | null {
  const fromKey = normalizeKey(event.key);
  if (fromKey) {
    return fromKey;
  }
  const physical = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(event.code ?? '');
  return physical ? (physical[1] ?? physical[2] ?? null) : null;
}

export function matchesBinding(event: KeyLike, binding: Binding): boolean {
  return (
    eventKey(event) === binding.key &&
    event.ctrlKey === binding.ctrl &&
    event.altKey === binding.alt &&
    event.shiftKey === binding.shift &&
    !event.metaKey
  );
}

/** The binding a key press describes, or null while only modifiers are held. */
export function bindingFromEvent(event: KeyLike): Binding | null {
  const key = eventKey(event);
  if (!key) {
    return null;
  }
  return { ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, key };
}

/** The visible key caps, in the order they are pressed: `['Ctrl', 'Alt', 'T']`. */
export function keyCaps(binding: Binding): string[] {
  const caps: string[] = [];
  if (binding.ctrl) {
    caps.push('Ctrl');
  }
  if (binding.alt) {
    caps.push('Alt');
  }
  if (binding.shift) {
    caps.push('Shift');
  }
  caps.push(binding.key);
  return caps;
}

/** The `aria-keyshortcuts` value: `Control+Alt+T`. */
export function ariaKeyShortcuts(binding: Binding): string {
  return speakBinding(binding).split(' ').join('+');
}

/** The text a screen reader says: `Control Alt T`. */
export function speakBinding(binding: Binding): string {
  return keyCaps(binding)
    .map((cap) => (cap === 'Ctrl' ? 'Control' : cap))
    .join(' ');
}

/** The full announcement: `Start or stop the timer, Control Alt T`. */
export function announce(def: ShortcutDef, binding: Binding): string {
  return `${def.label}, ${speakBinding(binding)}`;
}

export function bindingsEqual(a: Binding, b: Binding): boolean {
  return a.ctrl === b.ctrl && a.alt === b.alt && a.shift === b.shift && a.key === b.key;
}

const RESERVED: Array<{ binding: Binding; reason: string }> = [
  ...['A', 'C', 'V', 'X', 'Z', 'Y'].map((key) => ({
    binding: { ctrl: true, alt: false, shift: false, key },
    reason: 'is used for editing text',
  })),
  {
    binding: { ctrl: false, alt: true, shift: false, key: 'F4' },
    reason: 'closes the window',
  },
];

/** Why a binding cannot be used, or null when it is acceptable. */
export function bindingError(binding: Binding): string | null {
  if (normalizeKey(binding.key) !== binding.key) {
    return 'Use a letter, a number, Enter or a function key.';
  }
  if (!binding.ctrl && !binding.alt) {
    return 'Hold Ctrl or Alt as well, so typing in a field never triggers a shortcut.';
  }
  const reserved = RESERVED.find((entry) => bindingsEqual(entry.binding, binding));
  if (reserved) {
    return `${keyCaps(binding).join('+')} ${reserved.reason}; choose another combination.`;
  }
  return null;
}

/** The shortcut that already uses `candidate`, ignoring `id` itself. */
export function findConflict(
  bindings: Bindings,
  id: ShortcutId,
  candidate: Binding,
): ShortcutId | null {
  for (const def of SHORTCUTS) {
    if (def.id !== id && bindingsEqual(bindings[def.id], candidate)) {
      return def.id;
    }
  }
  return null;
}

function isBinding(value: unknown): value is Binding {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.ctrl === 'boolean' &&
    typeof entry.alt === 'boolean' &&
    typeof entry.shift === 'boolean' &&
    typeof entry.key === 'string' &&
    bindingError(entry as Binding) === null
  );
}

/** Stored rebindings; anything malformed or conflicting is dropped, never trusted. */
export function parseOverrides(raw: string | null): Overrides {
  if (!raw) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return {};
  }
  const stored = parsed as Record<string, unknown>;
  const overrides: Overrides = {};
  let bindings = defaultBindings();
  for (const def of SHORTCUTS) {
    const value = stored[def.id];
    if (!isBinding(value)) {
      continue;
    }
    const candidate: Binding = {
      ctrl: value.ctrl,
      alt: value.alt,
      shift: value.shift,
      key: value.key,
    };
    if (findConflict(bindings, def.id, candidate)) {
      continue;
    }
    overrides[def.id] = candidate;
    bindings = { ...bindings, [def.id]: candidate };
  }
  return overrides;
}

export function resolveBindings(overrides: Overrides): Bindings {
  return { ...defaultBindings(), ...overrides };
}

export function loadOverrides(): Overrides {
  try {
    return parseOverrides(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return {};
  }
}

/** Persists the rebindings; returns false when the browser store refuses. */
export function saveOverrides(overrides: Overrides): boolean {
  try {
    if (Object.keys(overrides).length === 0) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
    }
    return true;
  } catch {
    return false;
  }
}
