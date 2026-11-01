import {
  categorizePlaneError,
  describePlaneError,
  PlaneClient,
  type WorkspaceErrorCategory,
} from './client.js';

/** Upper bound on workspaces per connection; sync cost grows with each one. */
export const MAX_WORKSPACES_PER_CONNECTION = 20;

/** Plane's own slug rule: letters, digits, hyphen and underscore, at most 48. */
const SLUG_PATTERN = /^[A-Za-z0-9_-]{1,48}$/;

export class WorkspaceSlugError extends Error {
  constructor(
    readonly code: 'empty_workspace_slug' | 'invalid_workspace_slug' | 'too_many_workspaces' | 'no_workspaces',
    message: string,
  ) {
    super(message);
    this.name = 'WorkspaceSlugError';
  }
}

/**
 * Trims every slug, rejects empty or malformed ones and drops duplicates that
 * differ only in case. The first spelling wins and the order is kept.
 */
export function normaliseWorkspaceSlugs(input: string[]): string[] {
  const seen = new Set<string>();
  const slugs: string[] = [];
  for (const raw of input) {
    const slug = raw.trim();
    if (slug === '') {
      throw new WorkspaceSlugError('empty_workspace_slug', 'A workspace slug cannot be empty.');
    }
    if (!SLUG_PATTERN.test(slug)) {
      throw new WorkspaceSlugError(
        'invalid_workspace_slug',
        'A workspace slug may only contain letters, numbers, hyphens and underscores.',
      );
    }
    const key = slug.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      slugs.push(slug);
    }
  }
  if (slugs.length === 0) {
    throw new WorkspaceSlugError('no_workspaces', 'Add at least one workspace slug.');
  }
  if (slugs.length > MAX_WORKSPACES_PER_CONNECTION) {
    throw new WorkspaceSlugError(
      'too_many_workspaces',
      `A connection can read at most ${MAX_WORKSPACES_PER_CONNECTION} workspaces.`,
    );
  }
  return slugs;
}

export type WorkspaceCheck = {
  slug: string;
  status: 'verified' | 'failed';
  errorCategory: WorkspaceErrorCategory | null;
  error: string | null;
  projectCount: number | null;
};

/**
 * Verifies one workspace with a read-only request. A failure is a result, not
 * an exception, so one unreadable workspace never affects the others. The
 * message is a fixed text: it never contains the token or Plane's response.
 */
export async function checkWorkspace(options: {
  baseUrl: string;
  token: string;
  slug: string;
  fetchImpl?: typeof fetch;
}): Promise<WorkspaceCheck> {
  const client = new PlaneClient({
    baseUrl: options.baseUrl,
    workspaceSlug: options.slug,
    token: options.token,
    fetchImpl: options.fetchImpl,
  });
  try {
    const { projectCount } = await client.verify();
    return {
      slug: options.slug,
      status: 'verified',
      errorCategory: null,
      error: null,
      projectCount,
    };
  } catch (error) {
    return {
      slug: options.slug,
      status: 'failed',
      errorCategory: categorizePlaneError(error),
      error: describePlaneError(error),
      projectCount: null,
    };
  }
}
