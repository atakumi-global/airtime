import { describe, expect, it } from 'vitest';
import {
  dateInputValue,
  durationError,
  formatDate,
  formatDuration,
  formatDurationClock,
  formatDurationHours,
  formatElapsed,
  formatMoney,
  parseDuration,
  periodRange,
  rescheduleEntry,
  shiftPeriod,
  startOfWeek,
} from './format';

describe('formatDuration', () => {
  it('renders minutes under an hour', () => {
    expect(formatDuration(45)).toBe('45m');
  });

  it('pads minutes when hours are present', () => {
    expect(formatDuration(105)).toBe('1h 45m');
    expect(formatDuration(120)).toBe('2h');
  });
});

describe('parseDuration', () => {
  it('resolves every accepted format to minutes', () => {
    expect(parseDuration('1h 30m')).toBe(90);
    expect(parseDuration('1h30m')).toBe(90);
    expect(parseDuration('90m')).toBe(90);
    expect(parseDuration('2h')).toBe(120);
    expect(parseDuration('1d')).toBe(480);
    expect(parseDuration('1w')).toBe(2400);
    expect(parseDuration('0.5d')).toBe(240);
    expect(parseDuration('1.5h')).toBe(90);
  });

  it('ignores case and surrounding spaces', () => {
    expect(parseDuration('  1H 30M  ')).toBe(90);
  });

  it('adds to the current value for a + prefix', () => {
    expect(parseDuration('+15m', 90)).toBe(105);
    expect(parseDuration('+15m')).toBe(15);
    expect(parseDuration('+1h 30m', 30)).toBe(120);
  });

  it('returns zero for a zero duration so it can be rejected', () => {
    expect(parseDuration('0m')).toBe(0);
  });

  it('rejects text, unit-less numbers and partial input', () => {
    expect(parseDuration('banana')).toBeNull();
    expect(parseDuration('1h 3')).toBeNull();
    expect(parseDuration('90')).toBeNull();
    expect(parseDuration('h30')).toBeNull();
    expect(parseDuration('1h + 30m')).toBeNull();
    expect(parseDuration('')).toBeNull();
    expect(parseDuration('+')).toBeNull();
  });
});

describe('durationError', () => {
  it('accepts a valid duration', () => {
    expect(durationError('1h 30m')).toBeNull();
  });

  it('explains an unparseable value', () => {
    expect(durationError('banana')).toBe(
      'Not a duration. Try 1h 30m, 90m, 1d or 1w.',
    );
  });

  it('rejects a zero duration', () => {
    expect(durationError('0m')).toBe('Duration must be greater than zero.');
  });
});

describe('formatDurationClock', () => {
  it('renders hours, minutes and seconds', () => {
    expect(formatDurationClock(90)).toBe('01:30:00');
    expect(formatDurationClock(480)).toBe('08:00:00');
    expect(formatDurationClock(15)).toBe('00:15:00');
  });
});

describe('formatDurationHours', () => {
  it('renders decimal hours with a singular hour label', () => {
    expect(formatDurationHours(90)).toBe('1.5 hours');
    expect(formatDurationHours(60)).toBe('1 hour');
    expect(formatDurationHours(480)).toBe('8 hours');
    expect(formatDurationHours(30)).toBe('0.5 hours');
  });
});

describe('formatElapsed', () => {
  it('formats hours, minutes and seconds', () => {
    const started = new Date('2026-09-27T10:00:00.000Z').toISOString();
    const now = new Date('2026-09-27T11:24:05.000Z').getTime();
    expect(formatElapsed(started, now)).toBe('01:24:05');
  });

  it('never goes negative', () => {
    const started = new Date('2026-09-27T12:00:00.000Z').toISOString();
    const now = new Date('2026-09-27T11:00:00.000Z').getTime();
    expect(formatElapsed(started, now)).toBe('00:00:00');
  });
});

describe('formatMoney', () => {
  it('formats with the currency code', () => {
    expect(formatMoney(1234.5, 'EUR', { compact: true })).toContain('€');
  });

  it('falls back when the currency is unknown', () => {
    expect(formatMoney(10, 'ZZZ')).toMatch(/ZZZ\s10/);
  });
});

describe('formatDate', () => {
  it('renders the day and the three-letter month', () => {
    expect(formatDate(new Date(2026, 8, 23).toISOString())).toBe('23 Sep');
  });
});

describe('dateInputValue', () => {
  it('renders the local calendar date as YYYY-MM-DD', () => {
    const local = new Date(2026, 8, 22, 14, 30).toISOString();
    expect(dateInputValue(local)).toBe('2026-09-22');
  });
});

describe('rescheduleEntry', () => {
  const entry = {
    started_at: new Date(2026, 8, 22, 9, 15).toISOString(),
    ended_at: new Date(2026, 8, 22, 10, 15).toISOString(),
  };

  it('moves the entry to a new date keeping the time of day', () => {
    const result = rescheduleEntry(entry, '2026-09-25', 60);
    const start = new Date(result.startedAt);
    expect(dateInputValue(result.startedAt)).toBe('2026-09-25');
    expect(start.getHours()).toBe(9);
    expect(start.getMinutes()).toBe(15);
  });

  it('applies a new duration from the original start', () => {
    const result = rescheduleEntry(entry, '2026-09-22', 90);
    const start = new Date(result.startedAt).getTime();
    const end = new Date(result.endedAt).getTime();
    expect((end - start) / 60000).toBe(90);
  });

  it('rejects a zero or negative duration', () => {
    expect(() => rescheduleEntry(entry, '2026-09-22', 0)).toThrow(
      'Duration must be greater than zero.',
    );
    expect(() => rescheduleEntry(entry, '2026-09-22', -5)).toThrow();
  });
});

describe('startOfWeek', () => {
  it('returns Monday midnight', () => {
    const date = startOfWeek(new Date('2026-09-27T15:00:00.000Z'));
    expect(date.getDay()).toBe(1);
    expect(date.getHours()).toBe(0);
  });
});

describe('periodRange', () => {
  it('labels a week as its Monday to Sunday span', () => {
    const range = periodRange('week', new Date(2026, 8, 23));
    expect(range.label).toBe('21 – 27 Sep 2026');
  });

  it('covers Monday midnight to the next Monday', () => {
    const range = periodRange('week', new Date(2026, 8, 23));
    const from = new Date(range.from);
    const to = new Date(range.to);
    expect(from.getDate()).toBe(21);
    expect(from.getDay()).toBe(1);
    expect(from.getHours()).toBe(0);
    expect(to.getDate()).toBe(28);
    expect(to.getDay()).toBe(1);
    expect(to.getHours()).toBe(0);
  });

  it('labels a month with its name and year', () => {
    const range = periodRange('month', new Date(2026, 8, 15));
    expect(range.label).toBe('September 2026');
    const from = new Date(range.from);
    const to = new Date(range.to);
    expect(from.getDate()).toBe(1);
    expect(to.getDate()).toBe(1);
    expect(to.getMonth()).toBe(9);
  });

  it('crosses months in the week label', () => {
    const range = periodRange('week', new Date(2026, 8, 30));
    expect(range.label).toBe('28 Sep – 4 Oct 2026');
  });
});

describe('shiftPeriod', () => {
  it('moves a week by whole weeks', () => {
    const shifted = shiftPeriod(new Date(2026, 8, 23), 'week', -1);
    expect(shifted.getDate()).toBe(16);
  });

  it('moves a month across a year boundary', () => {
    const shifted = shiftPeriod(new Date(2026, 0, 15), 'month', -1);
    expect(shifted.getFullYear()).toBe(2025);
    expect(shifted.getMonth()).toBe(11);
  });
});
