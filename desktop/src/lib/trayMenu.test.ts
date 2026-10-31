import { describe, expect, it } from 'vitest';
import { trayMenuItems } from './trayMenu';
import type { TrayPayload } from './trayState';

function payload(overrides: Partial<TrayPayload>): TrayPayload {
  return {
    status: 'idle',
    headline: '',
    detail: '',
    elapsedSeconds: null,
    clockRunning: false,
    hasTimer: false,
    canStart: false,
    ...overrides,
  };
}

const labels = (value: TrayPayload) => trayMenuItems(value).map((entry) => entry.label);

describe('trayMenuItems', () => {
  const shared = ['Back-fill time', 'Timesheet', 'Settings'];

  it('offers one primary action per state, like the native tray menu', () => {
    expect(labels(payload({ status: 'idle' }))).toEqual(['Start last work item', ...shared]);
    expect(labels(payload({ status: 'running' }))).toEqual(['Pause timer', 'Stop timer', ...shared]);
    expect(labels(payload({ status: 'paused' }))).toEqual(['Resume timer', 'Stop timer', ...shared]);
    expect(labels(payload({ status: 'error' }))).toEqual([
      'Retry sync now',
      'Start last work item',
      ...shared,
    ]);
    expect(labels(payload({ status: 'error', hasTimer: true }))).toEqual([
      'Retry sync now',
      'Stop timer',
      ...shared,
    ]);
  });

  it('disables Start when there is no last work item', () => {
    expect(trayMenuItems(payload({ status: 'idle', canStart: false }))[0]?.enabled).toBe(false);
    expect(trayMenuItems(payload({ status: 'idle', canStart: true }))[0]?.enabled).toBe(true);
  });
});
