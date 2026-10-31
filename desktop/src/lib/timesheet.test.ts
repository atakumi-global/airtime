import { describe, expect, it } from 'vitest';
import { timesheetMetrics } from './timesheet';

describe('timesheetMetrics', () => {
  it('splits mixed rated and unrated entries by rate coverage', () => {
    // 60m + 10m (floored from 5m) rated, 30m unrated: 100 billable minutes.
    const metrics = timesheetMetrics({
      billableMinutes: 100,
      uncosted: { entries: 1, minutes: 30 },
    });
    expect(metrics).toEqual({
      billableMinutes: 70,
      uncostedMinutes: 30,
      costedShare: 70,
    });
  });

  it('is not pinned at 100% billable and never reports zero uncosted by default', () => {
    const metrics = timesheetMetrics({
      billableMinutes: 130,
      uncosted: { entries: 2, minutes: 65 },
    });
    expect(metrics.costedShare).toBe(50);
    expect(metrics.uncostedMinutes).toBe(65);
  });

  it('reports fully costed time as 100% with nothing uncosted', () => {
    expect(
      timesheetMetrics({
        billableMinutes: 90,
        uncosted: { entries: 0, minutes: 0 },
      }),
    ).toEqual({ billableMinutes: 90, uncostedMinutes: 0, costedShare: 100 });
  });

  it('reports fully unrated time as 0% billable', () => {
    expect(
      timesheetMetrics({
        billableMinutes: 45,
        uncosted: { entries: 3, minutes: 45 },
      }),
    ).toEqual({ billableMinutes: 0, uncostedMinutes: 45, costedShare: 0 });
  });

  it('handles an empty period and clamps inconsistent input', () => {
    expect(
      timesheetMetrics({
        billableMinutes: 0,
        uncosted: { entries: 0, minutes: 0 },
      }),
    ).toEqual({ billableMinutes: 0, uncostedMinutes: 0, costedShare: 0 });
    expect(
      timesheetMetrics({
        billableMinutes: 20,
        uncosted: { entries: 1, minutes: 50 },
      }).billableMinutes,
    ).toBe(0);
  });
});
