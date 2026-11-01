import { describe, expect, it } from 'vitest';
import {
  TONE_ACTION,
  entryFromStop,
  isNotificationAction,
  marginDrops,
  marginNotification,
  notify,
  onNotificationAction,
  savedNotification,
  stoppedNotification,
} from './notifications';
import { PROJECTS, WORK_ITEMS, runningTimer, summary, timeEntry } from '../test/fixtures';
import type { Project } from './types';

function withSummary(project: Project, overrides: Parameters<typeof summary>[0]): Project {
  return { ...project, summary: summary(overrides) };
}

const [WEB] = PROJECTS as [Project, Project];

describe('notification tones', () => {
  it('gives every tone exactly the action of the v2 shell', () => {
    expect(TONE_ACTION).toEqual({ success: 'view', warning: 'open', error: 'restart' });
  });

  it('accepts only the three known actions', () => {
    expect(isNotificationAction('view')).toBe(true);
    expect(isNotificationAction('open')).toBe(true);
    expect(isNotificationAction('restart')).toBe(true);
    expect(isNotificationAction('quit')).toBe(false);
    expect(isNotificationAction(undefined)).toBe(false);
    expect(isNotificationAction(3)).toBe(false);
  });
});

describe('outside the desktop shell', () => {
  it('raises nothing and listens to nothing', async () => {
    await expect(
      notify({ id: 'n-1', tone: 'success', title: 'Entry saved', body: '' }),
    ).resolves.toBe('unsupported');
    const stop = await onNotificationAction(() => {});
    expect(() => stop()).not.toThrow();
  });
});

describe('savedNotification', () => {
  it('names the duration and the work item', () => {
    expect(savedNotification(timeEntry(), WORK_ITEMS, PROJECTS)).toEqual({
      tone: 'success',
      title: 'Entry saved',
      body: '1h 30m on WEB-1',
    });
  });

  it('falls back to the project name, then to the duration alone', () => {
    const noItem = timeEntry({ work_item_id: null });
    expect(savedNotification(noItem, WORK_ITEMS, PROJECTS).body).toBe('1h 30m on Website');
    const nothing = timeEntry({ work_item_id: null, project_id: null });
    expect(savedNotification(nothing, WORK_ITEMS, PROJECTS).body).toBe('1h 30m');
  });
});

describe('marginDrops', () => {
  const healthy = withSummary(WEB, { marginTargetMet: true, margin: 600, marginTargetAmount: 500 });
  const below = withSummary(WEB, { marginTargetMet: false, margin: 300, marginTargetAmount: 500 });

  it('reports a project that crossed below its target', () => {
    const drops = marginDrops([healthy], [below]);
    expect(drops).toHaveLength(1);
    expect(drops[0]).toMatchObject({ shortfall: 200, currency: 'EUR' });
  });

  it('stays quiet for a project that was already below', () => {
    expect(marginDrops([below], [below])).toEqual([]);
  });

  it('stays quiet for a project seen for the first time or without a summary', () => {
    expect(marginDrops([], [below])).toEqual([]);
    expect(marginDrops([{ ...WEB, summary: undefined }], [below])).toEqual([]);
    expect(marginDrops([healthy], [{ ...WEB, summary: undefined }])).toEqual([]);
  });

  it('stays quiet when the target or margin is unknown', () => {
    const unknown = withSummary(WEB, { marginTargetMet: false, margin: null });
    expect(marginDrops([healthy], [unknown])).toEqual([]);
    const noTarget = withSummary(WEB, { marginTargetMet: false, marginTargetAmount: null });
    expect(marginDrops([healthy], [noTarget])).toEqual([]);
  });

  it('stays quiet for a project that recovered', () => {
    expect(marginDrops([below], [healthy])).toEqual([]);
  });
});

describe('marginNotification', () => {
  const below = withSummary(WEB, { marginTargetMet: false, margin: 300, marginTargetAmount: 1500 });

  it('is null without a drop', () => {
    expect(marginNotification([])).toBeNull();
  });

  it('names the project and the shortfall', () => {
    const request = marginNotification([{ project: below, shortfall: 1200, currency: 'EUR' }]);
    expect(request?.tone).toBe('warning');
    expect(request?.title).toBe('Margin below target');
    expect(request?.body).toMatch(/^Website is .*1,200 under target$/);
  });

  it('counts several projects instead of naming them', () => {
    const drop = { project: below, shortfall: 1, currency: 'EUR' };
    expect(marginNotification([drop, drop])?.body).toBe('2 projects are under their margin target');
  });
});

describe('stoppedNotification', () => {
  it('says what was tracked', () => {
    expect(stoppedNotification(runningTimer(), WORK_ITEMS)).toEqual({
      tone: 'error',
      title: 'Timer stopped unexpectedly',
      body: 'Was tracking WEB-1. Restart to keep going.',
    });
  });

  it('still reads well for a timer without a work item', () => {
    const body = stoppedNotification(runningTimer({ work_item_id: null }), WORK_ITEMS).body;
    expect(body).toBe('Restart to keep tracking.');
  });
});

describe('entryFromStop', () => {
  const timer = runningTimer();
  const fresh = timeEntry({ id: 'new', source: 'timer', work_item_id: 'plane-wi-1' });

  it('finds the timer entry created by the stop', () => {
    expect(entryFromStop(timer, new Set(['entry-1']), [timeEntry(), fresh])).toBe(fresh);
  });

  it('ignores entries that were already known', () => {
    expect(entryFromStop(timer, new Set(['new']), [fresh])).toBeNull();
  });

  it('ignores manual entries and entries for other work items', () => {
    const manual = timeEntry({ id: 'm', source: 'manual', work_item_id: 'plane-wi-1' });
    const other = timeEntry({ id: 'o', source: 'timer', work_item_id: 'plane-wi-2' });
    expect(entryFromStop(timer, new Set(), [manual, other])).toBeNull();
  });
});
