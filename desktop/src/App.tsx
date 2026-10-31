import { useCallback, useState } from 'react';
import { AppProvider, useApp } from './state/AppContext';
import { Shell, type View } from './components/Shell';
import { BackfillDialog } from './components/BackfillDialog';
import { TitleBar } from './components/TitleBar';
import { TrayBridge } from './components/TrayBridge';
import { Login } from './screens/Login';
import { Timesheet } from './screens/Timesheet';
import { Projects } from './screens/Projects';
import { Rates } from './screens/Rates';
import { Reports } from './screens/Reports';
import { Admin } from './screens/Admin';
import { Settings } from './screens/Settings';

function Authenticated({
  view,
  onNavigate,
  backfill,
  onBackfill,
}: {
  view: View;
  onNavigate: (view: View) => void;
  backfill: boolean;
  onBackfill: (open: boolean) => void;
}) {
  const { status } = useApp();

  if (status === 'loading') {
    return (
      <div className="login">
        <div className="card card-pad">Loading Airtime…</div>
      </div>
    );
  }

  if (status === 'login') {
    return <Login />;
  }

  return (
    <>
      <Shell
        view={view}
        onNavigate={onNavigate}
        onBackfill={() => onBackfill(true)}
      >
        {view === 'time' ? <Timesheet onBackfill={() => onBackfill(true)} /> : null}
        {view === 'projects' ? <Projects onNavigate={onNavigate} /> : null}
        {view === 'rates' ? <Rates /> : null}
        {view === 'reports' ? <Reports /> : null}
        {view === 'admin' ? <Admin /> : null}
        {view === 'settings' ? <Settings /> : null}
      </Shell>
      {backfill ? <BackfillDialog onClose={() => onBackfill(false)} /> : null}
    </>
  );
}

function Content() {
  const [view, setView] = useState<View>('time');
  const [backfill, setBackfill] = useState(false);
  const openBackfill = useCallback(() => setBackfill(true), []);
  const openTimesheet = useCallback(() => setView('time'), []);
  const openSettings = useCallback(() => setView('settings'), []);
  return (
    <>
      <TrayBridge
        onBackfill={openBackfill}
        onTimesheet={openTimesheet}
        onSettings={openSettings}
      />
      <Authenticated
        view={view}
        onNavigate={setView}
        backfill={backfill}
        onBackfill={setBackfill}
      />
    </>
  );
}

export default function App() {
  return (
    <AppProvider>
      <div className="frame">
        <TitleBar />
        <div className="frame-body">
          <Content />
        </div>
      </div>
    </AppProvider>
  );
}
