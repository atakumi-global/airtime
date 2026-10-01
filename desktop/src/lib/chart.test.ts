import { describe, expect, it } from 'vitest';
import { chartMax, chartText, projectedTotal } from './chart';
import type { BudgetSummary } from './types';

function summary(overrides: Partial<BudgetSummary> = {}): BudgetSummary {
  return {
    budget: { amount: 1000, currency: 'USD' },
    convertedBudget: 1000,
    spent: 400,
    remaining: 600,
    margin: 600,
    percentUsed: 40,
    price: 2000,
    profit: 1600,
    profitTargetPercent: 35,
    profitTargetAmount: 700,
    profitTargetMet: true,
    marginTargetAmount: 500,
    marginTargetMet: true,
    billableMinutes: 240,
    costByScope: { member: 400, project: 0, client: 0 },
    weeklyCost: [
      { weekStart: '2026-09-14', cost: 250 },
      { weekStart: '2026-09-21', cost: 150 },
    ],
    currency: 'USD',
    currencyTotals: { USD: 400 },
    conversions: {},
    fxStale: false,
    fxDate: '2026-09-26',
    unconverted: { entries: 0, hours: 0 },
    uncosted: { entries: 0, hours: 0 },
    burnRatePerDay: 4,
    projectedOverrun: 200,
    projectionHorizonDays: 30,
    projectionBasis: 'default_horizon',
    flag: 'ok',
    ...overrides,
  };
}

describe('projectedTotal', () => {
  it('adds the projected overrun to the budget', () => {
    expect(projectedTotal(summary())).toBe(1200);
  });

  it('is null without a budget or a projection', () => {
    expect(projectedTotal(summary({ convertedBudget: null }))).toBeNull();
    expect(projectedTotal(summary({ projectedOverrun: null }))).toBeNull();
  });
});

describe('chartMax', () => {
  it('uses the largest of budget, price, projection and weekly cost', () => {
    expect(chartMax(summary())).toBe(2000);
    expect(chartMax(summary({ price: null }))).toBe(1200);
  });

  it('never returns zero', () => {
    expect(
      chartMax(
        summary({
          convertedBudget: null,
          price: null,
          projectedOverrun: null,
          weeklyCost: [],
        }),
      ),
    ).toBe(1);
  });
});

describe('chartText', () => {
  it('describes an empty project', () => {
    expect(chartText(summary({ weeklyCost: [] }))).toContain('No cost');
  });

  it('describes cost, projection and price', () => {
    const text = chartText(summary({}));
    expect(text).toContain('budget');
    expect(text).toContain('Cost is');
    expect(text).toContain('projected');
    expect(text).toContain('below the');
  });
});
