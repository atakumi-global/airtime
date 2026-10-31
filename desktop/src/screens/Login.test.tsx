import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SESSION_KEY } from '../lib/native';
import { ADMIN } from '../test/fixtures';
import { field, mountApp } from '../test/harness';
import { FakeServer, reject, unreachable } from '../test/server';
import { Login } from './Login';

async function setup() {
  const server = new FakeServer();
  const mounted = mountApp(<Login />);
  await waitFor(() => expect(mounted.app().status).toBe('login'));
  return { server, ...mounted };
}

function fill(email = 'ada@example.test', password = 'secret') {
  fireEvent.change(field('Server URL'), { target: { value: 'https://airtime.example.test' } });
  fireEvent.change(field('Email'), { target: { value: email } });
  fireEvent.change(field('Password'), { target: { value: password } });
}

describe('Login', () => {
  it('starts on the default server URL', async () => {
    await setup();
    expect(field('Server URL').value).toBe('http://localhost:3000');
    expect((field('Password') as HTMLInputElement).type).toBe('password');
  });

  it('signs in and stores the session (happy path)', async () => {
    const { server, app } = await setup();
    server.on('POST /auth/login', () => ({ token: 'tok', member: ADMIN }));

    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(app().status).toBe('ready'));
    const login = server.callsTo('POST /auth/login')[0]!;
    expect(login.url).toBe('https://airtime.example.test/auth/login');
    expect(login.body).toEqual({ email: 'ada@example.test', password: 'secret' });
    await waitFor(() => expect(window.localStorage.getItem(SESSION_KEY)).toBe('tok'));
  });

  it('shows the server message for wrong credentials (error path)', async () => {
    const { server, app } = await setup();
    server.on('POST /auth/login', () => reject(401, 'invalid_credentials'));

    fill('ada@example.test', 'wrong');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('invalid_credentials')).toBeTruthy();
    expect(app().status).toBe('login');
    expect((screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('explains when the server cannot be reached (error path)', async () => {
    const { server } = await setup();
    server.on('POST /auth/login', unreachable);

    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect((await screen.findByText(/cannot reach https:\/\/airtime\.example\.test\/auth\/login/)).textContent).toContain(
      'fetch failed',
    );
  });

  it('disables the button while signing in', async () => {
    const { server } = await setup();
    let release: (value: unknown) => void = () => undefined;
    server.on('POST /auth/login', () => new Promise((resolve) => (release = resolve)));

    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    const busy = await screen.findByRole('button', { name: 'Signing in…' });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    release({ token: 'tok', member: ADMIN });
  });
});
