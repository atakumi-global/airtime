import { randomUUID } from 'node:crypto';
import type { Db } from '../db/pool.js';
import type { MemberRow, Role } from '../types.js';
import { hashPassword, verifyPassword } from '../auth/password.js';

export async function findMemberById(
  db: Db,
  id: string,
): Promise<MemberRow | undefined> {
  const rows = await db.query<MemberRow>('SELECT * FROM members WHERE id = $1', [
    id,
  ]);
  return rows[0];
}

export async function findMemberByEmail(
  db: Db,
  organisationId: string,
  email: string,
): Promise<MemberRow | undefined> {
  const rows = await db.query<MemberRow>(
    'SELECT * FROM members WHERE organisation_id = $1 AND lower(email) = lower($2)',
    [organisationId, email],
  );
  return rows[0];
}

export async function listMembers(
  db: Db,
  organisationId: string,
): Promise<MemberRow[]> {
  return db.query<MemberRow>(
    'SELECT * FROM members WHERE organisation_id = $1 ORDER BY display_name ASC',
    [organisationId],
  );
}

export type CreateMemberInput = {
  organisationId: string;
  email: string;
  displayName: string;
  role: Role;
  password?: string;
  passwordHash?: string;
  oidcSubject?: string;
};

export async function createMember(
  db: Db,
  input: CreateMemberInput,
): Promise<MemberRow> {
  const id = randomUUID();
  const passwordHash =
    input.passwordHash ?? (input.password ? hashPassword(input.password) : null);
  const rows = await db.query<MemberRow>(
    `INSERT INTO members
       (id, organisation_id, email, display_name, role, password_hash, oidc_subject)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      id,
      input.organisationId,
      input.email,
      input.displayName,
      input.role,
      passwordHash,
      input.oidcSubject ?? null,
    ],
  );
  return rows[0]!;
}

export async function updateMemberRole(
  db: Db,
  organisationId: string,
  memberId: string,
  role: Role,
): Promise<MemberRow | undefined> {
  const rows = await db.query<MemberRow>(
    `UPDATE members
        SET role = $1, updated_at = now()
      WHERE organisation_id = $2 AND id = $3
      RETURNING *`,
    [role, organisationId, memberId],
  );
  return rows[0];
}

export async function removeMember(
  db: Db,
  organisationId: string,
  memberId: string,
): Promise<MemberRow | undefined> {
  const rows = await db.query<MemberRow>(
    `UPDATE members
        SET status = 'removed', password_hash = NULL, updated_at = now()
      WHERE organisation_id = $1 AND id = $2
      RETURNING *`,
    [organisationId, memberId],
  );
  return rows[0];
}

export async function setFeedbackOptIn(
  db: Db,
  organisationId: string,
  memberId: string,
  optIn: boolean,
): Promise<MemberRow | undefined> {
  const rows = await db.query<MemberRow>(
    `UPDATE members SET feedback_opt_in = $1, updated_at = now()
      WHERE organisation_id = $2 AND id = $3
      RETURNING *`,
    [optIn, organisationId, memberId],
  );
  return rows[0];
}

export async function authenticateLocal(
  db: Db,
  organisationId: string,
  email: string,
  password: string,
): Promise<MemberRow | null> {
  const member = await findMemberByEmail(db, organisationId, email);
  if (!member || member.status !== 'active') {
    return null;
  }
  if (!verifyPassword(password, member.password_hash)) {
    return null;
  }
  return member;
}

export type OidcIdentityInput = {
  subject: string;
  email: string;
  displayName: string;
};

export async function upsertOidcMember(
  db: Db,
  organisationId: string,
  identity: OidcIdentityInput,
): Promise<MemberRow> {
  const bySubject = await db.query<MemberRow>(
    'SELECT * FROM members WHERE oidc_subject = $1',
    [identity.subject],
  );
  if (bySubject[0]) {
    if (bySubject[0].status !== 'active') {
      throw new Error('member_removed');
    }
    return bySubject[0];
  }

  const existing = await findMemberByEmail(db, organisationId, identity.email);
  if (existing) {
    if (existing.status !== 'active') {
      throw new Error('member_removed');
    }
    const rows = await db.query<MemberRow>(
      `UPDATE members
          SET oidc_subject = $1, display_name = $2, updated_at = now()
        WHERE id = $3
        RETURNING *`,
      [identity.subject, identity.displayName, existing.id],
    );
    return rows[0]!;
  }

  return createMember(db, {
    organisationId,
    email: identity.email,
    displayName: identity.displayName,
    role: 'member',
    oidcSubject: identity.subject,
  });
}
