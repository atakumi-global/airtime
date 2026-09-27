export const CURRENCIES = [
  'EUR',
  'USD',
  'GBP',
  'CHF',
  'SEK',
  'NOK',
  'DKK',
  'PLN',
  'CZK',
  'CAD',
  'AUD',
  'JPY',
  'INR',
  'BRL',
  'ZAR',
] as const;

export function currencyOptions(include: string): string[] {
  const code = include.trim().toUpperCase();
  if (!code || CURRENCIES.includes(code as (typeof CURRENCIES)[number])) {
    return [...CURRENCIES];
  }
  return [code, ...CURRENCIES];
}
