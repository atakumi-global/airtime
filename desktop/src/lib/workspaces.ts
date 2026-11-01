import type {
  PlaneConnection,
  Project,
  TimeEntry,
  WorkItem,
} from './types';

/** Label for rows that are not linked to a Plane workspace. */
export const NO_WORKSPACE = 'No workspace';

/**
 * Trims every slug, drops empty ones and duplicates that differ only in case
 * (the first spelling wins, order is kept). Mirrors the server rule so the list
 * the member sees is the list that is stored.
 */
export function normaliseSlugs(slugs: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of slugs) {
    const slug = raw.trim();
    if (slug === '') {
      continue;
    }
    const key = slug.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(slug);
    }
  }
  return result;
}

/** Workspace slugs seen on projects and in the connection, sorted, without duplicates. */
export function workspaceNames(
  projects: Project[],
  connection: PlaneConnection | null,
): string[] {
  const names = new Map<string, string>();
  for (const workspace of connection?.workspaces ?? []) {
    names.set(workspace.slug.toLowerCase(), workspace.slug);
  }
  for (const project of projects) {
    if (project.workspace_slug) {
      const key = project.workspace_slug.toLowerCase();
      if (!names.has(key)) {
        names.set(key, project.workspace_slug);
      }
    }
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b));
}

export function sameWorkspace(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? '').toLowerCase() === (b ?? '').toLowerCase();
}

/** The workspace of a work item, falling back to its project (older caches). */
export function workItemWorkspace(item: WorkItem, projects: Project[]): string | null {
  if (item.workspace_slug) {
    return item.workspace_slug;
  }
  return projects.find((project) => project.id === item.project_id)?.workspace_slug ?? null;
}

/** The workspace of a time entry, falling back to its project (queued or older cached data). */
export function entryWorkspace(entry: TimeEntry, projects: Project[]): string | null {
  if (entry.workspace_slug) {
    return entry.workspace_slug;
  }
  return projects.find((project) => project.id === entry.project_id)?.workspace_slug ?? null;
}

export type WorkItemGroup = { workspace: string | null; label: string; items: WorkItem[] };

/**
 * Groups work items by workspace for a picker: groups sorted by workspace name
 * (items without a workspace last), items keep their order inside a group.
 */
export function groupWorkItems(items: WorkItem[], projects: Project[]): WorkItemGroup[] {
  const groups = new Map<string, WorkItemGroup>();
  for (const item of items) {
    const workspace = workItemWorkspace(item, projects);
    const key = (workspace ?? '').toLowerCase();
    let group = groups.get(key);
    if (!group) {
      group = { workspace, label: workspace ?? NO_WORKSPACE, items: [] };
      groups.set(key, group);
    }
    group.items.push(item);
  }
  return [...groups.values()].sort((a, b) => {
    if (a.workspace === null) return 1;
    if (b.workspace === null) return -1;
    return a.label.localeCompare(b.label);
  });
}

export type WorkspaceProjectTotals = {
  workspace: string | null;
  label: string;
  projectCount: number;
  archivedCount: number;
  budget: number;
  cost: number;
};

/**
 * Totals per workspace over the given projects, in the reporting currency. Each
 * figure is the sum of the project rows, so a total always matches what is listed.
 */
export function workspaceTotals(projects: Project[]): WorkspaceProjectTotals[] {
  const totals = new Map<string, WorkspaceProjectTotals>();
  for (const project of projects) {
    const key = (project.workspace_slug ?? '').toLowerCase();
    let entry = totals.get(key);
    if (!entry) {
      entry = {
        workspace: project.workspace_slug ?? null,
        label: project.workspace_slug ?? NO_WORKSPACE,
        projectCount: 0,
        archivedCount: 0,
        budget: 0,
        cost: 0,
      };
      totals.set(key, entry);
    }
    entry.projectCount += 1;
    if (project.archived) {
      entry.archivedCount += 1;
    }
    entry.budget += project.summary?.convertedBudget ?? 0;
    entry.cost += project.summary?.spent ?? 0;
  }
  return [...totals.values()].sort((a, b) => {
    if (a.workspace === null) return 1;
    if (b.workspace === null) return -1;
    return a.label.localeCompare(b.label);
  });
}
