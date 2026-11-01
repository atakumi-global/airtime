import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { formatDuration, formatMoney } from './format';
import { isTauri } from './native';
import type { Project, RunningTimer, TimeEntry, WorkItem } from './types';

/** Tones of the v2 shell: Success "View", Warning "Open", Error "Restart". */
export type NotificationTone = 'success' | 'warning' | 'error';

/** The one action each tone carries; the native side fixes the same pairing. */
export type NotificationAction = 'view' | 'open' | 'restart';

export const TONE_ACTION: Record<NotificationTone, NotificationAction> = {
  success: 'view',
  warning: 'open',
  error: 'restart',
};

export type NotificationRequest = {
  id: string;
  tone: NotificationTone;
  title: string;
  body: string;
};

/**
 * How a request ended. Only `shown` raised a toast; the others were withheld on
 * purpose and the in-app banner remains the message.
 */
export type NotificationDelivery =
  | 'shown'
  | 'window-in-view'
  | 'focus-assist'
  | 'unsupported';

const ACTIONS: readonly string[] = ['view', 'open', 'restart'];

export function isNotificationAction(value: unknown): value is NotificationAction {
  return typeof value === 'string' && ACTIONS.includes(value);
}

/**
 * Ask the desktop shell to raise a notification. The shell withholds it when the
 * window is in view or Windows Focus Assist is on. Outside the shell there is
 * nothing to raise.
 */
export async function notify(request: NotificationRequest): Promise<NotificationDelivery> {
  if (!isTauri) {
    return 'unsupported';
  }
  return invoke<NotificationDelivery>('notify', { request });
}

/**
 * Subscribe to clicks on a notification's action. Returns an unsubscribe
 * function; outside the shell it returns a no-op.
 */
export async function onNotificationAction(
  handler: (event: { id: string; action: NotificationAction }) => void,
): Promise<() => void> {
  if (!isTauri) {
    return () => {};
  }
  return listen<unknown>('notification-action', (event) => {
    const payload = event.payload as { id?: unknown; action?: unknown } | null;
    if (payload && typeof payload.id === 'string' && isNotificationAction(payload.action)) {
      handler({ id: payload.id, action: payload.action });
    }
  });
}

/** What the webview keeps for a raised notification so its action can run. */
export type NotificationContext = {
  action: NotificationAction;
  /** Restart: the work item to track again. */
  workItemId?: string | null;
};

function workItemLabel(workItemId: string | null, workItems: WorkItem[]): string | null {
  if (!workItemId) {
    return null;
  }
  const item = workItems.find((candidate) => candidate.plane_work_item_id === workItemId);
  if (!item) {
    return null;
  }
  return (item.identifier ?? item.name).trim() || null;
}

/** Success: the timer was stopped and its entry has landed. */
export function savedNotification(
  entry: TimeEntry,
  workItems: WorkItem[],
  projects: Project[],
): Omit<NotificationRequest, 'id'> {
  const where =
    workItemLabel(entry.work_item_id, workItems) ??
    projects.find((project) => project.id === entry.project_id)?.name ??
    null;
  const duration = formatDuration(entry.duration_minutes);
  return {
    tone: 'success',
    title: 'Entry saved',
    body: where ? `${duration} on ${where}` : duration,
  };
}

/** A project whose margin has just fallen below its target. */
export type MarginDrop = { project: Project; shortfall: number; currency: string };

/**
 * Projects that were not below their margin target before and are now. Only a
 * project seen with a summary both times can drop, so first loads and newly
 * synced projects never raise a warning.
 */
export function marginDrops(before: Project[], after: Project[]): MarginDrop[] {
  const drops: MarginDrop[] = [];
  for (const project of after) {
    const summary = project.summary;
    if (
      !summary ||
      summary.marginTargetMet !== false ||
      summary.margin === null ||
      summary.marginTargetAmount === null
    ) {
      continue;
    }
    const earlier = before.find((candidate) => candidate.id === project.id)?.summary;
    if (!earlier || earlier.marginTargetMet === false) {
      continue;
    }
    drops.push({
      project,
      shortfall: Math.max(0, summary.marginTargetAmount - summary.margin),
      currency: summary.currency,
    });
  }
  return drops;
}

/** Warning: one project by name, several as a count. */
export function marginNotification(drops: MarginDrop[]): Omit<NotificationRequest, 'id'> | null {
  const [first] = drops;
  if (!first) {
    return null;
  }
  if (drops.length > 1) {
    return {
      tone: 'warning',
      title: 'Margin below target',
      body: `${drops.length} projects are under their margin target`,
    };
  }
  return {
    tone: 'warning',
    title: 'Margin below target',
    body: `${first.project.name} is ${formatMoney(first.shortfall, first.currency, { compact: true })} under target`,
  };
}

/** Error: the timer vanished without this app stopping it. */
export function stoppedNotification(
  timer: RunningTimer,
  workItems: WorkItem[],
): Omit<NotificationRequest, 'id'> {
  const label = workItemLabel(timer.work_item_id, workItems);
  return {
    tone: 'error',
    title: 'Timer stopped unexpectedly',
    body: label ? `Was tracking ${label}. Restart to keep going.` : 'Restart to keep tracking.',
  };
}

/**
 * Entries that appeared since `knownIds` and that a stop of `timer` just created:
 * a timer entry on the same work item. Anything else arriving in a refresh
 * (another device, a sync) is not "Entry saved" for this stop.
 */
export function entryFromStop(
  timer: RunningTimer,
  knownIds: ReadonlySet<string>,
  entries: TimeEntry[],
): TimeEntry | null {
  return (
    entries.find(
      (entry) =>
        !knownIds.has(entry.id) &&
        entry.source === 'timer' &&
        entry.work_item_id === timer.work_item_id,
    ) ?? null
  );
}
