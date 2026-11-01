import type { Db } from '../db/pool.js';
import { isProjectMember, PlaneClient, PlaneError, type PlaneProject } from '../plane/client.js';
import {
  applyMemberAccess,
  type AccessibleProject,
} from './access.js';
import {
  connectionWorkspaces,
  getConnectionForMember,
  openConnectionToken,
  type PlaneConnectionRow,
} from './connections.js';

const FORCED_RECHECK_FLOOR_SECONDS = 5;

export class AccessUnverifiableError extends Error {
  readonly statusCode = 503;
  constructor() {
    super('access_unverifiable');
    this.name = 'AccessUnverifiableError';
  }
}

export type AccessCheckDeps = {
  db: Db;
  encryptionKey: Buffer | null;
  /** A live check younger than this is trusted without asking Plane again. */
  recheckSeconds: number;
  /** When Plane cannot be reached, stored access older than this stops working. */
  maxStaleSeconds: number;
  fetchImpl?: typeof fetch;
};

/**
 * The projects of one workspace the connection's user is a member of. Plane
 * lists public projects the user has not joined too, so membership is read from
 * each project. When Plane reports no membership at all, nobody can be told
 * apart from a member, so the check fails instead of granting or removing access.
 */
export function memberProjects(
  workspaceSlug: string,
  projects: PlaneProject[],
): AccessibleProject[] {
  if (projects.length > 0 && projects.every((project) => isProjectMember(project) === null)) {
    throw new Error('plane_membership_unavailable');
  }
  return projects
    .filter((project) => isProjectMember(project) === true)
    .map((project) => ({ workspaceSlug, planeProjectId: project.id }));
}

function ageSeconds(value: Date | null): number {
  return value ? (Date.now() - new Date(value).getTime()) / 1000 : Number.POSITIVE_INFINITY;
}

async function fetchAccessible(
  connection: PlaneConnectionRow,
  key: Buffer,
  fetchImpl: typeof fetch | undefined,
): Promise<AccessibleProject[]> {
  const token = openConnectionToken(connection, key);
  const accessible: AccessibleProject[] = [];
  for (const workspaceSlug of connectionWorkspaces(connection)) {
    const client = new PlaneClient({
      baseUrl: connection.base_url,
      workspaceSlug,
      token,
      fetchImpl,
    });
    try {
      accessible.push(...memberProjects(workspaceSlug, await client.listProjects()));
    } catch (error) {
      // Plane answering "no" is an answer: the member has no access there.
      // Anything else (network, 5xx) is not, and must not remove access.
      const status = error instanceof PlaneError ? error.status : 0;
      if (status !== 401 && status !== 403 && status !== 404) {
        throw error;
      }
    }
  }
  return accessible;
}

/**
 * The check that runs before a member may enter time. It compares a hash of the
 * member's current Plane project memberships with the stored one: equal means
 * nothing changed, different means the stored access is rewritten first.
 *
 * - `force` skips the recheck interval (used when access is about to be denied,
 *   so a membership gained moments ago is honoured).
 * - A member without a Plane connection cannot be verified; the stored access
 *   stands (a disconnect already turned it into history).
 * - When Plane cannot be reached, stored access is trusted until it is older
 *   than `maxStaleSeconds`, then the check fails closed.
 */
export async function verifyMemberAccess(
  deps: AccessCheckDeps,
  member: { id: string; organisation_id: string },
  options: { force?: boolean } = {},
): Promise<{ checked: boolean; changed: boolean }> {
  const connection = await getConnectionForMember(deps.db, member.organisation_id, member.id);
  if (!connection || !deps.encryptionKey) {
    return { checked: false, changed: false };
  }
  // A forced check still honours a short floor, so a refused request cannot be
  // replayed to make the server hammer Plane.
  const minAge = options.force
    ? Math.min(FORCED_RECHECK_FLOOR_SECONDS, deps.recheckSeconds)
    : deps.recheckSeconds;
  if (ageSeconds(connection.access_checked_at) < minAge) {
    return { checked: false, changed: false };
  }

  let accessible: AccessibleProject[];
  try {
    accessible = await fetchAccessible(connection, deps.encryptionKey, deps.fetchImpl);
  } catch {
    if (ageSeconds(connection.access_checked_at) <= deps.maxStaleSeconds) {
      return { checked: false, changed: false };
    }
    throw new AccessUnverifiableError();
  }

  const result = await applyMemberAccess(deps.db, {
    organisationId: member.organisation_id,
    memberId: member.id,
    connectionId: connection.id,
    previousHash: connection.access_hash,
    accessible,
  });
  return { checked: true, changed: result.changed };
}

/**
 * Same check for read routes. Reading never fails because Plane is unreachable:
 * history stays readable, so errors are swallowed and the stored access is used.
 */
export async function refreshMemberAccessQuietly(
  deps: AccessCheckDeps,
  member: { id: string; organisation_id: string },
): Promise<void> {
  try {
    await verifyMemberAccess(deps, member);
  } catch {
    // Stored access stands; the next write path fails closed if it is too old.
  }
}
