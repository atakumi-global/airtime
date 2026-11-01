import { createHash } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import type { Db } from '../db/pool.js';
import type { MemberRow } from '../types.js';
import { writeAudit } from './audit.js';

/**
 * Workspace access rule (AIRTIME-90).
 *
 * A member may work with a Plane-linked project when Plane lists them as a
 * member of that project, checked with the member's own token. The result is
 * stored per member and project in `project_access`:
 *   - 'member': a current member; may read the project and enter new time.
 *   - 'former': was a member; the history stays readable, nothing new may be
 *     entered.
 * Administrators read and enter time on every project. Projects without a Plane
 * link are not tied to a workspace and stay open to everyone in the
 * organisation.
 */
export type Viewer = {
  memberId: string;
  /** Administrators read and enter time on every project. */
  unrestricted: boolean;
};

export function viewerOf(member: Pick<MemberRow, 'id' | 'role'>): Viewer {
  return { memberId: member.id, unrestricted: member.role === 'administrator' };
}

export type AccessLevel = 'none' | 'read' | 'write';

export class AccessError extends Error {
  readonly statusCode = 403;
  constructor(message = 'project_access_required') {
    super(message);
    this.name = 'AccessError';
  }
}

export class ProjectArchivedError extends Error {
  readonly statusCode = 409;
  constructor(message = 'project_archived') {
    super(message);
    this.name = 'ProjectArchivedError';
  }
}

export class ProjectNotFoundError extends Error {
  readonly statusCode = 404;
  constructor(message = 'project_not_found') {
    super(message);
    this.name = 'ProjectNotFoundError';
  }
}

export type Querier = Pick<Db, 'query'>;

/** Lets code that runs inside a transaction use the same query helpers. */
export function fromClient(client: PoolClient): Querier {
  return {
    query: async <R extends QueryResultRow = QueryResultRow>(
      text: string,
      params: unknown[] = [],
    ): Promise<R[]> => (await client.query<R>(text, params)).rows,
  };
}

/**
 * SQL condition that is true when `projectExpr` is a project the viewer may
 * read. Appends its parameters to `params` and returns the condition.
 */
export function readableProjectSql(
  viewer: Viewer,
  projectExpr: string,
  params: unknown[],
): string {
  params.push(viewer.unrestricted);
  const unrestricted = `$${params.length}::boolean`;
  params.push(viewer.memberId);
  const memberParam = `$${params.length}::uuid`;
  return `(${unrestricted}
    OR EXISTS (SELECT 1 FROM project_access pa
                WHERE pa.project_id = ${projectExpr} AND pa.member_id = ${memberParam})
    OR EXISTS (SELECT 1 FROM projects np
                WHERE np.id = ${projectExpr} AND np.plane_project_id IS NULL))`;
}

/**
 * SQL condition that is true when the project is one the viewer may read, or
 * when the row has no project at all (time without a work item).
 */
export function readableOrUnassignedSql(
  viewer: Viewer,
  projectExpr: string,
  params: unknown[],
): string {
  return `(${projectExpr} IS NULL OR ${readableProjectSql(viewer, projectExpr, params)})`;
}

/**
 * SQL expression that is true when the member may enter new time on the
 * project: a current Plane member, or a project with no Plane link, and the
 * project is not archived in Plane (archived projects stay readable history).
 */
export function enterableProjectSql(
  memberId: string,
  projectExpr: string,
  params: unknown[],
): string {
  params.push(memberId);
  const memberParam = `$${params.length}::uuid`;
  return `((EXISTS (SELECT 1 FROM project_access pa
                     WHERE pa.project_id = ${projectExpr}
                       AND pa.member_id = ${memberParam} AND pa.status = 'member')
     OR EXISTS (SELECT 1 FROM projects np
                 WHERE np.id = ${projectExpr} AND np.plane_project_id IS NULL))
    AND NOT EXISTS (SELECT 1 FROM projects ap
                     WHERE ap.id = ${projectExpr} AND ap.archived))`;
}

export async function getProjectAccess(
  db: Querier,
  organisationId: string,
  viewer: Viewer,
  projectId: string,
): Promise<AccessLevel> {
  const rows = await db.query<{ plane_linked: boolean; status: string | null }>(
    `SELECT (p.plane_project_id IS NOT NULL) AS plane_linked, pa.status
       FROM projects p
       LEFT JOIN project_access pa
              ON pa.project_id = p.id AND pa.member_id = $3
      WHERE p.organisation_id = $1 AND p.id = $2`,
    [organisationId, projectId, viewer.memberId],
  );
  const row = rows[0];
  if (!row) {
    return 'none';
  }
  if (viewer.unrestricted || !row.plane_linked || row.status === 'member') {
    return 'write';
  }
  if (row.status === 'former') {
    return 'read';
  }
  return 'none';
}

/**
 * Guard for changes to a project's own data (budget, rates, expenses, client).
 * A project the viewer cannot read does not exist for them (404); a project
 * they only read as history refuses changes (403). Administrators pass.
 */
export async function assertCanWriteProject(
  db: Querier,
  organisationId: string,
  viewer: Viewer,
  projectId: string,
): Promise<void> {
  const level = await getProjectAccess(db, organisationId, viewer, projectId);
  if (level === 'none') {
    throw new ProjectNotFoundError();
  }
  if (level === 'read') {
    throw new AccessError('project_access_required');
  }
}

/**
 * Guard for new time: the member needs current Plane membership of the project.
 * Administrators need it too (they see every project but do not work on every
 * one). History of a former project stays readable but cannot grow. A null
 * project (no work item) is not workspace related and passes.
 */
export async function assertCanEnterTime(
  db: Querier,
  organisationId: string,
  memberId: string,
  projectId: string | null,
): Promise<void> {
  if (!projectId) {
    return;
  }
  const level = await getProjectAccess(
    db,
    organisationId,
    { memberId, unrestricted: false },
    projectId,
  );
  if (level !== 'write') {
    throw new AccessError('project_access_required');
  }
  const archived = await db.query(
    'SELECT 1 FROM projects WHERE organisation_id = $1 AND id = $2 AND archived',
    [organisationId, projectId],
  );
  if (archived[0]) {
    throw new ProjectArchivedError();
  }
}

/** True when the viewer may read data tied to the project (null = unassigned). */
export async function canReadProject(
  db: Querier,
  organisationId: string,
  viewer: Viewer,
  projectId: string | null,
): Promise<boolean> {
  if (!projectId) {
    return true;
  }
  return (await getProjectAccess(db, organisationId, viewer, projectId)) !== 'none';
}

export type AccessibleProject = { workspaceSlug: string; planeProjectId: string };

/**
 * Permission-change fingerprint: a sha-256 over the sorted set of Plane
 * projects (workspace slug and project id) the member belongs to. Two equal
 * fingerprints mean the member's permissions did not change.
 */
export function computeAccessHash(projects: AccessibleProject[]): string {
  const lines = projects
    .map((project) => `${project.workspaceSlug}/${project.planeProjectId}`)
    .sort();
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

/**
 * Stores the outcome of a live Plane check for one member. Projects Plane lists
 * the member in become 'member'; rows that were 'member' and are no longer
 * listed become 'former', which keeps their history readable. The fingerprint
 * and check time go on the connection. A fingerprint change is audited.
 */
export async function applyMemberAccess(
  db: Db,
  input: {
    organisationId: string;
    memberId: string;
    connectionId: string;
    previousHash: string | null;
    accessible: AccessibleProject[];
  },
): Promise<{ hash: string; changed: boolean }> {
  const hash = computeAccessHash(input.accessible);
  const changed = hash !== input.previousHash;
  const keys = input.accessible.map(
    (project) => `${project.workspaceSlug}/${project.planeProjectId}`,
  );
  await db.withTransaction(async (client) => {
    await client.query(
      `INSERT INTO project_access (member_id, project_id, organisation_id, status)
       SELECT $1, p.id, p.organisation_id, 'member'
         FROM projects p
        WHERE p.organisation_id = $2
          AND p.plane_project_id IS NOT NULL
          AND (p.workspace_slug || '/' || p.plane_project_id) = ANY($3::text[])
       ON CONFLICT (member_id, project_id) DO UPDATE
         SET status = 'member', verified_at = now(), updated_at = now()`,
      [input.memberId, input.organisationId, keys],
    );
    await client.query(
      `UPDATE project_access pa
          SET status = 'former', updated_at = now()
         FROM projects p
        WHERE p.id = pa.project_id
          AND pa.member_id = $1
          AND pa.status = 'member'
          AND NOT (
            p.workspace_slug IS NOT NULL
            AND (p.workspace_slug || '/' || p.plane_project_id) = ANY($2::text[])
          )`,
      [input.memberId, keys],
    );
    await client.query(
      `UPDATE plane_connections
          SET access_hash = $1, access_checked_at = now()
        WHERE id = $2`,
      [hash, input.connectionId],
    );
    if (changed) {
      await writeAudit(client, {
        organisationId: input.organisationId,
        actorMemberId: input.memberId,
        action: 'access.changed',
        entityType: 'member',
        entityId: input.memberId,
        before: { accessHash: input.previousHash },
        after: { accessHash: hash, projectCount: keys.length },
      });
    }
  });
  return { hash, changed };
}

/**
 * A member who stops reading a workspace no longer sees its projects. Where
 * they recorded time the project stays readable as history ('former'); every
 * other access row for that workspace is removed. Time entries, budgets, rates
 * and audit records are never touched.
 */
export async function releaseWorkspaceAccess(
  client: PoolClient,
  memberId: string,
  organisationId: string,
  workspaceSlugs: string[],
): Promise<void> {
  if (workspaceSlugs.length === 0) {
    return;
  }
  const slugs = workspaceSlugs.map((slug) => slug.toLowerCase());
  await client.query(
    `DELETE FROM project_access pa
      USING projects p
      WHERE p.id = pa.project_id
        AND pa.member_id = $1
        AND pa.organisation_id = $2
        AND lower(p.workspace_slug) = ANY($3::text[])
        AND NOT EXISTS (
          SELECT 1 FROM time_entries e
           WHERE e.project_id = p.id AND e.member_id = $1
        )
        AND NOT EXISTS (
          SELECT 1 FROM timers t WHERE t.project_id = p.id AND t.member_id = $1
        )`,
    [memberId, organisationId, slugs],
  );
  await client.query(
    `UPDATE project_access pa
        SET status = 'former', updated_at = now()
       FROM projects p
      WHERE p.id = pa.project_id
        AND pa.member_id = $1
        AND pa.organisation_id = $2
        AND pa.status = 'member'
        AND lower(p.workspace_slug) = ANY($3::text[])`,
    [memberId, organisationId, slugs],
  );
}

/** A member who disconnects can no longer be verified: history only. */
export async function revokeMemberAccess(
  client: PoolClient,
  memberId: string,
): Promise<void> {
  await client.query(
    `UPDATE project_access SET status = 'former', updated_at = now()
      WHERE member_id = $1 AND status = 'member'`,
    [memberId],
  );
}
