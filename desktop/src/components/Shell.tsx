import type { ReactNode } from 'react';
import { useApp } from '../state/AppContext';
import { Badge } from './ui';
import { TimerBar } from './TimerBar';

export type View = 'time' | 'projects' | 'settings';

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
            >
              <span className="icon" aria-hidden="true">
                {item.icon}
              </span>
              {item.label}
            </button>
          ))}
          <button type="button" className="nav-item" onClick={onBackfill}>
            <span className="icon" aria-hidden="true">
              +
            </span>
            Back-fill
          </button>
          <button type="button" className="nav-item" disabled>
            <span className="icon" aria-hidden="true">
              ▤
            </span>
            Reports
          </button>
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
          <button type="button" className="nav-item" disabled>
            <span className="icon" aria-hidden="true">
              ⊙
            </span>
            Budgets
          </button>
        </nav>

        <nav className="nav-group" aria-label="Settings" style={{ marginTop: 'auto' }}>
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
    </div>
  );
}
