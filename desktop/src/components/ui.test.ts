import { describe, expect, it } from 'vitest';
import { healthBadge } from './ui';
import type { BudgetSummary } from '../lib/types';

function summary(overrides: Partial<BudgetSummary>): BudgetSummary {
  return {
    budget: { amount: 100, currency: 'USD' },
    convertedBudget: 100,
    spent: 40,
    remaining: 60,
    margin: 60,
    percentUsed: 40,
    price: 200,
    profit: 160,
    profitTargetPercent: 35,
    profitTargetAmount: 70,
    profitTargetMet: true,
    marginTargetAmount: 50,
    marginTargetMet: true,
    billableMinutes: 40,
    costByScope: { member: 40, project: 0, client: 0 },
    weeklyCost: [{ weekStart: '2026-09-21', cost: 40 }],
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

  it('names the missed margin target', () => {
    const badge = healthBadge(summary({ flag: 'warning', marginTargetMet: false }));
    expect(badge.tone).toBe('warning');
    expect(badge.label).toBe('Below margin target');
  });

  it('names the missed profit target', () => {
    const badge = healthBadge(summary({ flag: 'warning', profitTargetMet: false }));
    expect(badge.tone).toBe('warning');
    expect(badge.label).toBe('Below profit target');
  });

  it('reports a low budget when no target is missed', () => {
    const badge = healthBadge(summary({ flag: 'warning', percentUsed: 92 }));
    expect(badge.label).toBe('Low budget · 8% left');
  });

  it('reports a missing price without failing health', () => {
    const badge = healthBadge(
      summary({ price: null, profit: null, profitTargetMet: null }),
    );
    expect(badge.tone).toBe('brand');
    expect(badge.label).toBe('Price not set');
  });

  it('marks on track when both targets are met', () => {
    const badge = healthBadge(summary({}));
    expect(badge.tone).toBe('success');
    expect(badge.label).toBe('On track');
  });
});
