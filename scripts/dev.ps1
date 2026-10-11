# Starts the backend (new window) and the frontend (this window) for local development.
# Run from anywhere:  .\scripts\dev.ps1
# Needs: uv, Node 24, and a database (docker compose up -d, or a native PostgreSQL).

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$backendFolder = Join-Path $repoRoot "backend"
$frontendFolder = Join-Path $repoRoot "frontend"

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    Write-Host "uv is not installed. See README.md, 'First-time setup'." -ForegroundColor Red
    exit 1
}
if (-not (Test-Path (Join-Path $frontendFolder "node_modules"))) {
    Write-Host "Installing frontend packages (first run only)..."
    npm --prefix "$frontendFolder" install
}

# The project folder name has spaces, so the path is passed in single quotes.
$backendCommand = "Set-Location -LiteralPath '$backendFolder'; uv run fastapi dev app/main.py"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendCommand

Write-Host "Backend:  http://localhost:8000/api/docs  (in the new window)"
Write-Host "Frontend: http://localhost:5173/admin"
Set-Location -LiteralPath $frontendFolder
npm run dev
