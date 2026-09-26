import { describe, expect, it } from 'vitest';
import { healthBadge } from './ui';
import type { BudgetSummary } from '../lib/types';

function summary(overrides: Partial<BudgetSummary>): BudgetSummary {
  return {
    budget: { amount: 100, currency: 'USD' },
    convertedBudget: 100,
    spent: 40,
    remaining: 60,
    percentUsed: 40,
    currency: 'USD',
    currencyTotals: { USD: 40 },
    conversions: {},
    fxStale: false,
    fxDate: '2026-09-26',
    unconverted: { entries: 0, hours: 0 },
    uncosted: { entries: 0, hours: 0 },
    burnRatePerDay: 4,
    projectedOverrun: null,
    projectionHorizonDays: 30,
    projectionBasis: 'default_horizon',
    flag: 'ok',
    ...overrides,
  };
}

describe('healthBadge', () => {
  it('reports no budget when there is none', () => {
    expect(healthBadge(summary({ budget: null, flag: 'none' })).label).toBe(
      'No budget',
    );
  });

  it('marks an on-track project', () => {
    const badge = healthBadge(summary({ flag: 'ok' }));
    expect(badge.tone).toBe('success');
    expect(badge.label).toBe('On track');
  });

  it('marks a warning project', () => {
    expect(healthBadge(summary({ flag: 'warning' })).tone).toBe('warning');
  });

  it('marks an over-budget project with the percentage', () => {
    const badge = healthBadge(summary({ flag: 'over', percentUsed: 112 }));
    expect(badge.tone).toBe('danger');
    expect(badge.label).toBe('Over budget · 112%');
  });
});
