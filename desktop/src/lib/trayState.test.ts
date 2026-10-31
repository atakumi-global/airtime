import { describe, expect, it } from 'vitest';
import { buildTrayPayload, isTrayAction, lastWorkItem, type TrayInput } from './trayState';
import type { RunningTimer, TimeEntry, WorkItem } from './types';

const NOW = Date.parse('2026-05-04T10:00:00Z');

function workItem(id: string, identifier: string, name: string): WorkItem {
  return {
    id: `row-${id}`,
    project_id: 'p1',
    plane_work_item_id: id,
    identifier,
    name,
    state_group: 'started',
    is_open: true,
    project_name: 'Ops',
    project_identifier: 'OPS',
  };
}

function entry(workItemId: string | null, startedAt: string, deletedAt: string | null = null): TimeEntry {
  return {
    id: `e-${startedAt}`,
    project_id: 'p1',
    member_id: 'm1',
    work_item_id: workItemId,
    description: null,
    source: 'timer',
    started_at: startedAt,
    ended_at: startedAt,
    duration_minutes: 30,
    billable_minutes: 30,
    created_at: startedAt,
    updated_at: startedAt,
    deleted_at: deletedAt,
  };
}

function timer(overrides: Partial<RunningTimer> = {}): RunningTimer {
  return {
    member_id: 'm1',
    project_id: 'p1',
    work_item_id: 'w1',
    description: null,
    started_at: '2026-05-04T08:35:55Z',
    state: 'running',
    paused_at: null,
    paused_seconds: 0,
    ...overrides,
  };
}

const items = [workItem('w1', 'AV-142', 'Pre-flight checklist'), workItem('w2', 'AV-7', 'Briefing')];

function input(overrides: Partial<TrayInput> = {}): TrayInput {
  return {
    signedIn: true,
    online: true,
    timer: null,
    timerState: 'idle',
    workItems: items,
    entries: [],
    queued: 0,
    now: NOW,
    ...overrides,
  };
}

describe('lastWorkItem', () => {
  it('picks the most recent entry whose work item still exists', () => {
    const entries = [
      entry('w1', '2026-05-01T09:00:00Z'),
      entry('w2', '2026-05-03T09:00:00Z'),
      entry('gone', '2026-05-04T09:00:00Z'),
      entry('w1', '2026-05-04T08:00:00Z', '2026-05-04T08:30:00Z'),
    ];
    expect(lastWorkItem(entries, items)?.plane_work_item_id).toBe('w2');
  });

  it('returns null when nothing qualifies', () => {
    expect(lastWorkItem([], items)).toBeNull();
    expect(lastWorkItem([entry(null, '2026-05-01T09:00:00Z')], items)).toBeNull();
  });
});

describe('buildTrayPayload', () => {
  it('reports idle with the last work item ready to start', () => {
    const payload = buildTrayPayload(input({ entries: [entry('w1', '2026-05-03T09:00:00Z')] }));
    expect(payload).toMatchObject({
      status: 'idle',
      headline: 'AV-142 Pre-flight checklist',
      elapsedSeconds: null,
      clockRunning: false,
      hasTimer: false,
      canStart: true,
    });
  });

  it('cannot start without a last work item', () => {
    const payload = buildTrayPayload(input());
    expect(payload.canStart).toBe(false);
    expect(payload.headline).toBe('No timer running');
  });

  it('reports a running timer with its elapsed seconds', () => {
    const payload = buildTrayPayload(input({ timer: timer(), timerState: 'running' }));
    expect(payload).toMatchObject({
      status: 'running',
      headline: 'AV-142 Pre-flight checklist',
      elapsedSeconds: 5045,
      clockRunning: true,
      hasTimer: true,
      canStart: false,
    });
  });

  it('freezes a paused timer at the moment it was paused', () => {
    const paused = timer({
      state: 'paused',
      paused_at: '2026-05-04T08:50:00Z',
      paused_seconds: 60,
    });
    const payload = buildTrayPayload(input({ timer: paused, timerState: 'paused' }));
    expect(payload).toMatchObject({ status: 'paused', clockRunning: false, hasTimer: true });
    expect(payload.elapsedSeconds).toBe(14 * 60 + 5 - 60);
  });

  it('reports offline as an error and keeps the running clock and queue count', () => {
    const payload = buildTrayPayload(
      input({ online: false, timer: timer(), timerState: 'running', queued: 2 }),
    );
    expect(payload.status).toBe('error');
    expect(payload.clockRunning).toBe(true);
    expect(payload.hasTimer).toBe(true);
    expect(payload.detail).toBe('Plane not reachable. Time is safe on this device. \u00b7 2 entries queued');
  });

  it('uses the singular for one queued entry', () => {
    expect(buildTrayPayload(input({ queued: 1 })).detail).toBe('1 entry queued');
  });

  it('falls back to the timer description when the work item is not synced', () => {
    const payload = buildTrayPayload(
      input({
        timer: timer({ work_item_id: 'unknown', description: 'Ad hoc call' }),
        timerState: 'running',
      }),
    );
    expect(payload.headline).toBe('Ad hoc call');
  });

  it('is idle and cannot start when signed out', () => {
    const payload = buildTrayPayload(input({ signedIn: false, entries: [entry('w1', '2026-05-03T09:00:00Z')] }));
    expect(payload).toMatchObject({ status: 'idle', canStart: false, hasTimer: false });
  });
});

describe('isTrayAction', () => {
  it('accepts only the actions the tray menu can emit', () => {
    expect(isTrayAction('backfill')).toBe(true);
    expect(isTrayAction('start-last')).toBe(true);
    expect(isTrayAction('quit')).toBe(false);
    expect(isTrayAction(42)).toBe(false);
    expect(isTrayAction(undefined)).toBe(false);
  });
});
