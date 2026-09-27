import { useState } from 'react';
import { AppProvider, useApp } from './state/AppContext';
import { Shell, type View } from './components/Shell';
import { BackfillDialog } from './components/BackfillDialog';
import { Login } from './screens/Login';
import { MyTime } from './screens/MyTime';
import { Projects } from './screens/Projects';
import { Rates } from './screens/Rates';
import { Settings } from './screens/Settings';

function Authenticated() {
  const { status } = useApp();
  const [view, setView] = useState<View>('time');
  const [backfill, setBackfill] = useState(false);

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
        onNavigate={setView}
        onBackfill={() => setBackfill(true)}
      >
        {view === 'time' ? <MyTime onBackfill={() => setBackfill(true)} /> : null}
        {view === 'projects' ? <Projects /> : null}
        {view === 'rates' ? <Rates /> : null}
        {view === 'settings' ? <Settings /> : null}
      </Shell>
      {backfill ? <BackfillDialog onClose={() => setBackfill(false)} /> : null}
    </>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Authenticated />
    </AppProvider>
  );
}
