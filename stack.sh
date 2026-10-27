#!/usr/bin/env bash
# stack.sh — this project's local stack and dev preview (factory standard: STACK.md).
#   ./stack.sh start|stop|restart|status|url|logs
# Fill in the four PROJECT settings and the prepare/app_env functions below.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

# ---------------------------------------------------------------- PROJECT settings
PROJECT="airtime"                           # lowercase, e.g. airtime
DEFAULT_BASE_PORT="3500"                    # e.g. 3500 (factory-ops registers/PORTS.md)
COMPOSE_FILE="docker-compose.local.yml"     # services: database, search, mail; "" if none
APP_CMD="npm run dev"                       # e.g. "npm run dev"; "" if compose runs the app
HEALTH_PATH="/health"                       # path that answers 200 when the app is usable

# ---------------------------------------------------------------- ports and names
BASE_PORT="${STACK_BASE_PORT:-$DEFAULT_BASE_PORT}"
INSTANCE="${STACK_INSTANCE:-local}"
export STACK_BIND=127.0.0.1
export APP_PORT=$((BASE_PORT + 0)) API_PORT=$((BASE_PORT + 1)) DB_PORT=$((BASE_PORT + 2))
# docker-compose.local.yml (shared with air.ps1) reads the database port from PG_PORT.
export PG_PORT="$DB_PORT"
export DB2_PORT=$((BASE_PORT + 3)) SEARCH_PORT=$((BASE_PORT + 4))
export MAIL_SMTP_PORT=$((BASE_PORT + 5)) MAIL_UI_PORT=$((BASE_PORT + 6))
COMPOSE_PROJECT="${PROJECT}-${INSTANCE}"
STATE_DIR=".stack/${INSTANCE}"
# Development secrets live outside the working tree, so factory-check's working-tree
# secret scan never sees them and they can never be committed.
SECRETS_FILE="${XDG_STATE_HOME:-$HOME/.local/state}/stack/${COMPOSE_PROJECT}.env"
URL="http://127.0.0.1:${APP_PORT}${HEALTH_PATH}"

# ---------------------------------------------------------------- PROJECT hooks
# Development secrets: generated once into $SECRETS_FILE (outside the repository),
# never real ones. One KEY=VALUE per line; quote values that contain spaces.
# No Plane token is stored here; Plane connections are added in the app by a user.
dev_secrets() {
  local jwt cookie key pass
  jwt=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
  cookie=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
  key=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
  pass=$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')
  cat <<EOF
APP_JWT_SECRET=${jwt}
COOKIE_SECRET=${cookie}
TOKEN_ENCRYPTION_KEY=${key}
BOOTSTRAP_ORG_NAME="Airtime Dev"
BOOTSTRAP_ADMIN_EMAIL=admin@airtime.test
BOOTSTRAP_ADMIN_PASSWORD=dev-${pass}
BOOTSTRAP_ADMIN_NAME="Dev Administrator"
EOF
}

# Install dependencies, run migrations, load seed data. Must be idempotent.
# Migrations and the bootstrap admin are applied by the server itself on startup
# (server/src/index.ts), so only dependencies are installed here.
prepare() {
  if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
    npm ci --no-audit --no-fund
  fi
}

# Extra environment for the app process (the dev secrets are already exported).
app_env() {
  export HOST=127.0.0.1
  export PORT="$APP_PORT"
  export DATABASE_URL="postgres://airtime:airtime@127.0.0.1:${DB_PORT}/airtime"
  export CORS_ORIGINS="http://localhost:${APP_PORT},http://127.0.0.1:${APP_PORT}"
}

# ---------------------------------------------------------------- implementation
compose() { [ -n "$COMPOSE_FILE" ] && docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" "$@"; }
pidfile() { echo "$STATE_DIR/app.pid"; }
# The app runs in its own process group (setsid), so stop also ends watchers and
# children such as `tsx --watch` or `next dev` workers.
app_running() { [ -f "$(pidfile)" ] && kill -0 -- "-$(cat "$(pidfile)")" 2>/dev/null; }
healthy() { curl -fs -m 5 --noproxy '*' -o /dev/null "$URL"; }

port_free_or_ours() {
  local port="$1"
  if ss -Hltn "sport = :$port" 2>/dev/null | grep -q .; then
    app_running && return 0
    compose ps --status running -q 2>/dev/null | grep -q . && return 0
    echo "FAIL: port $port is in use by something else ($(ss -Hltnp "sport = :$port" | head -1))" >&2
    return 1
  fi
}

start() {
  mkdir -p "$STATE_DIR" "$(dirname "$SECRETS_FILE")"
  if [ ! -f "$SECRETS_FILE" ]; then (umask 077; dev_secrets > "$SECRETS_FILE"); fi
  set -a
  # shellcheck disable=SC1090
  . "$SECRETS_FILE"
  set +a
  port_free_or_ours "$APP_PORT"
  if [ -n "$COMPOSE_FILE" ]; then compose up -d --wait; fi
  prepare
  if [ -n "$APP_CMD" ] && ! app_running; then
    app_env
    setsid nohup bash -c "$APP_CMD" > "$STATE_DIR/app.log" 2>&1 < /dev/null &
    echo $! > "$(pidfile)"
  fi
  for _ in $(seq 1 120); do
    if healthy; then echo "up: $URL"; return 0; fi
    sleep 1
  done
  echo "FAIL: $URL did not come up within 120 s; last log lines:" >&2
  tail -n 30 "$STATE_DIR/app.log" 2>/dev/null >&2 || true
  return 1
}

stop() {
  if app_running; then
    local pgid; pgid="$(cat "$(pidfile)")"
    kill -TERM -- "-$pgid" 2>/dev/null || true
    for _ in $(seq 1 10); do kill -0 -- "-$pgid" 2>/dev/null || break; sleep 0.5; done
    kill -KILL -- "-$pgid" 2>/dev/null || true
  fi
  rm -f "$(pidfile)"
  if [ -n "$COMPOSE_FILE" ]; then compose stop >/dev/null 2>&1 || true; fi
  echo "stopped ${COMPOSE_PROJECT}"
}

status() {
  echo "instance: $COMPOSE_PROJECT  app: $URL"
  if [ -n "$COMPOSE_FILE" ]; then compose ps 2>/dev/null || true; fi
  if healthy; then echo "healthy"; else echo "not healthy"; return 1; fi
}

logs() {
  tail -n 60 "$STATE_DIR/app.log" 2>/dev/null || true
  if [ -n "$COMPOSE_FILE" ]; then compose logs --tail 40 2>/dev/null || true; fi
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  restart) stop; start ;;
  status) status ;;
  url) echo "$URL" ;;
  logs) logs ;;
  *) echo "usage: ./stack.sh start|stop|restart|status|url|logs" >&2; exit 2 ;;
esac
