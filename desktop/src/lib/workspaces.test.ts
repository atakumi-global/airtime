import { describe, expect, it } from 'vitest';
import { PROJECTS, WORK_ITEMS, connection, timeEntry } from '../test/fixtures';
import {
  NO_WORKSPACE,
  entryWorkspace,
  groupWorkItems,
  normaliseSlugs,
  sameWorkspace,
  workItemWorkspace,
  workspaceNames,
  workspaceTotals,
} from './workspaces';

describe('normaliseSlugs', () => {
  it('trims, drops empty slugs and case-insensitive duplicates, keeping the first spelling', () => {
    expect(normaliseSlugs([' Alpha ', 'alpha', '', '  ', 'ALPHA', 'beta'])).toEqual(['Alpha', 'beta']);
  });
});

describe('workspaceNames', () => {
  it('merges the connection and the projects, sorted, without duplicates', () => {
    const projects = [
      { ...PROJECTS[0]!, workspace_slug: 'zeta' },
      { ...PROJECTS[1]!, workspace_slug: 'ACME' },
    ];
    expect(workspaceNames(projects, connection())).toEqual(['acme', 'zeta']);
    expect(workspaceNames([], null)).toEqual([]);
  });
});

describe('sameWorkspace', () => {
  it('compares case-insensitively and treats missing as empty', () => {
    expect(sameWorkspace('Acme', 'acme')).toBe(true);
    expect(sameWorkspace(null, '')).toBe(true);
    expect(sameWorkspace('a', 'b')).toBe(false);
  });
});

describe('workspace attribution', () => {
  it('falls back to the project when an older cache has no workspace on the row', () => {
    const item = { ...WORK_ITEMS[0]!, workspace_slug: undefined };
    expect(workItemWorkspace(item, PROJECTS)).toBe('acme');
    expect(workItemWorkspace({ ...item, project_id: null }, PROJECTS)).toBeNull();
    expect(entryWorkspace(timeEntry({ project_id: 'project-1' }), PROJECTS)).toBe('acme');
    expect(entryWorkspace(timeEntry({ project_id: 'project-1', workspace_slug: 'beta' }), PROJECTS)).toBe('beta');
    expect(entryWorkspace(timeEntry({ project_id: null }), PROJECTS)).toBeNull();
  });
});

describe('groupWorkItems', () => {
  it('groups by workspace, sorted by name, with unlinked items last', () => {
    const items = [
      { ...WORK_ITEMS[0]!, id: 'b1', workspace_slug: 'beta' },
      { ...WORK_ITEMS[0]!, id: 'a1', workspace_slug: 'alpha' },
      { ...WORK_ITEMS[0]!, id: 'n1', workspace_slug: null, project_id: null },
      { ...WORK_ITEMS[0]!, id: 'a2', workspace_slug: 'ALPHA' },
    ];
    const groups = groupWorkItems(items, PROJECTS);
    expect(groups.map((group) => group.label)).toEqual(['alpha', 'beta', NO_WORKSPACE]);
    expect(groups[0]!.items.map((item) => item.id)).toEqual(['a1', 'a2']);
  });
});

describe('workspaceTotals', () => {
  it('sums budget and cost per workspace and counts archived projects', () => {
    const projects = [
      { ...PROJECTS[0]!, id: '1', workspace_slug: 'alpha' },
      { ...PROJECTS[0]!, id: '2', workspace_slug: 'alpha', archived: true },
      { ...PROJECTS[1]!, id: '3', workspace_slug: 'beta' },
    ];
    const totals = workspaceTotals(projects);
    const alpha = totals.find((entry) => entry.label === 'alpha')!;
    expect(alpha.projectCount).toBe(2);
    expect(alpha.archivedCount).toBe(1);
    expect(alpha.cost).toBe((projects[0]!.summary?.spent ?? 0) * 2);
    expect(totals.map((entry) => entry.label)).toEqual(['alpha', 'beta']);
  });
});
