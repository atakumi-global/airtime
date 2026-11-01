import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useApp } from '../state/AppContext';
import { Badge, Field } from '../components/ui';
import { KeyCaps } from '../components/KeyCaps';
import { currencyOptions } from '../lib/currency';
import {
  SHORTCUTS,
  announce,
  bindingFromEvent,
  defaultBindings,
  type ShortcutId,
} from '../lib/shortcuts';
import { useShortcuts } from '../state/ShortcutsContext';

function ShortcutsSection() {
  const { bindings, setBinding, resetBinding, resetAll, isCustom, setCapturing } =
    useShortcuts();
  const [editing, setEditing] = useState<ShortcutId | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const captureRef = useRef<HTMLButtonElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const returnTo = useRef<ShortcutId | null>(null);
  const anyCustom = SHORTCUTS.some((def) => isCustom(def.id));

  useEffect(() => {
    setCapturing(editing !== null);
    return () => setCapturing(false);
  }, [editing, setCapturing]);

  useEffect(() => {
    if (editing) {
      captureRef.current?.focus();
    } else if (returnTo.current) {
      // The capture button is gone; put focus back on the row's Change button.
      tableRef.current
        ?.querySelector<HTMLElement>(`tr[data-shortcut="${returnTo.current}"] button`)
        ?.focus();
      returnTo.current = null;
    }
  }, [editing]);

  const startEditing = (id: ShortcutId) => {
    setProblem(null);
    setStatus(null);
    setEditing(id);
  };

  const onCapture = (event: KeyboardEvent<HTMLButtonElement>, id: ShortcutId) => {
    if (event.key === 'Tab') {
      setEditing(null);
      return;
    }
    returnTo.current = id;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      setEditing(null);
      setProblem(null);
      return;
    }
    const binding = bindingFromEvent(event.nativeEvent);
    if (!binding) {
      return;
    }
    const refusal = setBinding(id, binding);
    if (refusal) {
      setProblem(refusal);
      return;
    }
    setProblem(null);
    setEditing(null);
    const def = SHORTCUTS.find((entry) => entry.id === id)!;
    setStatus(`Saved. ${announce(def, binding)}.`);
  };

  const reset = (id: ShortcutId) => {
    resetBinding(id);
    const def = SHORTCUTS.find((entry) => entry.id === id)!;
    setStatus(`Reset. ${announce(def, defaultBindings()[id])}.`);
  };

  return (
    <section className="card card-pad stack" aria-labelledby="shortcuts-heading">
      <div className="section-title">
        <h2 id="shortcuts-heading">Keyboard shortcuts</h2>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            resetAll();
            setEditing(null);
            setProblem(null);
            setStatus('All shortcuts reset to their defaults.');
          }}
          disabled={!anyCustom}
        >
          Reset all
        </button>
      </div>
      <p className="muted small">
        Choose Change, then press the new combination. Hold Ctrl or Alt so typing in
        a field never triggers a shortcut. Escape cancels. Changes are kept on this
        device.
      </p>
      <table className="shortcut-table" ref={tableRef}>
        <caption className="sr-only">Keyboard shortcuts and their keys</caption>
        <thead>
          <tr>
            <th scope="col">Action</th>
            <th scope="col" className="keys">
              Keys
            </th>
            <th scope="col" className="actions">
              <span className="sr-only">Change or reset</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {SHORTCUTS.map((def) => (
            <tr key={def.id} data-shortcut={def.id}>
              <th scope="row">{def.label}</th>
              <td className="keys">
                {editing === def.id ? (
                  <span className="shortcut-capture">Press the new keys…</span>
                ) : (
                  <KeyCaps binding={bindings[def.id]} />
                )}
              </td>
              <td className="actions">
                {editing === def.id ? (
                  <button
                    type="button"
                    ref={captureRef}
                    className="btn btn-sm btn-primary"
                    aria-label={`Press the new keys for ${def.label}, or Escape to cancel`}
                    onKeyDown={(event) => onCapture(event, def.id)}
                    onBlur={() => setEditing(null)}
                  >
                    Listening…
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="btn btn-sm"
                      aria-label={`Change shortcut for ${def.label}`}
                      onClick={() => startEditing(def.id)}
                    >
                      Change
                    </button>{' '}
                    <button
                      type="button"
                      className="btn btn-sm"
                      aria-label={`Reset shortcut for ${def.label}`}
                      onClick={() => reset(def.id)}
                      disabled={!isCustom(def.id)}
                    >
                      Reset
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {problem ? (
        <div className="banner banner-error" role="alert">
          {problem}
        </div>
      ) : null}
      <p className="muted small" role="status">
        {status}
      </p>
    </section>
  );
}

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
    updateReportingCurrency,
    updateDefaultHourlyRate,
    refreshFx,
  } = useApp();

  const canAdmin = member?.role === 'administrator';
  const [currency, setCurrency] = useState(
    organisation?.reportingCurrency ?? 'EUR',
  );
  const [defaultRate, setDefaultRate] = useState(
    String(organisation?.defaultHourlyRate ?? 200),
  );
  const [fxBusy, setFxBusy] = useState(false);
  const [fxMessage, setFxMessage] = useState<string | null>(null);

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

  const saveCurrency = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await updateReportingCurrency(currency.toUpperCase());
      setMessage(`Reporting currency set to ${currency.toUpperCase()}.`);
    } catch (currencyError) {
      setError(
        currencyError instanceof Error
          ? currencyError.message
          : 'Could not update the reporting currency',
      );
    } finally {
      setBusy(false);
    }
  };

  const saveDefaultRate = async () => {
    const value = Number(defaultRate);
    if (defaultRate.trim() === '' || !Number.isFinite(value) || value < 0) {
      setError('Enter a default hourly rate of zero or more. It cannot be blank.');
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await updateDefaultHourlyRate(value);
      setMessage(`Default hourly rate set to ${value} NZD.`);
    } catch (rateError) {
      setError(
        rateError instanceof Error
          ? rateError.message
          : 'Could not update the default hourly rate',
      );
    } finally {
      setBusy(false);
    }
  };

  const refreshRates = async () => {
    setFxBusy(true);
    setFxMessage(null);
    try {
      await refreshFx();
      setFxMessage('Foreign-exchange rates refreshed.');
    } catch (ratesError) {
      setFxMessage(
        ratesError instanceof Error ? ratesError.message : 'Could not refresh rates',
      );
    } finally {
      setFxBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <span className="sub">Account, shortcuts, currency, Plane connection and privacy</span>
        </div>
      </div>

      {message ? <div className="banner">{message}</div> : null}
      {error ? (
        <div className="banner banner-error" role="alert">
          {error}
        </div>
      ) : null}

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

      <ShortcutsSection />

      <section className="card card-pad stack">
        <div className="section-title">
          <h2>Currency and rates</h2>
          <Badge tone={fx?.stale ? 'warning' : 'neutral'}>
            {fx ? (fx.stale ? 'FX stale' : 'FX current') : 'FX unknown'}
          </Badge>
        </div>
        <p className="muted small">
          Every budget total converts to one reporting currency using the latest
          daily rate. Rates come from Frankfurter (European Central Bank reference
          rates) and need no API key.
          {canAdmin ? '' : ' Only administrators can change these settings.'}
        </p>
        <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 160 }}>
            <Field label="Reporting currency">
              <select
                className="select"
                value={currency}
                disabled={!canAdmin}
                onChange={(event) => setCurrency(event.target.value)}
              >
                {currencyOptions(currency).map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {canAdmin ? (
            <>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void saveCurrency()}
                disabled={busy || currency === organisation?.reportingCurrency}
              >
                Save currency
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => void refreshRates()}
                disabled={fxBusy}
              >
                {fxBusy ? 'Refreshing…' : 'Refresh FX rates'}
              </button>
            </>
          ) : null}
        </div>
        <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 160 }}>
            <Field
              label="Default hourly rate (NZD)"
              hint="Applies when no dated rate does."
            >
              <input
                className="input"
                type="number"
                min={0}
                step="0.01"
                required
                value={defaultRate}
                disabled={!canAdmin}
                onChange={(event) => setDefaultRate(event.target.value)}
              />
            </Field>
          </div>
          {canAdmin ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void saveDefaultRate()}
              disabled={busy || Number(defaultRate) === organisation?.defaultHourlyRate}
            >
              Save default rate
            </button>
          ) : null}
        </div>
        {fxMessage ? <div className="banner">{fxMessage}</div> : null}
        <p className="muted small">
          Latest known rate date: {fx?.date ?? 'unknown'} · base {fx?.base ?? 'EUR'}
          {fx?.stale ? ' · the provider was unreachable, showing the last stored rate.' : ''}
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
