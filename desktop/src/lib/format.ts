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
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  });
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

export function startOfWeek(now = new Date()): Date {
  const date = new Date(now);
  const day = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - day);
  date.setHours(0, 0, 0, 0);
  return date;
}
