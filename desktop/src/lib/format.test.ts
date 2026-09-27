import { describe, expect, it } from 'vitest';
import {
  dateInputValue,
  formatDuration,
  formatElapsed,
  formatMoney,
  rescheduleEntry,
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
