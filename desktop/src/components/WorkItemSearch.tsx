import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { useApp } from '../state/AppContext';
import { searchWorkItems } from '../lib/workItemSearch';
import type { WorkItem } from '../lib/types';
import { ModalDialog } from './ModalDialog';

/**
 * Search work items (Ctrl+K): a combobox with arrow-key selection. Enter starts the
 * timer on the highlighted item, Escape closes.
 */
export function WorkItemSearch({ onClose }: { onClose: () => void }) {
  const { workItems, timer, startTimer } = useApp();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const results = useMemo(() => searchWorkItems(workItems, query), [workItems, query]);
  const current = Math.min(active, Math.max(0, results.length - 1));
  const optionId = (index: number) => `${listId}-option-${index}`;

  const choose = (item: WorkItem) => {
    onClose();
    void startTimer(item.plane_work_item_id);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (results.length === 0) {
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current + 1) % results.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current - 1 + results.length) % results.length);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActive(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActive(results.length - 1);
    } else if (
      event.key === 'Enter' &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey
    ) {
      event.preventDefault();
      const item = results[current];
      if (item) {
        choose(item);
      }
    }
  };

  const action = timer ? 'switch the timer to it' : 'start the timer on it';

  return (
    <ModalDialog
      label="Search work items"
      title="Search work items"
      onClose={onClose}
      initialFocus="input"
    >
      <input
        className="input"
        role="combobox"
        aria-label="Search work items"
        aria-expanded={results.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={results.length > 0 ? optionId(current) : undefined}
        placeholder="Search by title or number"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        autoComplete="off"
        spellCheck={false}
      />
      <ul className="palette-list" id={listId} role="listbox" aria-label="Work items">
        {results.map((item, index) => (
          <li
            key={item.id}
            id={optionId(index)}
            role="option"
            aria-selected={index === current}
            className="palette-option"
            onClick={() => choose(item)}
            onMouseMove={() => setActive(index)}
          >
            <span className="ref">{item.identifier ?? '—'}</span>
            <span>{item.name}</span>
            {item.project_name ? (
              <span className="muted small" style={{ marginLeft: 'auto' }}>
                {item.project_name}
                {item.workspace_slug ? ` · ${item.workspace_slug}` : ''}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="muted small" role="status">
        {results.length === 0
          ? workItems.length === 0
            ? 'No work items yet. Connect Plane in Settings.'
            : 'No work items match.'
          : `${results.length} ${results.length === 1 ? 'result' : 'results'}. Arrow keys choose, Enter will ${action}, Escape closes.`}
      </p>
    </ModalDialog>
  );
}
