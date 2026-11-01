import type { WorkItem } from './types';

export const MAX_SEARCH_RESULTS = 8;

/** Work items that may receive new time; history-only items are left out of pickers. */
export function enterable(items: WorkItem[]): WorkItem[] {
  return items.filter((item) => item.can_enter_time !== false);
}

function haystack(item: WorkItem): string {
  return [item.identifier, item.name, item.project_name, item.project_identifier]
    .filter((part): part is string => typeof part === 'string' && part !== '')
    .join(' ')
    .toLowerCase();
}

/**
 * Work items matching every word of `query` in their identifier, name or project.
 * Open items come first, then identifier matches; the original order is kept otherwise.
 */
export function searchWorkItems(
  items: WorkItem[],
  query: string,
  limit: number = MAX_SEARCH_RESULTS,
): WorkItem[] {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word !== '');
  const rank = (item: WorkItem): number => {
    const identifier = (item.identifier ?? '').toLowerCase();
    const idMatch = words.length > 0 && identifier.startsWith(words[0]!) ? 0 : 1;
    return (item.is_open ? 0 : 2) + idMatch;
  };
  return enterable(items)
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => {
      const text = haystack(item);
      return words.every((word) => text.includes(word));
    })
    .sort((a, b) => rank(a.item) - rank(b.item) || a.index - b.index)
    .slice(0, Math.max(0, limit))
    .map(({ item }) => item);
}
