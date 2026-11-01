import { randomUUID } from 'node:crypto';
import type { Db } from '../db/pool.js';
import {
  assertCanWriteProject,
  enterableProjectSql,
  readableProjectSql,
  type Viewer,
} from './access.js';

export type ProjectRow = {
  id: string;
  organisation_id: string;
  plane_project_id: string | null;
  workspace_slug: string | null;
  name: string;
  identifier: string | null;
  archived: boolean;
  client_id: string | null;
  start_date: Date | string | null;
  target_date: Date | string | null;
  synced_at: Date | null;
  created_at: Date;
  updated_at: Date;
  /** False when the viewer may read the project as history but not enter new time. */
  can_enter_time?: boolean;
};

export async function listProjects(
  db: Db,
  organisationId: string,
  viewer: Viewer,
): Promise<ProjectRow[]> {
  const params: unknown[] = [organisationId];
  const readable = readableProjectSql(viewer, 'projects.id', params);
  const enterable = enterableProjectSql(viewer.memberId, 'projects.id', params);
  return db.query<ProjectRow>(
    `SELECT projects.*, ${enterable} AS can_enter_time FROM projects
      WHERE organisation_id = $1 AND ${readable}
      ORDER BY name ASC`,
    params,
  );
}

/** A project the viewer may read; undefined when it does not exist or is hidden. */
export async function getProject(
  db: Db,
  organisationId: string,
  projectId: string,
  viewer: Viewer,
): Promise<ProjectRow | undefined> {
  const params: unknown[] = [organisationId, projectId];
  const readable = readableProjectSql(viewer, 'projects.id', params);
  const enterable = enterableProjectSql(viewer.memberId, 'projects.id', params);
  const rows = await db.query<ProjectRow>(
    `SELECT projects.*, ${enterable} AS can_enter_time FROM projects
      WHERE organisation_id = $1 AND id = $2 AND ${readable}`,
    params,
  );
  return rows[0];
}

export async function createProject(
  db: Db,
  input: {
    organisationId: string;
    name: string;
    planeProjectId?: string;
    clientId?: string | null;
  },
): Promise<ProjectRow> {
  const rows = await db.query<ProjectRow>(
    `INSERT INTO projects (id, organisation_id, name, plane_project_id, client_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      randomUUID(),
      input.organisationId,
      input.name,
      input.planeProjectId ?? null,
      input.clientId ?? null,
    ],
  );
  return rows[0]!;
}

export async function updateProjectClient(
  db: Db,
  organisationId: string,
  projectId: string,
  clientId: string | null,
  viewer: Viewer,
): Promise<ProjectRow | undefined> {
  const exists = await db.query(
    'SELECT 1 FROM projects WHERE organisation_id = $1 AND id = $2',
    [organisationId, projectId],
  );
  if (!exists[0]) {
    return undefined;
  }
  await assertCanWriteProject(db, organisationId, viewer, projectId);
  const rows = await db.query<ProjectRow>(
    `UPDATE projects SET client_id = $1, updated_at = now()
      WHERE organisation_id = $2 AND id = $3
      RETURNING *`,
    [clientId, organisationId, projectId],
  );
  return rows[0];
}
