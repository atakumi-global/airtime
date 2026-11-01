import { timerElapsedSeconds } from './format';
import type { RunningTimer, TimeEntry, TimerState, WorkItem } from './types';

/** Tray status; mirrors the four tray states in the v2 shell design. */
export type TrayStatus = 'idle' | 'running' | 'paused' | 'error';

/** What the webview reports to the Rust tray (`set_tray_state`). */
export type TrayPayload = {
  status: TrayStatus;
  headline: string;
  detail: string;
  elapsedSeconds: number | null;
  /** The clock is counting; the tray advances it because a hidden webview is throttled. */
  clockRunning: boolean;
  hasTimer: boolean;
  canStart: boolean;
};

/** Menu item ids the Rust tray emits as `tray-action`. */
export type TrayAction =
  | 'open'
  | 'start-last'
  | 'pause'
  | 'resume'
  | 'stop'
  | 'retry'
  | 'backfill'
  | 'timesheet'
  | 'settings';

const TRAY_ACTIONS: readonly string[] = [
  'open',
  'start-last',
  'pause',
  'resume',
  'stop',
  'retry',
  'backfill',
  'timesheet',
  'settings',
];

export function isTrayAction(value: unknown): value is TrayAction {
  return typeof value === 'string' && TRAY_ACTIONS.includes(value);
}

export type TrayInput = {
  signedIn: boolean;
  online: boolean;
  timer: RunningTimer | null;
  timerState: TimerState;
  workItems: WorkItem[];
  entries: TimeEntry[];
  queued: number;
  now: number;
};

function workItemLabel(item: WorkItem): string {
  return `${item.identifier ?? ''} ${item.name}`.trim();
}

/** The work item of the most recent entry that still exists in the synced work items. */
export function lastWorkItem(entries: TimeEntry[], workItems: WorkItem[]): WorkItem | null {
  const recent = [...entries].sort(
    (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
  );
  for (const entry of recent) {
    if (!entry.work_item_id || entry.deleted_at) {
      continue;
    }
    const match = workItems.find((item) => item.plane_work_item_id === entry.work_item_id);
    if (match) {
      return match;
    }
  }
  return null;
}

export function buildTrayPayload(input: TrayInput): TrayPayload {
  if (!input.signedIn) {
    return {
      status: 'idle',
      headline: 'Sign in to start tracking',
      detail: '',
      elapsedSeconds: null,
      clockRunning: false,
      hasTimer: false,
      canStart: false,
    };
  }

  const { timer, timerState } = input;
  const timerItem = timer?.work_item_id
    ? input.workItems.find((item) => item.plane_work_item_id === timer.work_item_id)
    : undefined;
  const last = lastWorkItem(input.entries, input.workItems);

  let headline = 'No timer running';
  if (timer) {
    headline = timerItem
      ? workItemLabel(timerItem)
      : (timer.description ?? (timerState === 'paused' ? 'Timer paused' : 'Timer running'));
  } else if (last) {
    headline = workItemLabel(last);
  }

  const details: string[] = [];
  if (!input.online) {
    details.push('Plane not reachable. Time is safe on this device.');
  }
  if (input.queued > 0) {
    details.push(`${input.queued} ${input.queued === 1 ? 'entry' : 'entries'} queued`);
  }

  const status: TrayStatus = !input.online
    ? 'error'
    : timerState === 'running'
      ? 'running'
      : timerState === 'paused'
        ? 'paused'
        : 'idle';

  return {
    status,
    headline,
    detail: details.join(' \u00b7 '),
    elapsedSeconds: timer ? timerElapsedSeconds(timer, input.now) : null,
    clockRunning: timerState === 'running',
    hasTimer: timer !== null,
    canStart: timer === null && last !== null,
  };
}
