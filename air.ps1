<#
.SYNOPSIS
  Manage the Airtime dev stack: PostgreSQL in Docker Compose plus the Fastify
  dev server (tsx watch) in a psmux session.

.USAGE
  .\air.ps1 start     # start postgres and the dev server in session "airtime"
  .\air.ps1 stop      # stop the dev server and docker compose
  .\air.ps1 restart   # stop then start
  .\air.ps1 attach    # attach to the psmux session to watch logs
  .\air.ps1 status    # show what is running and whether /health is up
#>
param(
  [Parameter(Position = 0)]
  [ValidateSet('start', 'stop', 'restart', 'attach', 'status')]
  [string]$Action = 'start'
)

$ErrorActionPreference = 'Stop'

# --- Config ------------------------------------------------------------------

$Root        = Split-Path -Parent $MyInvocation.MyCommand.Path
$ComposeFile = Join-Path $Root 'docker-compose.local.yml'
$EnvFile     = Join-Path $Root '.env'
$EnvExample  = Join-Path $Root '.env.example'
$Session     = 'airtime'
$PgStart     = 5432
$PgEnd       = 5462
$ServerStart = 3000
$ServerEnd   = 3030

# --- Helpers -----------------------------------------------------------------

function Test-Session {
  $list = & tmux ls 2>$null
  return ($LASTEXITCODE -eq 0) -and ($list -match "^${Session}:")
}

function Get-FreePort {
  param([int]$Start, [int]$End)
  for ($port = $Start; $port -le $End; $port++) {
    $busy = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
    if (-not $busy) { return $port }
  }
  throw "No free port between $Start and $End"
}

function Get-RandomHex {
  param([int]$Bytes)
  $buffer = [byte[]]::new($Bytes)
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($buffer)
  return [Convert]::ToHexString($buffer).ToLower()
}

function Set-EnvValue {
  param([string]$Key, [string]$Value)
  $content = Get-Content $EnvFile -Raw
  $pattern = "(?m)^$([regex]::Escape($Key))=.*$"
  if ($content -match $pattern) {
    $content = [regex]::Replace($content, $pattern, "$Key=$Value")
  } else {
    $content = $content.TrimEnd() + "`n$Key=$Value`n"
  }
  Set-Content -LiteralPath $EnvFile -Value $content -NoNewline
}

function Get-EnvValue {
  param([string]$Key, [string]$Default = '')
  if (-not (Test-Path -LiteralPath $EnvFile)) { return $Default }
  $match = Select-String -LiteralPath $EnvFile -Pattern "^$([regex]::Escape($Key))=(.*)$" |
    Select-Object -First 1
  if ($match) { return $match.Matches[0].Groups[1].Value }
  return $Default
}

function Ensure-Env {
  if (-not (Test-Path -LiteralPath $EnvFile)) {
    Copy-Item -LiteralPath $EnvExample -Destination $EnvFile
    Write-Host "Created .env from .env.example" -ForegroundColor Cyan
  }
  foreach ($key in 'APP_JWT_SECRET', 'COOKIE_SECRET') {
    if ((Get-EnvValue $key) -in '', 'change-me-in-production') {
      Set-EnvValue $key (Get-RandomHex 32)
    }
  }
  if ((Get-EnvValue 'TOKEN_ENCRYPTION_KEY') -eq '') {
    Set-EnvValue 'TOKEN_ENCRYPTION_KEY' (Get-RandomHex 32)
  }
  if ((Get-EnvValue 'BOOTSTRAP_ADMIN_PASSWORD') -in '', 'change-me-in-production') {
    Set-EnvValue 'BOOTSTRAP_ADMIN_PASSWORD' (Get-RandomHex 12)
  }
  $serverPort = [int](Get-EnvValue 'PORT' '0')
  $portBusy = (Get-NetTCPConnection -State Listen -LocalPort $serverPort -ErrorAction SilentlyContinue)
  if ($serverPort -eq 0 -or $portBusy) {
    $serverPort = Get-FreePort $ServerStart $ServerEnd
    Set-EnvValue 'PORT' "$serverPort"
  }
  $env:PgPort = "$(Get-FreePort $PgStart $PgEnd)"
}

function Start-Stack {
  Ensure-Env

  Write-Host "Starting postgres on host port $($env:PgPort)..." -ForegroundColor Cyan
  Push-Location $Root
  try {
    $env:PG_PORT = $env:PgPort
    docker compose -f $ComposeFile up -d postgres
    if ($LASTEXITCODE -ne 0) { throw 'docker compose failed' }
  } finally {
    Pop-Location
  }

  Write-Host 'Waiting for PostgreSQL to be ready...' -ForegroundColor Cyan
  $script:healthy = $false
  for ($i = 0; $i -lt 30; $i++) {
    & docker compose -f $ComposeFile ps postgres --format json 2>$null |
      ConvertFrom-Json | Where-Object { $_.Health -eq 'healthy' } | ForEach-Object { $script:healthy = $true }
    if ($script:healthy) { break }
    Start-Sleep -Seconds 2
  }
  if (-not $script:healthy) { throw 'PostgreSQL did not become healthy within 60s' }

  $serverPort = Get-EnvValue 'PORT' '3000'
  Set-EnvValue 'DATABASE_URL' "postgres://$(Get-EnvValue 'POSTGRES_USER' 'airtime'):$(Get-EnvValue 'POSTGRES_PASSWORD' 'airtime')@localhost:$($env:PgPort)/$(Get-EnvValue 'POSTGRES_DB' 'airtime')"

  if (-not (Test-Path -LiteralPath (Join-Path $Root 'node_modules'))) {
    Write-Host 'Installing npm dependencies...' -ForegroundColor Cyan
    Push-Location $Root
    try { npm install } finally { Pop-Location }
  }

  if (Test-Session) {
    Write-Host "psmux session '$Session' already exists; use .\air.ps1 restart" -ForegroundColor DarkYellow
  } else {
    Write-Host "Creating psmux session '$Session'..." -ForegroundColor Cyan
    & tmux new-session -d -s $Session -n server -c $Root
    & tmux send-keys -t "${Session}:server" 'npm run dev' Enter
    & tmux new-window -t $Session -n postgres -c $Root
    & tmux send-keys -t "${Session}:postgres" "docker compose -f docker-compose.local.yml logs -f postgres" Enter
  }

  Write-Host ''
  Write-Host "Airtime server:  http://localhost:$serverPort" -ForegroundColor Green
  Write-Host "Health:          http://localhost:$serverPort/health" -ForegroundColor Green
  Write-Host 'Logs:            .\air.ps1 attach' -ForegroundColor DarkGray
}

function Stop-Stack {
  if (Test-Session) {
    & tmux kill-session -t $Session
    Write-Host "Stopped psmux session '$Session'" -ForegroundColor Cyan
  } else {
    Write-Host "no '$Session' session" -ForegroundColor DarkGray
  }
  Push-Location $Root
  try {
    docker compose -f $ComposeFile down
  } finally {
    Pop-Location
  }
}

function Get-Status {
  Write-Host '=== psmux ===' -ForegroundColor Cyan
  if (Test-Session) {
    & tmux list-windows -t $Session
  } else {
    Write-Host "no '$Session' session" -ForegroundColor DarkGray
  }

  Write-Host "`n=== docker compose ===" -ForegroundColor Cyan
  Push-Location $Root
  try {
    docker compose -f $ComposeFile ps
  } finally {
    Pop-Location
  }

  $serverPort = Get-EnvValue 'PORT' '3000'
  Write-Host "`n=== health ===" -ForegroundColor Cyan
  try {
    $health = Invoke-RestMethod -Uri "http://localhost:$serverPort/health" -TimeoutSec 3
    Write-Host "http://localhost:$serverPort/health -> $($health | ConvertTo-Json -Compress)" -ForegroundColor Green
  } catch {
    Write-Host "http://localhost:$serverPort/health is not responding" -ForegroundColor DarkYellow
  }

  if (-not (Test-Session)) {
    Write-Host "`nStart with:  .\air.ps1 start" -ForegroundColor DarkGray
  }
}

switch ($Action) {
  'start'   { Start-Stack }
  'stop'    { Stop-Stack }
  'restart' { Stop-Stack; Start-Sleep -Seconds 2; Start-Stack }
  'attach'  { & tmux attach -t $Session }
  'status'  { Get-Status }
}
