import { useState } from 'react';
import { useApp } from '../state/AppContext';
import { Badge, Field } from '../components/ui';

export function Settings() {
  const {
    baseUrl,
    member,
    organisation,
    planeConnection,
    fx,
    logout,
    setFeedbackOptIn,
    savePlaneConnection,
    syncPlane,
  } = useApp();

  const [planeUrl, setPlaneUrl] = useState(
    planeConnection?.baseUrl ?? 'https://plane.example.com',
  );
  const [workspaceSlug, setWorkspaceSlug] = useState(
    planeConnection?.workspaceSlug ?? '',
  );
  const [planeToken, setPlaneToken] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const connect = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      setMessage(
        await savePlaneConnection({
          baseUrl: planeUrl,
          workspaceSlug,
          token: planeToken,
        }),
      );
      setPlaneToken('');
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : 'Connection failed');
    } finally {
      setBusy(false);
    }
  };

  const sync = async () => {
    setBusy(true);
    setError(null);
    try {
      setMessage(await syncPlane());
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : 'Sync failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <span className="sub">Account, Plane connection and privacy</span>
        </div>
      </div>

      {message ? <div className="banner">{message}</div> : null}
      {error ? <div className="banner banner-error">{error}</div> : null}

      <section className="card card-pad stack">
        <h2>Account</h2>
        <div className="row-between">
          <div>
            <strong>{member?.displayName}</strong>
            <p className="muted small">
              {member?.email} · {member?.role} · server {baseUrl}
            </p>
          </div>
          <button type="button" className="btn" onClick={() => void logout()}>
            Sign out
          </button>
        </div>

        <div className="row-between">
          <div>
            <strong>Contribute anonymised corrections</strong>
            <p className="muted small">
              Stores create, edit and delete events with identifying data removed,
              to train future automatic time capture. Off by default.
            </p>
          </div>
          <label className="row">
            <input
              type="checkbox"
              checked={member?.feedbackOptIn ?? false}
              onChange={(event) => void setFeedbackOptIn(event.target.checked)}
            />
            Enabled
          </label>
        </div>

        <p className="muted small">
          Reporting currency: <strong>{organisation?.reportingCurrency ?? '—'}</strong> ·
          FX{' '}
          {fx
            ? fx.stale
              ? `stale (last ${fx.date ?? 'unknown'})`
              : `current as of ${fx.date}`
            : 'not loaded'}
        </p>
      </section>

      <section className="card card-pad stack">
        <div className="section-title">
          <h2>Plane connection</h2>
          {planeConnection ? (
            <Badge tone={planeConnection.status === 'active' ? 'success' : 'danger'}>
              {planeConnection.status}
            </Badge>
          ) : (
            <Badge tone="neutral">Not connected</Badge>
          )}
        </div>
        <p className="muted small">
          Airtime reads projects and work items with your personal Plane API token.
          The token is verified, encrypted on the server and never written to Plane.
          {planeConnection?.lastSyncedAt
            ? ` Last synced ${new Date(planeConnection.lastSyncedAt).toLocaleString('en-GB')}.`
            : ''}
          {planeConnection?.lastError ? ` Last error: ${planeConnection.lastError}.` : ''}
        </p>

        <Field label="Plane base URL">
          <input
            className="input"
            value={planeUrl}
            onChange={(event) => setPlaneUrl(event.target.value)}
            placeholder="https://plane.example.com"
          />
        </Field>
        <div className="row">
          <div style={{ flex: 1 }}>
            <Field label="Workspace slug">
              <input
                className="input"
                value={workspaceSlug}
                onChange={(event) => setWorkspaceSlug(event.target.value)}
                placeholder="my-workspace"
              />
            </Field>
          </div>
          <div style={{ flex: 2 }}>
            <Field label="Personal API token">
              <input
                className="input"
                type="password"
                value={planeToken}
                onChange={(event) => setPlaneToken(event.target.value)}
                placeholder="plane_api_…"
              />
            </Field>
          </div>
        </div>

        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="btn"
            onClick={() => void sync()}
            disabled={busy || !planeConnection}
          >
            Sync now
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void connect()}
            disabled={busy || !workspaceSlug || !planeToken}
          >
            {busy ? 'Working…' : 'Connect and sync'}
          </button>
        </div>
      </section>
    </div>
  );
}
