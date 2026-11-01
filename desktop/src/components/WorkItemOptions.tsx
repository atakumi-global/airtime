import { useMemo } from 'react';
import { useApp } from '../state/AppContext';
import { groupWorkItems } from '../lib/workspaces';
import type { WorkItem } from '../lib/types';

/**
 * The options of a work-item select, grouped by workspace (the workspace slug is
 * the group label). Each option reads "identifier · name". With one workspace or
 * none the options stay flat, as before.
 */
export function WorkItemOptions({ items }: { items: WorkItem[] }) {
  const { projects } = useApp();
  const groups = useMemo(() => groupWorkItems(items, projects), [items, projects]);
  const option = (item: WorkItem) => (
    <option key={item.id} value={item.plane_work_item_id}>
      {item.identifier ? `${item.identifier} · ` : ''}
      {item.name}
    </option>
  );
  if (groups.length <= 1 && (groups[0]?.workspace ?? null) === null) {
    return <>{items.map(option)}</>;
  }
  return (
    <>
      {groups.map((group) => (
        <optgroup key={group.label} label={group.label}>
          {group.items.map(option)}
        </optgroup>
      ))}
    </>
  );
}
