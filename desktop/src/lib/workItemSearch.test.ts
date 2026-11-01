import { describe, expect, it } from 'vitest';
import { WORK_ITEMS } from '../test/fixtures';
import type { WorkItem } from './types';
import { enterable, searchWorkItems } from './workItemSearch';

function item(id: string, identifier: string, name: string, is_open = true): WorkItem {
  return {
    id,
    project_id: 'p',
    plane_work_item_id: `plane-${id}`,
    identifier,
    name,
    state_group: null,
    is_open,
    project_name: 'Website',
    project_identifier: 'WEB',
  };
}

describe('searchWorkItems', () => {
  it('returns everything for an empty query, up to the limit', () => {
    expect(searchWorkItems(WORK_ITEMS, '')).toHaveLength(2);
    expect(searchWorkItems(WORK_ITEMS, '   ', 1)).toHaveLength(1);
  });

  it('matches the title, the number and the project, ignoring case', () => {
    expect(searchWorkItems(WORK_ITEMS, 'FOOTER').map((entry) => entry.identifier)).toEqual(['WEB-2']);
    expect(searchWorkItems(WORK_ITEMS, 'web-1').map((entry) => entry.identifier)).toEqual(['WEB-1']);
    expect(searchWorkItems(WORK_ITEMS, 'website')).toHaveLength(2);
  });

  it('requires every word to match', () => {
    expect(searchWorkItems(WORK_ITEMS, 'fix landing')).toEqual([]);
    expect(searchWorkItems(WORK_ITEMS, 'fix footer')).toHaveLength(1);
  });

  it('puts open items and number matches first', () => {
    const items = [
      item('1', 'WEB-9', 'Closed footer', false),
      item('2', 'WEB-3', 'Footer links'),
      item('3', 'OPS-1', 'Fix web-9 footer'),
    ];
    expect(searchWorkItems(items, 'footer').map((entry) => entry.id)).toEqual(['2', '3', '1']);
    expect(searchWorkItems(items, 'web-9').map((entry) => entry.id)).toEqual(['3', '1']);
  });

  it('copes with items without an identifier and with a zero limit', () => {
    const bare = { ...item('1', 'X', 'No number'), identifier: null };
    expect(searchWorkItems([bare], 'number')).toHaveLength(1);
    expect(searchWorkItems(WORK_ITEMS, 'web', 0)).toEqual([]);
  });
});

describe('history-only work items', () => {
  it('are left out of pickers and search but items without the flag stay', () => {
    const items = [
      item('1', 'WEB-1', 'Current work'),
      { ...item('2', 'WEB-2', 'Left project'), can_enter_time: false },
      { ...item('3', 'WEB-3', 'Explicitly allowed'), can_enter_time: true },
    ];
    expect(enterable(items).map((entry) => entry.id)).toEqual(['1', '3']);
    expect(searchWorkItems(items, 'web').map((entry) => entry.id)).toEqual(['1', '3']);
  });
});
