export function formatDuration(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safe / 60);
  const mins = safe % 60;
  if (hours === 0) {
    return `${mins}m`;
  }
  if (mins === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${String(mins).padStart(2, '0')}m`;
}

export const MINUTES_PER_DAY = 480;
export const MINUTES_PER_WEEK = 2400;

const DURATION_UNITS: Record<string, number> = {
  m: 1,
  h: 60,
  d: MINUTES_PER_DAY,
  w: MINUTES_PER_WEEK,
};

export function parseDuration(value: string, baseMinutes = 0): number | null {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === '') {
    return null;
  }
  const additive = trimmed.startsWith('+');
  const body = (additive ? trimmed.slice(1) : trimmed).replace(/\s+/g, '');
  if (body === '') {
    return null;
  }
  const pattern = /(\d+(?:\.\d+)?)([mhdw])/g;
  let total = 0;
  let consumed = '';
  let match = pattern.exec(body);
  while (match !== null) {
    consumed += match[0];
    total += Number(match[1]) * DURATION_UNITS[match[2]];
    match = pattern.exec(body);
  }
  if (consumed !== body) {
    return null;
  }
  const minutes = Math.round(total);
  return additive ? Math.round(baseMinutes) + minutes : minutes;
}

export function formatDurationClock(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safe / 60);
  const mins = safe % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:00`;
}

export function formatDurationHours(minutes: number): string {
  const hours = Math.round((Math.max(0, minutes) / 60) * 100) / 100;
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

export function durationError(value: string): string | null {
  const minutes = parseDuration(value);
  if (minutes === null) {
    return 'Not a duration. Try 1h 30m, 90m, 1d or 1w.';
  }
  if (minutes <= 0) {
    return 'Duration must be greater than zero.';
  }
  return null;
}

export function formatElapsed(startedAt: string, now: number): string {
  const seconds = Math.max(
    0,
    Math.floor((now - new Date(startedAt).getTime()) / 1000),
  );
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((part) => String(part).padStart(2, '0')).join(':');
}

export function formatMoney(
  amount: number,
  currency: string,
  options: { compact?: boolean } = {},
): string {
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency,
      maximumFractionDigits: options.compact ? 0 : 2,
      minimumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(options.compact ? 0 : 2)}`;
  }
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  return `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`;
}

export function formatDayHeading(iso: string, today: string): string {
  const date = new Date(iso);
  const value = date.toDateString();
  if (value === new Date(today).toDateString()) {
    return `Today, ${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}`;
  }
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (value === yesterday.toDateString()) {
    return `Yesterday, ${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}`;
  }
  return date.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function dateInputValue(iso: string): string {
  const date = new Date(iso);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export type RescheduledEntry = { startedAt: string; endedAt: string };

export function rescheduleEntry(
  entry: { started_at: string; ended_at: string },
  date: string,
  durationMinutes: number,
): RescheduledEntry {
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    throw new Error('Duration must be greater than zero.');
  }
  const parts = date.split('-').map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
    throw new Error('Enter a valid date.');
  }
  const [year, month, day] = parts as [number, number, number];
  const original = new Date(entry.started_at);
  if (Number.isNaN(original.getTime())) {
    throw new Error('This entry has no valid start time.');
  }
  const start = new Date(original);
  start.setFullYear(year, month - 1, day);
  const end = new Date(start.getTime() + Math.round(durationMinutes) * 60000);
  return { startedAt: start.toISOString(), endedAt: end.toISOString() };
}

export function startOfWeek(now = new Date()): Date {
  const date = new Date(now);
  const day = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - day);
  date.setHours(0, 0, 0, 0);
  return date;
}

export type PeriodMode = 'week' | 'month';

export type PeriodRange = {
  from: string;
  to: string;
  label: string;
};

const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function formatPeriodLabel(start: Date, end: Date): string {
  const sameMonth = start.getMonth() === end.getMonth();
  const startText = sameMonth
    ? String(start.getDate())
    : `${start.getDate()} ${MONTHS_SHORT[start.getMonth()]}`;
  const endText = `${end.getDate()} ${MONTHS_SHORT[end.getMonth()]} ${end.getFullYear()}`;
  return `${startText} – ${endText}`;
}

export function periodRange(mode: PeriodMode, anchor = new Date()): PeriodRange {
  if (mode === 'month') {
    const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const to = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1);
    return {
      from: start.toISOString(),
      to: to.toISOString(),
      label: start.toLocaleDateString('en-GB', {
        month: 'long',
        year: 'numeric',
      }),
    };
  }
  const start = startOfWeek(anchor);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const to = new Date(start);
  to.setDate(to.getDate() + 7);
  return {
    from: start.toISOString(),
    to: to.toISOString(),
    label: formatPeriodLabel(start, end),
  };
}

export function shiftPeriod(
  anchor: Date,
  mode: PeriodMode,
  delta: number,
): Date {
  const next = new Date(anchor);
  if (mode === 'week') {
    next.setDate(next.getDate() + delta * 7);
  } else {
    next.setMonth(next.getMonth() + delta);
  }
  return next;
}
