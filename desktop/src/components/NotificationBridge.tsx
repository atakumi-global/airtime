import { useEffect, useRef } from 'react';
import { useApp } from '../state/AppContext';
import {
  TONE_ACTION,
  entryFromStop,
  marginDrops,
  marginNotification,
  notify,
  onNotificationAction,
  savedNotification,
  stoppedNotification,
  type NotificationContext,
  type NotificationRequest,
} from '../lib/notifications';
import type { Project, RunningTimer, TimeEntry } from '../lib/types';

/** A stop counts as the source of "Entry saved" for this long. */
const STOP_WINDOW_MS = 2 * 60_000;
/** Contexts kept for actions; a toast clicked after this many newer ones is ignored. */
const MAX_CONTEXTS = 20;

type Seen = {
  entries: TimeEntry[];
  projects: Project[];
};

type Stop = { timer: RunningTimer; at: number; knownIds: Set<string> };

/**
 * Raises desktop notifications for what happens while the window is out of view and
 * runs the action a notification carries. Renders nothing.
 *
 * Three events, each with its action: an entry saved by stopping the timer (View),
 * a project whose margin fell below target (Open) and a timer that stopped without
 * this app stopping it (Restart). Whether to show the toast at all is decided in
 * the shell: never while the window is in view, never under Focus Assist.
 */
export function NotificationBridge({
  onTimesheet,
  onProjects,
}: {
  onTimesheet: () => void;
  onProjects: () => void;
}) {
  const { status, member, refreshing, fx, timer, timerPending, entries, projects, workItems, startTimer } =
    useApp();

  const seen = useRef<Seen>({ entries, projects });
  // The last timer seen while no start, pause or stop was in flight. An optimistic
  // timer from a start that then fails was never confirmed, so losing it is not a
  // timer that "stopped unexpectedly".
  const confirmed = useRef<RunningTimer | null>(timer);
  const armed = useRef(false);
  const stop = useRef<Stop | null>(null);
  const contexts = useRef(new Map<string, NotificationContext>());
  const counter = useRef(0);

  const raise = useRef((draft: Omit<NotificationRequest, 'id'>, context?: Partial<NotificationContext>) => {
    counter.current += 1;
    const id = `n-${Date.now()}-${counter.current}`;
    contexts.current.set(id, { action: TONE_ACTION[draft.tone], ...context });
    while (contexts.current.size > MAX_CONTEXTS) {
      const oldest = contexts.current.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      contexts.current.delete(oldest);
    }
    notify({ id, ...draft }).catch(() => {
      // A notification is a convenience; the in-app banner is the record.
      contexts.current.delete(id);
    });
  });

  useEffect(() => {
    const before = seen.current;
    const confirmedBefore = confirmed.current;
    seen.current = { entries, projects };
    if (!timerPending || !timer) {
      confirmed.current = timer;
    }

    if (status !== 'ready' || !member) {
      armed.current = false;
      stop.current = null;
      return;
    }
    // The first server load after sign-in or boot only sets the baseline: until then
    // the state is the on-device cache, and what the server changed since is not news.
    // `fx` is never cached, so it is set only by a load from the server.
    if (!armed.current) {
      armed.current = !refreshing && fx !== null;
      return;
    }

    if (confirmedBefore && !timer) {
      if (timerPending) {
        // This app is stopping the timer: the entry follows with the next refresh.
        stop.current = {
          timer: confirmedBefore,
          at: Date.now(),
          knownIds: new Set(before.entries.map((entry) => entry.id)),
        };
      } else {
        raise.current(stoppedNotification(confirmedBefore, workItems), {
          workItemId: confirmedBefore.work_item_id,
        });
      }
    }

    const pending = stop.current;
    if (pending) {
      if (Date.now() - pending.at > STOP_WINDOW_MS) {
        stop.current = null;
      } else {
        const saved = entryFromStop(pending.timer, pending.knownIds, entries);
        if (saved) {
          stop.current = null;
          raise.current(savedNotification(saved, workItems, projects));
        }
      }
    }

    const margin = marginNotification(marginDrops(before.projects, projects));
    if (margin) {
      raise.current(margin);
    }
  }, [status, member, refreshing, fx, timer, timerPending, entries, projects, workItems]);

  const latest = useRef({ onTimesheet, onProjects, startTimer, timer });
  useEffect(() => {
    latest.current = { onTimesheet, onProjects, startTimer, timer };
  }, [onTimesheet, onProjects, startTimer, timer]);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | null = null;
    onNotificationAction(({ id, action }) => {
      const context = contexts.current.get(id);
      contexts.current.delete(id);
      const current = latest.current;
      switch (action) {
        case 'view':
          current.onTimesheet();
          break;
        case 'open':
          current.onProjects();
          break;
        case 'restart':
          // Only a toast raised in this session knows which work item to restart,
          // and a timer that is already running must not be replaced.
          if (context && !current.timer) {
            void current.startTimer(context.workItemId ?? null);
          }
          break;
      }
    })
      .then((stopListening) => {
        if (active) {
          unlisten = stopListening;
        } else {
          stopListening();
        }
      })
      .catch(() => {
        // No notification events in this environment; the in-app banner still works.
      });
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  return null;
}
