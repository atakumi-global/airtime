import { randomUUID } from 'node:crypto';
import type { Db } from '../db/pool.js';
import {
  isIssueOpen,
  PlaneClient,
  type PlaneIssue,
  type PlaneProject,
} from './client.js';
import {
  markConnectionError,
  markConnectionSynced,
  openConnectionToken,
  type PlaneConnectionRow,
} from '../services/connections.js';

export type SyncSummary = {
  projects: number;
  workItems: number;
};

const inFlight = new Map<string, Promise<SyncSummary>>();

export function syncConnection(
  db: Db,
  connection: PlaneConnectionRow,
  key: Buffer,
  trigger: string,
): Promise<SyncSummary> {
  const running = inFlight.get(connection.id);
  if (running) {
    return running;
  }
  const promise = performSync(db, connection, key, trigger).finally(() => {
    inFlight.delete(connection.id);
  });
  inFlight.set(connection.id, promise);
  return promise;
}

async function upsertProject(
  db: Db,
  organisationId: string,
  project: PlaneProject,
): Promise<string> {
  const existing = await db.query<{ id: string }>(
    'SELECT id FROM projects WHERE organisation_id = $1 AND plane_project_id = $2',
    [organisationId, project.id],
  );
  const identifier = project.identifier ?? null;
  const archived = Boolean(project.archived_at);
  const startDate = toDateOnly(project.start_date);
  const targetDate = toDateOnly(project.target_date);

  if (existing[0]) {
    await db.query(
      `UPDATE projects
          SET name = $1, identifier = $2, archived = $3,
              start_date = $4, target_date = $5, synced_at = now(), updated_at = now()
        WHERE id = $6`,
      [project.name, identifier, archived, startDate, targetDate, existing[0].id],
    );
    return existing[0].id;
  }

  const id = randomUUID();
  await db.query(
    `INSERT INTO projects
       (id, organisation_id, plane_project_id, name, identifier, archived, start_date, target_date, synced_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())`,
    [id, organisationId, project.id, project.name, identifier, archived, startDate, targetDate],
  );
  return id;
}

function toDateOnly(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return value.slice(0, 10);
}

async function upsertWorkItem(
  db: Db,
  organisationId: string,
  projectId: string,
  projectIdentifier: string | null,
  issue: PlaneIssue,
): Promise<void> {
  const identifier =
    projectIdentifier && issue.sequence_id !== undefined
      ? `${projectIdentifier}-${issue.sequence_id}`
      : null;
  const stateGroup = issue.state_detail?.group ?? issue.state_group ?? null;

  await db.query(
    `INSERT INTO work_items
       (id, organisation_id, project_id, plane_work_item_id, identifier, name,
        state_group, is_open, plane_updated_at, synced_at, raw)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), $10)
     ON CONFLICT (organisation_id, plane_work_item_id) DO UPDATE
       SET project_id = EXCLUDED.project_id,
           identifier = EXCLUDED.identifier,
           name = EXCLUDED.name,
           state_group = EXCLUDED.state_group,
           is_open = EXCLUDED.is_open,
           plane_updated_at = EXCLUDED.plane_updated_at,
           synced_at = now(),
           raw = EXCLUDED.raw`,
    [
      randomUUID(),
      organisationId,
      projectId,
      issue.id,
      identifier,
      issue.name,
      stateGroup,
      isIssueOpen(issue),
      issue.updated_at ? new Date(issue.updated_at) : null,
      JSON.stringify(issue),
    ],
  );
}

async function performSync(
  db: Db,
  connection: PlaneConnectionRow,
  key: Buffer,
  trigger: string,
): Promise<SyncSummary> {
  const runId = randomUUID();
  await db.query(
    `INSERT INTO plane_sync_runs (id, organisation_id, connection_id, trigger, status)
     VALUES ($1, $2, $3, $4, 'error')`,
    [runId, connection.organisation_id, connection.id, trigger],
  );

  try {
    const client = new PlaneClient({
      baseUrl: connection.base_url,
      workspaceSlug: connection.workspace_slug,
      token: openConnectionToken(connection, key),
    });

    const projects = await client.listProjects();
    let workItems = 0;
    for (const project of projects) {
      const projectId = await upsertProject(
        db,
        connection.organisation_id,
        project,
      );
      const issues = await client.listIssues(project.id);
      for (const issue of issues) {
        await upsertWorkItem(
          db,
          connection.organisation_id,
          projectId,
          project.identifier ?? null,
          issue,
        );
        workItems += 1;
      }
    }

    await db.query(
      `UPDATE plane_sync_runs
          SET status = 'ok', projects_synced = $1, work_items_synced = $2, finished_at = now()
        WHERE id = $3`,
      [projects.length, workItems, runId],
    );
    if (connection.status !== 'active' || connection.last_error) {
      await markConnectionSynced(db, connection.id);
    } else {
      await db.query(
        'UPDATE plane_connections SET last_synced_at = now(), updated_at = now() WHERE id = $1',
        [connection.id],
      );
    }
    return { projects: projects.length, workItems };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.query(
      `UPDATE plane_sync_runs SET status = 'error', error = $1, finished_at = now() WHERE id = $2`,
      [message.slice(0, 500), runId],
    );
    await markConnectionError(db, connection.id, message);
    throw error;
  }
}
