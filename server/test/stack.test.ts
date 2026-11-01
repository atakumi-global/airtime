import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// AIRTIME-95: the dev preview did not start because its Postgres container was running and
// healthy but had lost its published port (Docker leaves a container like that when it is
// started while another container still holds the port). `docker compose up --wait` accepts
// such a container, so the app got ECONNREFUSED on the database port. stack.sh must notice
// that the port is not listening and recreate the services (named volumes are kept).
// docker, ss, curl and npm are replaced by small fakes; no container is started.

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function fake(bin: string, name: string, body: string): void {
  const file = join(bin, name);
  writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(file, 0o755);
}

interface Result {
  status: number | null;
  stderr: string;
  composeCalls: string[];
}

function runStart(options: { portListensAfterPlainUp: boolean; portListensAfterRecreate: boolean }): Result {
  const root = mkdtempSync(join(tmpdir(), 'stack-test-'));
  const instance = `t${process.pid}`;
  const bin = join(root, 'bin');
  const calls = join(root, 'compose.calls');
  const listening = join(root, 'listening');
  mkdirSync(bin);
  writeFileSync(calls, '');
  // docker compose ... up: a plain `up` publishes the port only when the test says so, a
  // `--force-recreate` only when the test says so.
  fake(
    bin,
    'docker',
    `echo "$*" >> '${calls}'
case "$*" in
  *"--force-recreate"*) ${options.portListensAfterRecreate ? `touch '${listening}'` : `rm -f '${listening}'`} ;;
  *" up "*) ${options.portListensAfterPlainUp ? `touch '${listening}'` : `rm -f '${listening}'`} ;;
esac
exit 0`,
  );
  // ss: the database port listens when the marker file exists; the app port never does.
  fake(
    bin,
    'ss',
    `case "$*" in *":3502"*) [ -f '${listening}' ] && echo "LISTEN 0 0 127.0.0.1:3502 0.0.0.0:*"; exit 0 ;; esac
exit 0`,
  );
  fake(bin, 'curl', 'exit 0');
  fake(bin, 'npm', 'case "$1" in run) exec sleep 30 ;; esac\nexit 0');
  try {
    const result = spawnSync('bash', [join(repo, 'stack.sh'), 'start'], {
      cwd: repo,
      encoding: 'utf8',
      timeout: 60_000,
      env: {
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        HOME: root,
        XDG_STATE_HOME: join(root, 'state'),
        STACK_INSTANCE: instance,
        STACK_BASE_PORT: '3500',
      },
    });
    return {
      status: result.status,
      stderr: result.stderr,
      composeCalls: readFileSync(calls, 'utf8').split('\n').filter(Boolean),
    };
  } finally {
    spawnSync('bash', [join(repo, 'stack.sh'), 'stop'], {
      cwd: repo,
      env: { PATH: `${bin}:${process.env.PATH ?? ''}`, HOME: root, XDG_STATE_HOME: join(root, 'state'), STACK_INSTANCE: instance, STACK_BASE_PORT: '3500' },
    });
    rmSync(join(repo, '.stack', instance), { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
}

test('stack.sh recreates services whose database port is not published (volumes kept)', () => {
  const result = runStart({ portListensAfterPlainUp: false, portListensAfterRecreate: true });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.composeCalls.filter((c) => c.includes('--force-recreate')).length, 1);
  assert.ok(
    result.composeCalls.every((c) => !/\bdown\b|\s-v\b|--volumes/.test(c)),
    'volumes are never removed',
  );
  assert.match(result.stderr, /recreating them \(volumes kept\)/);
});

test('stack.sh does not recreate services whose database port is published', () => {
  const result = runStart({ portListensAfterPlainUp: true, portListensAfterRecreate: true });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.composeCalls.filter((c) => c.includes('--force-recreate')).length, 0);
});

test('stack.sh fails with a clear message when the database port stays unpublished', () => {
  const result = runStart({ portListensAfterPlainUp: false, portListensAfterRecreate: false });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /database port 3502 is still not listening/);
});
