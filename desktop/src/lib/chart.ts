import type { BudgetSummary } from './types';
import { formatMoney } from './format';

export function projectedTotal(
  summary: Pick<BudgetSummary, 'convertedBudget' | 'projectedOverrun'>,
): number | null {
  if (summary.convertedBudget === null || summary.projectedOverrun === null) {
    return null;
  }
  return summary.convertedBudget + summary.projectedOverrun;
}

export function chartMax(summary: BudgetSummary): number {
  const values = [
    summary.convertedBudget ?? 0,
    summary.price ?? 0,
    projectedTotal(summary) ?? 0,
    ...summary.weeklyCost.map((week) => week.cost),
  ];
  return Math.max(1, ...values);
}

export function chartText(summary: BudgetSummary): string {
  if (summary.weeklyCost.length === 0) {
    return 'No cost has been logged against this project yet.';
  }
  const currency = summary.currency;
  const lines: string[] = [];
  lines.push(
    summary.convertedBudget === null
      ? 'Weekly cost'
      : `Weekly cost against the ${formatMoney(summary.convertedBudget, currency)} budget`,
  );
  lines.push(`Cost is ${formatMoney(summary.spent, currency)}`);
  const projected = projectedTotal(summary);
  if (projected !== null && summary.convertedBudget !== null) {
    const relation = projected > summary.convertedBudget ? 'above' : 'below';
    lines.push(`projected ${formatMoney(projected, currency)}, ${relation} the budget`);
  }
  if (summary.price !== null) {
    const relation = summary.spent > summary.price ? 'above' : 'below';
    lines.push(`${relation} the ${formatMoney(summary.price, currency)} price`);
  }
  return `${lines.join('; ')}.`;
}
