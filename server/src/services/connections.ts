import { randomBytes, randomUUID } from 'node:crypto';
import type { Db } from '../db/pool.js';
import { decryptToken, encryptToken } from '../crypto/tokens.js';
import { releaseWorkspaceAccess, revokeMemberAccess } from './access.js';
import type { WorkspaceCheck } from '../plane/workspaces.js';
import type { WorkspaceErrorCategory } from '../plane/client.js';

export type ConnectionWorkspaceRow = {
  id: string;
  connection_id: string;
  organisation_id: string;
  slug: string;
  status: 'pending' | 'verified' | 'failed';
  error_category: WorkspaceErrorCategory | null;
  last_error: string | null;
  project_count: number | null;
  webhook_secret: string | null;
  last_verified_at: Date | null;
  last_synced_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type PlaneConnectionRow = {
  id: string;
  organisation_id: string;
  member_id: string;
  base_url: string;
  /** Obsolete single slug (AIRTIME-28); kept for rollback, no longer written. */
  workspace_slug: string | null;
  /** The configured workspaces, in the order the member listed them. */
  workspaces: ConnectionWorkspaceRow[];
  encrypted_token: string;
  webhook_secret: string | null;
  status: 'active' | 'error';
  last_verified_at: Date | null;
  last_synced_at: Date | null;
  last_error: string | null;
  access_hash: string | null;
  access_checked_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

/** The Plane workspaces a connection reads: every slug the member configured. */
export function connectionWorkspaces(connection: PlaneConnectionRow): string[] {
  return connection.workspaces.map((workspace) => workspace.slug);
}

type ConnectionRecord = Omit<PlaneConnectionRow, 'workspaces'>;

async function withWorkspaces(
  db: Db,
  records: ConnectionRecord[],
): Promise<PlaneConnectionRow[]> {
  if (records.length === 0) {
    return [];
  }
  const workspaces = await db.query<ConnectionWorkspaceRow>(
    `SELECT * FROM plane_connection_workspaces
      WHERE connection_id = ANY($1::uuid[])
      ORDER BY created_at ASC, slug ASC`,
    [records.map((record) => record.id)],
  );
  return records.map((record) => ({
    ...record,
    workspaces: workspaces.filter((workspace) => workspace.connection_id === record.id),
  }));
}

export async function getConnectionForMember(
  db: Db,
  organisationId: string,
  memberId: string,
): Promise<PlaneConnectionRow | undefined> {
  const rows = await db.query<ConnectionRecord>(
    'SELECT * FROM plane_connections WHERE organisation_id = $1 AND member_id = $2',
    [organisationId, memberId],
  );
  return (await withWorkspaces(db, rows))[0];
}

export async function getConnectionById(
  db: Db,
  connectionId: string,
): Promise<PlaneConnectionRow | undefined> {
  const rows = await db.query<ConnectionRecord>(
    'SELECT * FROM plane_connections WHERE id = $1',
    [connectionId],
  );
  return (await withWorkspaces(db, rows))[0];
}

/**
 * Plane registers webhooks per workspace, so each configured workspace has its
 * own secret. A delivery names the one workspace that changed.
 */
export async function getConnectionByWebhookSecret(
  db: Db,
  secret: string,
): Promise<{ connection: PlaneConnectionRow; workspaceSlug: string } | undefined> {
  const rows = await db.query<ConnectionRecord & { webhook_workspace: string }>(
    `SELECT c.*, w.slug AS webhook_workspace
       FROM plane_connection_workspaces w
       JOIN plane_connections c ON c.id = w.connection_id
       JOIN members m ON m.id = c.member_id
      WHERE w.webhook_secret = $1 AND m.status = 'active'`,
    [secret],
  );
  const row = rows[0];
  if (!row) {
    return undefined;
  }
  const { webhook_workspace: workspaceSlug, ...record } = row;
  const connection = (await withWorkspaces(db, [record]))[0]!;
  return { connection, workspaceSlug };
}

export async function listActiveConnections(
  db: Db,
): Promise<PlaneConnectionRow[]> {
  const rows = await db.query<ConnectionRecord>(
    `SELECT c.* FROM plane_connections c
       JOIN members m ON m.id = c.member_id
      WHERE m.status = 'active'
      ORDER BY c.created_at ASC`,
  );
  return withWorkspaces(db, rows);
}

export type UpsertConnectionInput = {
  organisationId: string;
  memberId: string;
  baseUrl: string;
  /** Normalised, de-duplicated slugs, in the member's order. */
  workspaces: WorkspaceCheck[];
  token: string;
  key: Buffer;
};

export type UpsertConnectionResult = {
  connection: PlaneConnectionRow;
  /** Slugs the member had configured before and no longer lists. */
  removedSlugs: string[];
};

/**
 * Stores the connection and replaces its workspace list in one transaction.
 * Slugs that stay keep their webhook secret and sync history; new slugs get a
 * fresh webhook secret; slugs that were dropped are removed.
 */
export async function upsertConnection(
  db: Db,
  input: UpsertConnectionInput,
): Promise<UpsertConnectionResult> {
  const encryptedToken = encryptToken(input.token, input.key);
  const existing = await getConnectionForMember(
    db,
    input.organisationId,
    input.memberId,
  );
  const wanted = new Set(input.workspaces.map((workspace) => workspace.slug.toLowerCase()));
  const removedSlugs = (existing?.workspaces ?? [])
    .map((workspace) => workspace.slug)
    .filter((slug) => !wanted.has(slug.toLowerCase()));

  const connectionId = await db.withTransaction(async (client) => {
    const saved = await client.query<{ id: string }>(
      `INSERT INTO plane_connections
         (id, organisation_id, member_id, base_url, encrypted_token,
          status, last_verified_at, last_error)
       VALUES ($1, $2, $3, $4, $5, 'active', now(), NULL)
       ON CONFLICT (member_id) DO UPDATE
         SET base_url = EXCLUDED.base_url,
             encrypted_token = EXCLUDED.encrypted_token,
             status = 'active',
             last_verified_at = now(),
             last_error = NULL,
             updated_at = now()
       RETURNING id`,
      [
        existing?.id ?? randomUUID(),
        input.organisationId,
        input.memberId,
        input.baseUrl,
        encryptedToken,
      ],
    );
    const id = saved.rows[0]!.id;

    await client.query(
      `DELETE FROM plane_connection_workspaces
        WHERE connection_id = $1 AND NOT (lower(slug) = ANY($2::text[]))`,
      [id, [...wanted]],
    );
    await releaseWorkspaceAccess(client, input.memberId, input.organisationId, removedSlugs);
    for (const workspace of input.workspaces) {
      await client.query(
        `INSERT INTO plane_connection_workspaces
           (id, connection_id, organisation_id, slug, status, error_category,
            last_error, project_count, webhook_secret, last_verified_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
         ON CONFLICT (connection_id, lower(slug)) DO UPDATE
           SET slug = EXCLUDED.slug,
               status = EXCLUDED.status,
               error_category = EXCLUDED.error_category,
               last_error = EXCLUDED.last_error,
               project_count = EXCLUDED.project_count,
               last_verified_at = now(),
               updated_at = now()`,
        [
          randomUUID(),
          id,
          input.organisationId,
          workspace.slug,
          workspace.status,
          workspace.errorCategory,
          workspace.error,
          workspace.projectCount,
          randomBytes(24).toString('hex'),
        ],
      );
    }
    return id;
  });

  const connection = (await getConnectionById(db, connectionId))!;
  return { connection, removedSlugs };
}

/** Records the outcome of a live check of one workspace. */
export async function recordWorkspaceCheck(
  db: Db,
  connectionId: string,
  check: WorkspaceCheck,
): Promise<void> {
  await db.query(
    `UPDATE plane_connection_workspaces
        SET status = $3, error_category = $4, last_error = $5,
            project_count = COALESCE($6, project_count),
            last_verified_at = CASE WHEN $3 = 'verified' THEN now() ELSE last_verified_at END,
            updated_at = now()
      WHERE connection_id = $1 AND lower(slug) = lower($2)`,
    [
      connectionId,
      check.slug,
      check.status,
      check.errorCategory,
      check.error,
      check.projectCount,
    ],
  );
}

/** Marks a workspace as synced successfully, which also clears an earlier failure. */
export async function markWorkspaceSynced(
  db: Db,
  connectionId: string,
  slug: string,
  projectCount: number,
): Promise<void> {
  await db.query(
    `UPDATE plane_connection_workspaces
        SET status = 'verified', error_category = NULL, last_error = NULL,
            project_count = $3, last_synced_at = now(), last_verified_at = now(),
            updated_at = now()
      WHERE connection_id = $1 AND lower(slug) = lower($2)`,
    [connectionId, slug, projectCount],
  );
}

export async function deleteConnection(
  db: Db,
  organisationId: string,
  memberId: string,
): Promise<boolean> {
  // Without a connection Airtime cannot verify the member against Plane, so
  // current access becomes history in the same step.
  return db.withTransaction(async (client) => {
    const result = await client.query(
      'DELETE FROM plane_connections WHERE organisation_id = $1 AND member_id = $2 RETURNING id',
      [organisationId, memberId],
    );
    await revokeMemberAccess(client, memberId);
    return (result.rowCount ?? 0) > 0;
  });
}

export async function markConnectionSynced(
  db: Db,
  connectionId: string,
): Promise<void> {
  await db.query(
    `UPDATE plane_connections
        SET status = 'active', last_synced_at = now(), last_error = NULL, updated_at = now()
      WHERE id = $1`,
    [connectionId],
  );
}

export async function markConnectionError(
  db: Db,
  connectionId: string,
  message: string,
): Promise<void> {
  await db.query(
    `UPDATE plane_connections
        SET status = 'error', last_error = $1, updated_at = now()
      WHERE id = $2`,
    [message.slice(0, 500), connectionId],
  );
}

export function openConnectionToken(
  connection: PlaneConnectionRow,
  key: Buffer,
): string {
  return decryptToken(connection.encrypted_token, key);
}

export type PublicWorkspace = {
  slug: string;
  status: 'pending' | 'verified' | 'failed';
  errorCategory: WorkspaceErrorCategory | null;
  error: string | null;
  projectCount: number | null;
  lastVerifiedAt: Date | null;
  lastSyncedAt: Date | null;
  webhookPath: string | null;
};

export function toPublicWorkspace(workspace: ConnectionWorkspaceRow): PublicWorkspace {
  return {
    slug: workspace.slug,
    status: workspace.status,
    errorCategory: workspace.error_category,
    error: workspace.last_error,
    projectCount: workspace.project_count,
    lastVerifiedAt: workspace.last_verified_at,
    lastSyncedAt: workspace.last_synced_at,
    webhookPath: workspace.webhook_secret
      ? `/api/plane/webhook/${workspace.webhook_secret}`
      : null,
  };
}

export function toPublicConnection(connection: PlaneConnectionRow): {
  baseUrl: string;
  workspaces: PublicWorkspace[];
  status: string;
  lastVerifiedAt: Date | null;
  lastSyncedAt: Date | null;
  lastError: string | null;
  accessHash: string | null;
  accessCheckedAt: Date | null;
} {
  return {
    baseUrl: connection.base_url,
    workspaces: connection.workspaces.map(toPublicWorkspace),
    status: connection.status,
    lastVerifiedAt: connection.last_verified_at,
    lastSyncedAt: connection.last_synced_at,
    lastError: connection.last_error,
    accessHash: connection.access_hash,
    accessCheckedAt: connection.access_checked_at,
  };
}
