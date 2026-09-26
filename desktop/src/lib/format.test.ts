import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  formatElapsed,
  formatMoney,
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

describe('startOfWeek', () => {
  it('returns Monday midnight', () => {
    const date = startOfWeek(new Date('2026-09-27T15:00:00.000Z'));
    expect(date.getDay()).toBe(1);
    expect(date.getHours()).toBe(0);
  });
});
