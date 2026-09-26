import { useState } from 'react';
import { useApp } from '../state/AppContext';
import { Field } from '../components/ui';

export function Login() {
  const { baseUrl, login } = useApp();
  const [url, setUrl] = useState(baseUrl);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(url, email, password);
    } catch (loginError) {
      setError(
        loginError instanceof Error ? loginError.message : 'Could not sign in',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="login-card card card-pad stack">
        <div className="brand" style={{ padding: 0 }}>
          <span className="brand-mark">A</span>
          Airtime
        </div>
        <div>
          <h1>Sign in</h1>
          <p className="muted small">
            Connect to your self-hosted Airtime server. Your session token is kept
            in Windows Credential Manager, never in a file.
          </p>
        </div>

        <form className="stack" onSubmit={(event) => void submit(event)}>
          <Field label="Server URL">
            <input
              className="input"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="http://localhost:3000"
              autoComplete="url"
            />
          </Field>
          <Field label="Email">
            <input
              className="input"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="username"
              required
            />
          </Field>
          <Field label="Password">
            <input
              className="input"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </Field>

          {error ? <div className="banner banner-error">{error}</div> : null}

          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="muted small">
          Plane projects and work items are connected after sign-in, in Settings.
          Airtime only ever reads from Plane.
        </p>
      </div>
    </div>
  );
}
