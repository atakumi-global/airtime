import { useCallback, useState, type ReactNode } from 'react';
import { useApp } from '../state/AppContext';
import { useShortcut, useShortcuts } from '../state/ShortcutsContext';
import { Badge } from './ui';
import { TimerBar } from './TimerBar';
import { ShortcutHint, shortcutAria } from './KeyCaps';
import { ShortcutsHelp } from './ShortcutsHelp';
import { TrayMenuDialog } from './TrayMenuDialog';
import { WorkItemSearch } from './WorkItemSearch';
import { useTrayActions } from './useTrayActions';

export type View =
  | 'time'
  | 'projects'
  | 'rates'
  | 'reports'
  | 'admin'
  | 'settings';

const NAV_TRACK: Array<{ id: View; label: string; icon: string }> = [
  { id: 'time', label: 'My time', icon: '◷' },
];

export function Shell({
  view,
  onNavigate,
  onBackfill,
  children,
}: {
  view: View;
  onNavigate: (view: View) => void;
  onBackfill: () => void;
  children: ReactNode;
}) {
  const { member, organisation, refreshing, refresh, online, error, notice, dismiss } =
    useApp();
  const canManage =
    member?.role === 'manager' || member?.role === 'administrator';
  const canAdmin = member?.role === 'administrator';

  const { bindings } = useShortcuts();
  const [overlay, setOverlay] = useState<'search' | 'tray' | 'help' | null>(null);
  const closeOverlay = useCallback(() => setOverlay(null), []);
  const openTimesheet = useCallback(() => onNavigate('time'), [onNavigate]);
  const openSettings = useCallback(() => onNavigate('settings'), [onNavigate]);
  const runTrayAction = useTrayActions({
    onBackfill,
    onTimesheet: openTimesheet,
    onSettings: openSettings,
  });
  useShortcut('backfill', onBackfill);
  useShortcut('timesheet', openTimesheet);
  useShortcut('search', () => setOverlay('search'));
  useShortcut('tray', () => setOverlay('tray'));

  const initials = (member?.displayName ?? '?')
    .split(' ')
    .map((part) => part.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">A</span>
          Airtime
        </div>

        <nav className="nav-group" aria-label="Track">
          <h3>Track</h3>
          {NAV_TRACK.map((item) => (
            <button
              key={item.id}
              type="button"
              className="nav-item"
              aria-current={view === item.id ? 'page' : undefined}
              onClick={() => onNavigate(item.id)}
              {...(item.id === 'time'
                ? shortcutAria(bindings, 'timesheet', 'shortcut-timesheet-hint')
                : {})}
            >
              <span className="icon" aria-hidden="true">
                {item.icon}
              </span>
              {item.label}
              {item.id === 'time' ? (
                <ShortcutHint id="timesheet" domId="shortcut-timesheet-hint" />
              ) : null}
            </button>
          ))}
          <button
            type="button"
            className="nav-item"
            onClick={onBackfill}
            {...shortcutAria(bindings, 'backfill', 'shortcut-backfill-hint')}
          >
            <span className="icon" aria-hidden="true">
              +
            </span>
            Back-fill
            <ShortcutHint id="backfill" domId="shortcut-backfill-hint" />
          </button>
          {canManage ? (
            <button
              type="button"
              className="nav-item"
              aria-current={view === 'reports' ? 'page' : undefined}
              onClick={() => onNavigate('reports')}
            >
              <span className="icon" aria-hidden="true">
                ▤
              </span>
              Reports
            </button>
          ) : null}
        </nav>

        <nav className="nav-group" aria-label="Manage">
          <h3>Manage</h3>
          <button
            type="button"
            className="nav-item"
            aria-current={view === 'projects' ? 'page' : undefined}
            onClick={() => onNavigate('projects')}
          >
            <span className="icon" aria-hidden="true">
              ▦
            </span>
            Projects
          </button>
          {canManage ? (
            <button
              type="button"
              className="nav-item"
              aria-current={view === 'rates' ? 'page' : undefined}
              onClick={() => onNavigate('rates')}
            >
              <span className="icon" aria-hidden="true">
                ⊙
              </span>
              Budgets
            </button>
          ) : null}
        </nav>

        <nav className="nav-group" aria-label="Settings" style={{ marginTop: 'auto' }}>
          <button
            type="button"
            className="nav-item"
            aria-haspopup="dialog"
            onClick={() => setOverlay('help')}
          >
            <span className="icon" aria-hidden="true">
              ?
            </span>
            Keyboard shortcuts
          </button>
          {canAdmin ? (
            <button
              type="button"
              className="nav-item"
              aria-current={view === 'admin' ? 'page' : undefined}
              onClick={() => onNavigate('admin')}
            >
              <span className="icon" aria-hidden="true">
                ⚑
              </span>
              Admin
            </button>
          ) : null}
          <button
            type="button"
            className="nav-item"
            aria-current={view === 'settings' ? 'page' : undefined}
            onClick={() => onNavigate('settings')}
          >
            <span className="icon" aria-hidden="true">
              ⚙
            </span>
            Settings
          </button>
        </nav>
      </aside>

      <header className="topbar">
        <div className="workspace">
          <strong>{organisation?.name ?? 'Airtime'}</strong>
          <span className="muted">· Plane workspace</span>
          {!online ? <Badge tone="warning">Offline</Badge> : null}
        </div>
        <div className="row">
          <button
            type="button"
            className="btn btn-sm"
            aria-haspopup="dialog"
            onClick={() => setOverlay('search')}
            {...shortcutAria(bindings, 'search', 'shortcut-search-hint')}
          >
            Search work items
            <ShortcutHint id="search" domId="shortcut-search-hint" />
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => void refresh()}
            disabled={refreshing}
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          <span className="avatar" title={member?.displayName}>
            {initials}
          </span>
        </div>
      </header>

      <main className="main">
        {error || notice ? (
          <div className={`banner ${error ? 'banner-error' : ''}`} role="status">
            <div className="row-between">
              <span>{error ?? notice}</span>
              <button type="button" className="btn btn-sm" onClick={dismiss}>
                Dismiss
              </button>
            </div>
          </div>
        ) : null}
        {children}
      </main>

      <TimerBar />

      {overlay === 'search' ? <WorkItemSearch onClose={closeOverlay} /> : null}
      {overlay === 'tray' ? (
        <TrayMenuDialog onClose={closeOverlay} onAction={runTrayAction} />
      ) : null}
      {overlay === 'help' ? (
        <ShortcutsHelp onClose={closeOverlay} onOpenSettings={openSettings} />
      ) : null}
    </div>
  );
}
