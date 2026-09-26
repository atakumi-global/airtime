import { randomUUID } from 'node:crypto';
import type { Db } from '../db/pool.js';

export type ProjectRow = {
  id: string;
  organisation_id: string;
  plane_project_id: string | null;
  name: string;
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
  input: { organisationId: string; name: string; planeProjectId?: string },
): Promise<ProjectRow> {
  const rows = await db.query<ProjectRow>(
    `INSERT INTO projects (id, organisation_id, name, plane_project_id)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [randomUUID(), input.organisationId, input.name, input.planeProjectId ?? null],
  );
  return rows[0]!;
}
