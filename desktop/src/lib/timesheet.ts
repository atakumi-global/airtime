import type { TimesheetTotals } from './types';

export type TimesheetMetrics = {
  /** Billable minutes whose rate resolved, so they carry a cost. */
  billableMinutes: number;
  /** Billable minutes with no resolved rate, left out of the cost. */
  uncostedMinutes: number;
  /** Share of the period's billable minutes that are costed, 0 to 100. */
  costedShare: number;
};

/**
 * Billable and Uncosted split the period's billable minutes by rate coverage:
 * Uncosted is what the server could not rate, Billable is the rest, so the two
 * always add up to the server's billable total.
 */
export function timesheetMetrics(
  totals: Pick<TimesheetTotals, 'billableMinutes' | 'uncosted'>,
): TimesheetMetrics {
  const total = Math.max(totals.billableMinutes, 0);
  const uncostedMinutes = Math.min(Math.max(totals.uncosted.minutes, 0), total);
  const billableMinutes = total - uncostedMinutes;
  return {
    billableMinutes,
    uncostedMinutes,
    costedShare: total > 0 ? Math.round((billableMinutes / total) * 100) : 0,
  };
}
