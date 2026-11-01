import { randomUUID } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import type { Db } from '../db/pool.js';
import { recordFeedback } from './feedback.js';
import {
  assertCanEnterTime,
  assertCanWriteProject,
  fromClient,
  readableOrUnassignedSql,
  type Viewer,
} from './access.js';

export const BILLABLE_MINIMUM_MINUTES = 10;
export const MANUAL_SOURCE = 'manual';
export const TIMER_SOURCE = 'timer';

export type EntryRow = {
  id: string;
  organisation_id: string;
  project_id: string | null;
  member_id: string;
  work_item_id: string | null;
  description: string | null;
  source: string;
  started_at: Date;
  ended_at: Date;
  duration_minutes: number;
  billable_minutes: number;
  currency: string | null;
  rate_applied: string | null;
  cost: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  /** The Plane workspace of the entry's project; set by reads that join projects. */
  workspace_slug?: string | null;
};

export type TimerRow = {
  member_id: string;
  organisation_id: string;
  project_id: string | null;
  work_item_id: string | null;
  description: string | null;
  started_at: Date;
  /** 'running' or 'paused'; derived from paused_at by the database. */
  state: 'running' | 'paused';
  /** Set while the timer is paused; null while it is running. */
  paused_at: Date | null;
  /** Total time spent paused before the current pause, in seconds. */
  paused_seconds: number;
  created_at: Date;
  updated_at: Date;
  /** The Plane workspace of the timer's project; set when the timer is read. */
  workspace_slug?: string | null;
};

export class ValidationError extends Error {
  readonly statusCode = 400;
}

function badRequest(message: string): ValidationError {
  return new ValidationError(message);
}

export function billableMinutes(durationMinutes: number): number {
  return Math.max(durationMinutes, BILLABLE_MINIMUM_MINUTES);
}

async function resolveProjectId(
  client: PoolClient,
  organisationId: string,
  workItemId: string | null,
): Promise<string | null> {
  if (!workItemId) {
    return null;
  }
  const result = await client.query<{ project_id: string | null }>(
    'SELECT project_id FROM work_items WHERE organisation_id = $1 AND plane_work_item_id = $2',
    [organisationId, workItemId],
  );
  return result.rows[0]?.project_id ?? null;
}

function writeHistory(
  client: PoolClient,
  input: {
    entryId: string;
    organisationId: string;
    actorMemberId: string | null;
    action: 'created' | 'updated' | 'deleted';
    before: unknown;
    after: unknown;
  },
): Promise<QueryResultRow[]> {
  return client
    .query(
      `INSERT INTO time_entry_history
         (id, entry_id, organisation_id, actor_member_id, action, before_state, after_state)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        randomUUID(),
        input.entryId,
        input.organisationId,
        input.actorMemberId,
        input.action,
        input.before === undefined ? null : JSON.stringify(input.before),
        input.after === undefined ? null : JSON.stringify(input.after),
      ],
    )
    .then((result) => result.rows);
}

async function insertEntry(
  client: PoolClient,
  input: {
    organisationId: string;
    memberId: string;
    projectId: string | null;
    workItemId: string | null;
    description: string | null;
    source: string;
    startedAt: Date;
    endedAt: Date;
    durationMinutes: number;
    actorMemberId: string | null;
  },
): Promise<EntryRow> {
  const id = randomUUID();
  const result = await client.query<EntryRow>(
    `INSERT INTO time_entries
       (id, organisation_id, project_id, member_id, work_item_id, description,
        source, started_at, ended_at, duration_minutes, billable_minutes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      id,
      input.organisationId,
      input.projectId,
      input.memberId,
      input.workItemId,
      input.description,
      input.source,
      input.startedAt,
      input.endedAt,
      input.durationMinutes,
      billableMinutes(input.durationMinutes),
    ],
  );
  await writeHistory(client, {
    entryId: id,
    organisationId: input.organisationId,
    actorMemberId: input.actorMemberId,
    action: 'created',
    before: null,
    after: result.rows[0],
  });
  await recordFeedback(client, {
    organisationId: input.organisationId,
    memberId: input.memberId,
    action: 'created',
    before: null,
    after: result.rows[0]!,
  });
  return result.rows[0]!;
}

/**
 * Recorded time is frozen history once the editor has lost access to its
 * project: members can only change entries of projects they currently belong to.
 * Administrators can still correct any entry.
 */
async function assertCanEditRecorded(
  client: PoolClient,
  input: { organisationId: string; viewer: Viewer },
  projectId: string | null,
): Promise<void> {
  if (projectId) {
    await assertCanWriteProject(fromClient(client), input.organisationId, input.viewer, projectId);
  }
}

export async function getRunningTimer(
  db: Db,
  organisationId: string,
  memberId: string,
): Promise<TimerRow | undefined> {
  const rows = await db.query<TimerRow>(
    `SELECT t.*, p.workspace_slug
       FROM timers t
       LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.organisation_id = $1 AND t.member_id = $2`,
    [organisationId, memberId],
  );
  return rows[0];
}

// Stopping always records the elapsed time: the timer was started while the
// member had access, and discarding worked time would lose data.
async function stopRunningTimer(
  client: PoolClient,
  organisationId: string,
  memberId: string,
  actorMemberId: string,
): Promise<EntryRow | null> {
  const running = await client.query<TimerRow>(
    'SELECT * FROM timers WHERE organisation_id = $1 AND member_id = $2 FOR UPDATE',
    [organisationId, memberId],
  );
  const timer = running.rows[0];
  if (!timer) {
    return null;
  }

  // A paused timer ends where the pause began; paused time is never counted.
  const endedAt = timer.paused_at ? new Date(timer.paused_at) : new Date();
  const activeMs =
    endedAt.getTime() -
    new Date(timer.started_at).getTime() -
    timer.paused_seconds * 1000;
  const durationMinutes = Math.max(1, Math.round(activeMs / 60000));
  const entry = await insertEntry(client, {
    organisationId,
    memberId,
    projectId: timer.project_id,
    workItemId: timer.work_item_id,
    description: timer.description,
    source: TIMER_SOURCE,
    startedAt: new Date(timer.started_at),
    endedAt,
    durationMinutes,
    actorMemberId,
  });
  await client.query('DELETE FROM timers WHERE member_id = $1', [memberId]);
  return entry;
}

export async function startTimer(
  db: Db,
  input: {
    organisationId: string;
    memberId: string;
    viewer: Viewer;
    workItemId?: string | null;
    description?: string | null;
  },
): Promise<TimerRow> {
  return db.withTransaction(async (client) => {
    const projectId = await resolveProjectId(
      client,
      input.organisationId,
      input.workItemId ?? null,
    );
    // Checked before the running timer is stopped, so a refused start changes nothing.
    await assertCanEnterTime(
      fromClient(client),
      input.organisationId,
      input.memberId,
      projectId,
    );
    await stopRunningTimer(
      client,
      input.organisationId,
      input.memberId,
      input.memberId,
    );
    const result = await client.query<TimerRow>(
      `INSERT INTO timers
         (member_id, organisation_id, project_id, work_item_id, description, started_at)
       VALUES ($1, $2, $3, $4, $5, now())
       RETURNING *`,
      [
        input.memberId,
        input.organisationId,
        projectId,
        input.workItemId ?? null,
        input.description ?? null,
      ],
    );
    return result.rows[0]!;
  });
}

export type TimerTransition =
  | { ok: true; timer: TimerRow }
  | { ok: false; error: 'no_timer' | 'already_paused' | 'not_paused' };

export async function pauseTimer(
  db: Db,
  input: { organisationId: string; memberId: string },
): Promise<TimerTransition> {
  return db.withTransaction(async (client) => {
    const result = await client.query<TimerRow>(
      `UPDATE timers
          SET paused_at = now(), updated_at = now()
        WHERE organisation_id = $1 AND member_id = $2 AND paused_at IS NULL
        RETURNING *`,
      [input.organisationId, input.memberId],
    );
    if (result.rows[0]) {
      return { ok: true, timer: result.rows[0] };
    }
    const existing = await client.query<TimerRow>(
      'SELECT * FROM timers WHERE organisation_id = $1 AND member_id = $2',
      [input.organisationId, input.memberId],
    );
    return { ok: false, error: existing.rows[0] ? 'already_paused' : 'no_timer' };
  });
}

export async function resumeTimer(
  db: Db,
  input: { organisationId: string; memberId: string },
): Promise<TimerTransition> {
  return db.withTransaction(async (client) => {
    const result = await client.query<TimerRow>(
      `UPDATE timers
          SET paused_seconds = paused_seconds + EXTRACT(EPOCH FROM (now() - paused_at)),
              paused_at = NULL,
              updated_at = now()
        WHERE organisation_id = $1 AND member_id = $2 AND paused_at IS NOT NULL
        RETURNING *`,
      [input.organisationId, input.memberId],
    );
    if (result.rows[0]) {
      return { ok: true, timer: result.rows[0] };
    }
    const existing = await client.query<TimerRow>(
      'SELECT * FROM timers WHERE organisation_id = $1 AND member_id = $2',
      [input.organisationId, input.memberId],
    );
    return { ok: false, error: existing.rows[0] ? 'not_paused' : 'no_timer' };
  });
}

export async function stopTimer(
  db: Db,
  input: { organisationId: string; memberId: string; actorMemberId?: string },
): Promise<EntryRow | null> {
  return db.withTransaction((client) =>
    stopRunningTimer(
      client,
      input.organisationId,
      input.memberId,
      input.actorMemberId ?? input.memberId,
    ),
  );
}

export type ManualEntryInput = {
  organisationId: string;
  memberId: string;
  viewer: Viewer;
  workItemId?: string | null;
  description?: string | null;
  startedAt?: string;
  endedAt?: string;
  date?: string;
  durationMinutes?: number;
};

function resolveTimes(input: ManualEntryInput): {
  startedAt: Date;
  endedAt: Date;
  durationMinutes: number;
} {
  let startedAt: Date | null = input.startedAt ? new Date(input.startedAt) : null;
  let endedAt: Date | null = input.endedAt ? new Date(input.endedAt) : null;

  if (!startedAt && input.date) {
    startedAt = new Date(`${input.date}T00:00:00.000Z`);
  }

  if (startedAt && Number.isNaN(startedAt.getTime())) {
    throw badRequest('startedAt is not a valid date');
  }
  if (endedAt && Number.isNaN(endedAt.getTime())) {
    throw badRequest('endedAt is not a valid date');
  }

  let durationMinutes: number;
  if (input.durationMinutes !== undefined) {
    durationMinutes = input.durationMinutes;
  } else if (startedAt && endedAt) {
    durationMinutes = Math.round(
      (endedAt.getTime() - startedAt.getTime()) / 60000,
    );
  } else {
    throw badRequest('provide a duration or both a start and an end time');
  }

  if (startedAt && endedAt && endedAt.getTime() <= startedAt.getTime()) {
    throw badRequest('end time must be after the start time');
  }

  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    throw badRequest('duration must be greater than zero');
  }

  if (!(startedAt && endedAt)) {
    if (startedAt) {
      endedAt = new Date(startedAt.getTime() + durationMinutes * 60000);
    } else {
      endedAt = new Date();
      startedAt = new Date(endedAt.getTime() - durationMinutes * 60000);
    }
  }

  if (!startedAt || !endedAt) {
    throw badRequest('could not determine the entry time');
  }

  return { startedAt, endedAt, durationMinutes };
}

export async function createManualEntry(
  db: Db,
  input: ManualEntryInput,
): Promise<EntryRow> {
  const times = resolveTimes(input);
  return db.withTransaction(async (client) => {
    const projectId = await resolveProjectId(
      client,
      input.organisationId,
      input.workItemId ?? null,
    );
    await assertCanEnterTime(
      fromClient(client),
      input.organisationId,
      input.memberId,
      projectId,
    );
    return insertEntry(client, {
      organisationId: input.organisationId,
      memberId: input.memberId,
      projectId,
      workItemId: input.workItemId ?? null,
      description: input.description ?? null,
      source: MANUAL_SOURCE,
      startedAt: times.startedAt,
      endedAt: times.endedAt,
      durationMinutes: times.durationMinutes,
      actorMemberId: input.memberId,
    });
  });
}

export async function listEntries(
  db: Db,
  organisationId: string,
  viewer: Viewer,
  filter: {
    memberId?: string;
    projectId?: string;
    from?: string;
    to?: string;
    includeDeleted?: boolean;
  } = {},
): Promise<EntryRow[]> {
  const params: unknown[] = [
    organisationId,
    filter.memberId ?? null,
    filter.projectId ?? null,
    filter.from ?? null,
    filter.to ?? null,
    filter.includeDeleted ?? false,
  ];
  const readable = readableOrUnassignedSql(viewer, 'time_entries.project_id', params);
  return db.query<EntryRow>(
    `SELECT time_entries.*, wp.workspace_slug
       FROM time_entries
       LEFT JOIN projects wp ON wp.id = time_entries.project_id
      WHERE time_entries.organisation_id = $1
        AND ($2::uuid IS NULL OR time_entries.member_id = $2)
        AND ($3::uuid IS NULL OR time_entries.project_id = $3)
        AND ($4::timestamptz IS NULL OR time_entries.ended_at >= $4)
        AND ($5::timestamptz IS NULL OR time_entries.started_at <= $5)
        AND ($6::boolean OR time_entries.deleted_at IS NULL)
        AND ${readable}
      ORDER BY time_entries.started_at DESC`,
    params,
  );
}

export async function getEntry(
  db: Db,
  organisationId: string,
  entryId: string,
): Promise<EntryRow | undefined> {
  const rows = await db.query<EntryRow>(
    'SELECT * FROM time_entries WHERE organisation_id = $1 AND id = $2',
    [organisationId, entryId],
  );
  return rows[0];
}

export type UpdateEntryInput = {
  organisationId: string;
  actorMemberId: string;
  viewer: Viewer;
  entryId: string;
  workItemId?: string | null;
  description?: string | null;
  startedAt?: string;
  endedAt?: string;
  durationMinutes?: number;
};

export async function updateEntry(
  db: Db,
  input: UpdateEntryInput,
): Promise<EntryRow | undefined> {
  return db.withTransaction(async (client) => {
    const existing = await client.query<EntryRow>(
      'SELECT * FROM time_entries WHERE organisation_id = $1 AND id = $2 AND deleted_at IS NULL FOR UPDATE',
      [input.organisationId, input.entryId],
    );
    const before = existing.rows[0];
    if (!before) {
      return undefined;
    }
    // Recorded time on a project the editor no longer belongs to is history.
    await assertCanEditRecorded(client, input, before.project_id);

    const startedAt = input.startedAt
      ? new Date(input.startedAt)
      : new Date(before.started_at);
    const endedAt = input.endedAt ? new Date(input.endedAt) : new Date(before.ended_at);
    if (Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime())) {
      throw badRequest('start or end time is not a valid date');
    }

    let durationMinutes = input.durationMinutes ?? before.duration_minutes;
    if (input.startedAt || input.endedAt) {
      durationMinutes = Math.round(
        (endedAt.getTime() - startedAt.getTime()) / 60000,
      );
    }
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      throw badRequest('duration must be greater than zero');
    }
    if (endedAt.getTime() <= startedAt.getTime()) {
      throw badRequest('end time must be after the start time');
    }

    const workItemId =
      input.workItemId === undefined ? before.work_item_id : input.workItemId;
    const projectId =
      input.workItemId === undefined
        ? before.project_id
        : await resolveProjectId(client, input.organisationId, workItemId);
    if (projectId !== before.project_id) {
      // Moving time to another project is new entry on that project.
      await assertCanEnterTime(
        fromClient(client),
        input.organisationId,
        input.actorMemberId,
        projectId,
      );
    }

    const result = await client.query<EntryRow>(
      `UPDATE time_entries
          SET work_item_id = $1, project_id = $2, description = $3,
              started_at = $4, ended_at = $5, duration_minutes = $6,
              billable_minutes = $7, updated_at = now()
        WHERE id = $8
        RETURNING *`,
      [
        workItemId,
        projectId,
        input.description === undefined ? before.description : input.description,
        startedAt,
        endedAt,
        durationMinutes,
        billableMinutes(durationMinutes),
        before.id,
      ],
    );
    const after = result.rows[0]!;

    await writeHistory(client, {
      entryId: before.id,
      organisationId: input.organisationId,
      actorMemberId: input.actorMemberId,
      action: 'updated',
      before,
      after,
    });
    await recordFeedback(client, {
      organisationId: input.organisationId,
      memberId: before.member_id,
      action: 'updated',
      before,
      after,
    });
    return after;
  });
}

export async function deleteEntry(
  db: Db,
  input: {
    organisationId: string;
    actorMemberId: string;
    viewer: Viewer;
    entryId: string;
  },
): Promise<boolean> {
  return db.withTransaction(async (client) => {
    const existing = await client.query<EntryRow>(
      'SELECT * FROM time_entries WHERE organisation_id = $1 AND id = $2 AND deleted_at IS NULL FOR UPDATE',
      [input.organisationId, input.entryId],
    );
    const before = existing.rows[0];
    if (!before) {
      return false;
    }
    await assertCanEditRecorded(client, input, before.project_id);
    await client.query(
      'UPDATE time_entries SET deleted_at = now(), updated_at = now() WHERE id = $1',
      [before.id],
    );
    await writeHistory(client, {
      entryId: before.id,
      organisationId: input.organisationId,
      actorMemberId: input.actorMemberId,
      action: 'deleted',
      before,
      after: null,
    });
    await recordFeedback(client, {
      organisationId: input.organisationId,
      memberId: before.member_id,
      action: 'deleted',
      before,
      after: null,
    });
    return true;
  });
}

export async function listEntryHistory(
  db: Db,
  organisationId: string,
  entryId: string,
): Promise<QueryResultRow[]> {
  return db.query(
    `SELECT id, entry_id, actor_member_id, action, before_state, after_state, created_at
       FROM time_entry_history
      WHERE organisation_id = $1 AND entry_id = $2
      ORDER BY created_at ASC`,
    [organisationId, entryId],
  );
}
