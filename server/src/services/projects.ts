import { randomUUID } from 'node:crypto';
import type { Db } from '../db/pool.js';

export type ProjectRow = {
  id: string;
  organisation_id: string;
  plane_project_id: string | null;
  name: string;
  identifier: string | null;
  archived: boolean;
  client_id: string | null;
  start_date: Date | string | null;
  target_date: Date | string | null;
  synced_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export async function listProjects(
  db: Db,
  organisationId: string,
): Promise<ProjectRow[]> {
  return db.query<ProjectRow>(
    'SELECT * FROM projects WHERE organisation_id = $1 ORDER BY name ASC',
    [organisationId],
  );
}

export async function getProject(
  db: Db,
  organisationId: string,
  projectId: string,
): Promise<ProjectRow | undefined> {
  const rows = await db.query<ProjectRow>(
    'SELECT * FROM projects WHERE organisation_id = $1 AND id = $2',
    [organisationId, projectId],
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
): Promise<ProjectRow | undefined> {
  const rows = await db.query<ProjectRow>(
    `UPDATE projects SET client_id = $1, updated_at = now()
      WHERE organisation_id = $2 AND id = $3
      RETURNING *`,
    [clientId, organisationId, projectId],
  );
  return rows[0];
}
