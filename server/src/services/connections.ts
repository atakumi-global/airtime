import { randomBytes, randomUUID } from 'node:crypto';
import type { Db } from '../db/pool.js';
import { decryptToken, encryptToken } from '../crypto/tokens.js';

export type PlaneConnectionRow = {
  id: string;
  organisation_id: string;
  member_id: string;
  base_url: string;
  workspace_slug: string;
  encrypted_token: string;
  webhook_secret: string | null;
  status: 'active' | 'error';
  last_verified_at: Date | null;
  last_synced_at: Date | null;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
};

export async function getConnectionForMember(
  db: Db,
  organisationId: string,
  memberId: string,
): Promise<PlaneConnectionRow | undefined> {
  const rows = await db.query<PlaneConnectionRow>(
    'SELECT * FROM plane_connections WHERE organisation_id = $1 AND member_id = $2',
    [organisationId, memberId],
  );
  return rows[0];
}

export async function getConnectionById(
  db: Db,
  connectionId: string,
): Promise<PlaneConnectionRow | undefined> {
  const rows = await db.query<PlaneConnectionRow>(
    'SELECT * FROM plane_connections WHERE id = $1',
    [connectionId],
  );
  return rows[0];
}

export async function getConnectionByWebhookSecret(
  db: Db,
  secret: string,
): Promise<PlaneConnectionRow | undefined> {
  const rows = await db.query<PlaneConnectionRow>(
    'SELECT * FROM plane_connections WHERE webhook_secret = $1',
    [secret],
  );
  return rows[0];
}

export async function listActiveConnections(
  db: Db,
): Promise<PlaneConnectionRow[]> {
  return db.query<PlaneConnectionRow>(
    'SELECT * FROM plane_connections ORDER BY created_at ASC',
  );
}

export type UpsertConnectionInput = {
  organisationId: string;
  memberId: string;
  baseUrl: string;
  workspaceSlug: string;
  token: string;
  key: Buffer;
};

export async function upsertConnection(
  db: Db,
  input: UpsertConnectionInput,
): Promise<PlaneConnectionRow> {
  const encryptedToken = encryptToken(input.token, input.key);
  const existing = await getConnectionForMember(
    db,
    input.organisationId,
    input.memberId,
  );
  const webhookSecret = existing?.webhook_secret ?? randomBytes(24).toString('hex');

  const rows = await db.query<PlaneConnectionRow>(
    `INSERT INTO plane_connections
       (id, organisation_id, member_id, base_url, workspace_slug, encrypted_token,
        webhook_secret, status, last_verified_at, last_error)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', now(), NULL)
     ON CONFLICT (member_id) DO UPDATE
       SET base_url = EXCLUDED.base_url,
           workspace_slug = EXCLUDED.workspace_slug,
           encrypted_token = EXCLUDED.encrypted_token,
           status = 'active',
           last_verified_at = now(),
           last_error = NULL,
           updated_at = now()
     RETURNING *`,
    [
      existing?.id ?? randomUUID(),
      input.organisationId,
      input.memberId,
      input.baseUrl,
      input.workspaceSlug,
      encryptedToken,
      webhookSecret,
    ],
  );
  return rows[0]!;
}

export async function deleteConnection(
  db: Db,
  organisationId: string,
  memberId: string,
): Promise<boolean> {
  const rows = await db.query(
    'DELETE FROM plane_connections WHERE organisation_id = $1 AND member_id = $2 RETURNING id',
    [organisationId, memberId],
  );
  return rows.length > 0;
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

export function toPublicConnection(connection: PlaneConnectionRow): {
  baseUrl: string;
  workspaceSlug: string;
  status: string;
  lastVerifiedAt: Date | null;
  lastSyncedAt: Date | null;
  lastError: string | null;
  webhookPath: string | null;
} {
  return {
    baseUrl: connection.base_url,
    workspaceSlug: connection.workspace_slug,
    status: connection.status,
    lastVerifiedAt: connection.last_verified_at,
    lastSyncedAt: connection.last_synced_at,
    lastError: connection.last_error,
    webhookPath: connection.webhook_secret
      ? `/api/plane/webhook/${connection.webhook_secret}`
      : null,
  };
}
