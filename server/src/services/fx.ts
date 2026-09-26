import type { Db } from '../db/pool.js';

export const FX_BASE = 'EUR';

export type FxSnapshot = {
  date: string | null;
  rates: Map<string, number>;
  stale: boolean;
  fetchedAt: Date | null;
  error: string | null;
};

export type Conversion = {
  amount: number;
  rate: number;
  date: string | null;
  stale: boolean;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function refreshRates(
  db: Db,
  providerUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ stored: number; date: string }> {
  const url = `${providerUrl}?base=${FX_BASE}`;
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`FX provider returned status ${response.status}`);
  }
  const body = (await response.json()) as {
    date?: unknown;
    rates?: unknown;
  };
  if (
    typeof body.date !== 'string' ||
    !body.rates ||
    typeof body.rates !== 'object'
  ) {
    throw new Error('FX provider returned an unexpected payload');
  }
  const date = body.date.slice(0, 10);
  let stored = 0;
  for (const [currency, value] of Object.entries(
    body.rates as Record<string, unknown>,
  )) {
    const rate = Number(value);
    if (!Number.isFinite(rate) || rate <= 0 || currency === FX_BASE) {
      continue;
    }
    await db.query(
      `INSERT INTO fx_rates (currency, rate_date, eur_rate, fetched_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (currency, rate_date) DO UPDATE SET eur_rate = EXCLUDED.eur_rate`,
      [currency.toUpperCase(), date, rate],
    );
    stored += 1;
  }
  return { stored, date };
}

export async function getLatestRates(db: Db): Promise<FxSnapshot> {
  const latest = await db.query<{ date: string | null; fetched_at: Date | null }>(
    'SELECT max(rate_date)::text AS date, max(fetched_at) AS fetched_at FROM fx_rates',
  );
  const row = latest[0];
  if (!row || !row.date) {
    return {
      date: null,
      rates: new Map(),
      stale: true,
      fetchedAt: null,
      error: null,
    };
  }
  const rows = await db.query<{ currency: string; eur_rate: string }>(
    'SELECT currency, eur_rate FROM fx_rates WHERE rate_date = $1',
    [row.date],
  );
  const rates = new Map<string, number>();
  for (const item of rows) {
    rates.set(item.currency, Number(item.eur_rate));
  }
  return {
    date: row.date,
    rates,
    stale: row.date < todayIso(),
    fetchedAt: row.fetched_at,
    error: null,
  };
}

export function convertAmount(
  amount: number,
  from: string,
  to: string,
  snapshot: FxSnapshot,
): Conversion | null {
  const source = from.toUpperCase();
  const target = to.toUpperCase();
  if (source === target) {
    return { amount, rate: 1, date: snapshot.date, stale: false };
  }
  const sourceRate = source === FX_BASE ? 1 : snapshot.rates.get(source);
  const targetRate = target === FX_BASE ? 1 : snapshot.rates.get(target);
  if (!sourceRate || !targetRate) {
    return null;
  }
  const rate = targetRate / sourceRate;
  return {
    amount: Math.round(amount * rate * 10000) / 10000,
    rate: Math.round(rate * 1e8) / 1e8,
    date: snapshot.date,
    stale: snapshot.stale,
  };
}

export async function shouldRefresh(
  db: Db,
  refreshHours: number,
): Promise<boolean> {
  if (refreshHours <= 0) {
    return false;
  }
  const rows = await db.query<{ latest: Date | null }>(
    'SELECT max(fetched_at) AS latest FROM fx_rates',
  );
  const latest = rows[0]?.latest ?? null;
  if (!latest) {
    return true;
  }
  const ageHours = (Date.now() - new Date(latest).getTime()) / (1000 * 60 * 60);
  return ageHours >= refreshHours * 0.9;
}
