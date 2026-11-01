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
import { ApiError } from '../lib/api';
import { normaliseSlugs } from '../lib/workspaces';
import type { PlaneWorkspace } from '../lib/types';

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

const STATUS_LABEL: Record<PlaneWorkspace['status'], { icon: string; text: string; tone: 'success' | 'danger' | 'neutral' }> = {
  verified: { icon: '✓', text: 'Verified', tone: 'success' },
  failed: { icon: '✕', text: 'Failed', tone: 'danger' },
  pending: { icon: '…', text: 'Verifying', tone: 'neutral' },
};

/**
 * The workspaces a Plane connection reads: one slug per row with its state as
 * text and an icon, add and remove buttons, no drag interaction.
 */
function WorkspaceList({
  slugs,
  known,
  onChange,
  disabled,
}: {
  slugs: string[];
  known: PlaneWorkspace[];
  onChange: (slugs: string[]) => void;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const add = () => {
    const slug = draft.trim();
    if (slug === '') {
      setProblem('Enter a workspace slug.');
      return;
    }
    if (!/^[A-Za-z0-9_-]{1,48}$/.test(slug)) {
      setProblem('A slug may only contain letters, numbers, hyphens and underscores.');
      return;
    }
    if (slugs.some((existing) => existing.toLowerCase() === slug.toLowerCase())) {
      setProblem(`${slug} is already in the list.`);
      return;
    }
    setProblem(null);
    onChange(normaliseSlugs([...slugs, slug]));
    setDraft('');
    inputRef.current?.focus();
  };

  return (
    <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="small" style={{ fontWeight: 500 }}>
        Workspaces to sync
      </legend>
      <p className="muted small" id="workspace-list-hint">
        Plane cannot list the workspaces a token reaches, so name each one. Every
        slug is checked on its own.
      </p>
      {slugs.length === 0 ? (
        <p className="muted small">No workspace added yet.</p>
      ) : (
        <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0 }} aria-label="Workspaces">
          {slugs.map((slug) => {
            const state = known.find((entry) => entry.slug.toLowerCase() === slug.toLowerCase());
            const label = state ? STATUS_LABEL[state.status] : null;
            return (
              <li key={slug.toLowerCase()} className="row" style={{ alignItems: 'center' }}>
                <span className="mono" style={{ flex: 1 }}>
                  {slug}
                </span>
                {label ? (
                  <Badge tone={label.tone} icon={label.icon}>
                    {label.text}
                  </Badge>
                ) : (
                  <Badge tone="neutral">Not saved yet</Badge>
                )}
                {state?.status === 'failed' && state.error ? (
                  <span className="muted small">{state.error}</span>
                ) : null}
                {state?.webhookPath ? (
                  <span className="muted small mono" title="Register this path as the webhook of this workspace in Plane">
                    Webhook {state.webhookPath}
                  </span>
                ) : null}
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() =>
                    onChange(slugs.filter((entry) => entry.toLowerCase() !== slug.toLowerCase()))
                  }
                  disabled={disabled}
                  aria-label={`Remove workspace ${slug}`}
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <Field label="Workspace slug">
            <input
              ref={inputRef}
              className="input"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  add();
                }
              }}
              placeholder="my-workspace"
              aria-describedby="workspace-list-hint"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
        </div>
        <button type="button" className="btn" onClick={add} disabled={disabled}>
          Add workspace
        </button>
      </div>
      {problem ? (
        <span className="err" role="alert">
          {problem}
        </span>
      ) : null}
    </fieldset>
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
    verifyPlaneWorkspaces,
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
  // The list follows the server's until the member starts editing it.
  const [editedSlugs, setEditedSlugs] = useState<string[] | null>(null);
  const workspaceSlugs =
    editedSlugs ?? (planeConnection?.workspaces ?? []).map((workspace) => workspace.slug);
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
          workspaceSlugs: normaliseSlugs(workspaceSlugs),
          ...(planeToken ? { token: planeToken } : {}),
        }),
      );
      setPlaneToken('');
      setEditedSlugs(null);
    } catch (connectError) {
      if (connectError instanceof ApiError && connectError.status === 400) {
        const results = connectError.body?.workspaces;
        if (Array.isArray(results) && results.length > 0) {
          const failed = (results as Array<{ slug: string; error: string | null }>)
            .map((entry) => `${entry.slug}: ${entry.error ?? 'could not be read'}`)
            .join(' ');
          setError(`No workspace could be read. ${failed}`);
          return;
        }
      }
      setError(connectError instanceof Error ? connectError.message : 'Connection failed');
    } finally {
      setBusy(false);
    }
  };

  const verifyAll = async () => {
    setBusy(true);
    setError(null);
    try {
      setMessage(await verifyPlaneWorkspaces());
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : 'Verification failed');
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

      {message ? (
        <div className="banner" role="status">
          {message}
        </div>
      ) : null}
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
        <Field
          label="Personal API token"
          hint={
            planeConnection
              ? 'Leave empty to keep the stored token. One account token covers every workspace you can reach.'
              : 'One account token covers every workspace you can reach.'
          }
        >
          <input
            className="input"
            type="password"
            value={planeToken}
            onChange={(event) => setPlaneToken(event.target.value)}
            placeholder="plane_api_…"
          />
        </Field>

        <WorkspaceList
          slugs={workspaceSlugs}
          known={planeConnection?.workspaces ?? []}
          onChange={(next) => {
            setEditedSlugs(next);
          }}
          disabled={busy}
        />

        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="btn"
            onClick={() => void verifyAll()}
            disabled={busy || !planeConnection || planeConnection.workspaces.length === 0}
          >
            Verify all
          </button>
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
            disabled={busy || workspaceSlugs.length === 0 || (!planeToken && !planeConnection)}
          >
            {busy ? 'Working…' : 'Connect and sync'}
          </button>
        </div>
      </section>
    </div>
  );
}
