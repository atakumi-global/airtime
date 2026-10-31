import { beforeEach, describe, expect, it } from 'vitest';
import {
  SHORTCUTS,
  STORAGE_KEY,
  announce,
  ariaKeyShortcuts,
  bindingError,
  bindingFromEvent,
  defaultBindings,
  eventKey,
  findConflict,
  keyCaps,
  loadOverrides,
  matchesBinding,
  parseOverrides,
  resolveBindings,
  saveOverrides,
  shortcutDef,
  speakBinding,
  type Binding,
  type KeyLike,
} from './shortcuts';

function press(key: string, mods: Partial<KeyLike> = {}): KeyLike {
  return { key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods };
}

describe('shortcut defaults', () => {
  it('match the designed map', () => {
    const caps = Object.fromEntries(
      SHORTCUTS.map((def) => [def.id, keyCaps(def.defaultBinding).join('+')]),
    );
    expect(caps).toEqual({
      timer: 'Ctrl+Alt+T',
      backfill: 'Ctrl+Alt+B',
      search: 'Ctrl+K',
      timesheet: 'Ctrl+Alt+S',
      tray: 'Ctrl+Alt+M',
      save: 'Ctrl+Enter',
    });
  });

  it('are valid and do not clash with each other', () => {
    const bindings = defaultBindings();
    for (const def of SHORTCUTS) {
      expect(bindingError(def.defaultBinding), def.id).toBeNull();
      expect(findConflict(bindings, def.id, bindings[def.id]), def.id).toBeNull();
    }
  });

  it('are announced with a screen reader description', () => {
    expect(announce(shortcutDef('timer'), defaultBindings().timer)).toBe(
      'Start or stop the timer, Control Alt T',
    );
    expect(speakBinding(defaultBindings().save)).toBe('Control Enter');
    expect(ariaKeyShortcuts(defaultBindings().search)).toBe('Control+K');
  });
});

describe('matching', () => {
  const timer = defaultBindings().timer;

  it('matches the exact modifiers and key, ignoring case', () => {
    expect(matchesBinding(press('t', { ctrlKey: true, altKey: true }), timer)).toBe(true);
    expect(matchesBinding(press('T', { ctrlKey: true, altKey: true }), timer)).toBe(true);
  });

  it('does not match missing, extra or different modifiers', () => {
    expect(matchesBinding(press('t', { ctrlKey: true }), timer)).toBe(false);
    expect(matchesBinding(press('t', { ctrlKey: true, altKey: true, shiftKey: true }), timer)).toBe(
      false,
    );
    expect(matchesBinding(press('t', { ctrlKey: true, altKey: true, metaKey: true }), timer)).toBe(
      false,
    );
    expect(matchesBinding(press('b', { ctrlKey: true, altKey: true }), timer)).toBe(false);
  });

  it('falls back to the physical key when Alt changes the character', () => {
    const event = { ...press('†', { ctrlKey: true, altKey: true }), code: 'KeyT' };
    expect(eventKey(event)).toBe('T');
    expect(matchesBinding(event, timer)).toBe(true);
  });

  it('reads a binding from a key press, and nothing from a bare modifier', () => {
    expect(bindingFromEvent(press('k', { ctrlKey: true }))).toEqual({
      ctrl: true,
      alt: false,
      shift: false,
      key: 'K',
    });
    expect(bindingFromEvent(press('Control', { ctrlKey: true }))).toBeNull();
    expect(bindingFromEvent(press('F5', { altKey: true }))).toMatchObject({ key: 'F5' });
  });
});

describe('validation', () => {
  const base: Binding = { ctrl: true, alt: true, shift: false, key: 'J' };

  it('accepts a Ctrl or Alt combination', () => {
    expect(bindingError(base)).toBeNull();
    expect(bindingError({ ...base, ctrl: false })).toBeNull();
  });

  it('refuses a bare key or a shift-only combination', () => {
    expect(bindingError({ ctrl: false, alt: false, shift: false, key: 'J' })).toMatch(/Ctrl or Alt/);
    expect(bindingError({ ctrl: false, alt: false, shift: true, key: 'J' })).toMatch(/Ctrl or Alt/);
  });

  it('refuses text-editing and window-closing combinations', () => {
    expect(bindingError({ ctrl: true, alt: false, shift: false, key: 'C' })).toMatch(
      /editing text/,
    );
    expect(bindingError({ ctrl: false, alt: true, shift: false, key: 'F4' })).toMatch(/closes/);
  });

  it('refuses a key that is not a letter, number, Enter or function key', () => {
    expect(bindingError({ ...base, key: '#' })).toMatch(/letter/);
    expect(bindingError({ ...base, key: 'Escape' })).toMatch(/letter/);
  });

  it('finds the shortcut that already uses a combination', () => {
    const bindings = defaultBindings();
    expect(findConflict(bindings, 'backfill', bindings.timer)).toBe('timer');
    expect(findConflict(bindings, 'timer', bindings.timer)).toBeNull();
  });
});

describe('stored rebindings', () => {
  beforeEach(() => window.localStorage.clear());

  it('round-trip through the browser store', () => {
    const custom: Binding = { ctrl: true, alt: true, shift: false, key: 'J' };
    expect(saveOverrides({ timer: custom })).toBe(true);
    expect(loadOverrides()).toEqual({ timer: custom });
    expect(resolveBindings(loadOverrides()).timer).toEqual(custom);
    expect(resolveBindings(loadOverrides()).backfill).toEqual(defaultBindings().backfill);
  });

  it('clearing every override removes the stored value', () => {
    saveOverrides({ timer: { ctrl: true, alt: true, shift: false, key: 'J' } });
    saveOverrides({});
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('ignore anything malformed instead of trusting it', () => {
    expect(parseOverrides(null)).toEqual({});
    expect(parseOverrides('not json')).toEqual({});
    expect(parseOverrides('[1,2]')).toEqual({});
    expect(
      parseOverrides(
        JSON.stringify({
          timer: { ctrl: 'yes', alt: true, shift: false, key: 'J' },
          backfill: { ctrl: false, alt: false, shift: false, key: 'J' },
          search: { ctrl: true, alt: true, shift: false, key: '<script>' },
          bogus: { ctrl: true, alt: true, shift: false, key: 'J' },
        }),
      ),
    ).toEqual({});
  });

  it('drop a stored binding that clashes with an earlier one', () => {
    const same = { ctrl: true, alt: true, shift: false, key: 'J' };
    expect(parseOverrides(JSON.stringify({ timer: same, backfill: same }))).toEqual({ timer: same });
    expect(
      parseOverrides(JSON.stringify({ timer: { ctrl: true, alt: true, shift: false, key: 'B' } })),
    ).toEqual({});
  });

  it('survive a browser store that refuses access', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage')!;
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('denied');
      },
    });
    try {
      expect(loadOverrides()).toEqual({});
      expect(saveOverrides({ timer: { ctrl: true, alt: true, shift: false, key: 'J' } })).toBe(false);
    } finally {
      Object.defineProperty(window, 'localStorage', original);
    }
  });
});
