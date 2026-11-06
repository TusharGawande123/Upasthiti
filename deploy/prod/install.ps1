<#
  Upasthiti - one-command install on a Windows computer with Docker (own-server install).

  Run in PowerShell AS ADMINISTRATOR, from the folder deploy\prod of the repository:
      powershell -ExecutionPolicy Bypass -File .\install.ps1

  What it does (it is safe to run again; it never overwrites an existing .env):
    1. checks Docker, the port and the clock
    2. asks for the DuckDNS name and token, makes .env with fresh secret keys
    3. builds the images and starts the database, backend and web front door
    4. opens the firewall for this plant network only
    5. sets the nightly backup and the start-after-sign-in tasks
    6. runs the preflight check and asks you to create the first Super Admin
  Nothing secret is printed on the screen except the one-time key reminder at the end.
#>
[CmdletBinding()]
param(
    [string]$BackupDir = "C:/upasthiti-backups",
    # Moving from another computer: path of the .upsbak file. The .env of the old computer must
    # already be in this folder (same keys). See docs/guides/install-guide.md, section 10.
    [string]$RestoreFrom = "",
    # Delivery without source code: path of upasthiti-images.tar made by make-images.ps1. The
    # images are loaded instead of built. Also chosen automatically when the folders backend and
    # frontend are not next to deploy (then the images must already be loaded).
    [string]$ImagesFile = "",
    [switch]$SkipFirewall,
    [switch]$SkipScheduledTasks
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here
$envFile = Join-Path $here ".env"

function Write-Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Stop-Install($text) { Write-Host "`nSTOP: $text" -ForegroundColor Red; exit 1 }

function Test-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    return ([Security.Principal.WindowsPrincipal]$identity).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
}

# A random text of letters and digits (safe inside a database address).
function New-AlphanumericSecret($length) {
    $letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    $bytes = New-Object byte[] $length
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    return -join ($bytes | ForEach-Object { $letters[$_ % $letters.Length] })
}

function ConvertTo-PlainText($secureText) {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureText)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

# Asks a question; an empty answer gives the default.
function Read-Answer($question, $default) {
    $answer = Read-Host "$question [$default]"
    if ([string]::IsNullOrWhiteSpace($answer)) { return $default }
    return $answer.Trim()
}

# `docker run` of our own image prints "NAME=value" as its first line: keep that line only.
function New-KeyLine($module) {
    $output = docker run --rm upasthiti-backend:prod python -m $module
    if ($LASTEXITCODE -ne 0) { Stop-Install "Could not make a key with $module" }
    return ($output | Select-Object -First 1)
}

function Get-LanAddress {
    $route = Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -ne $null -and $_.NetAdapter.Status -eq "Up" } | Select-Object -First 1
    if ($route) { return $route.IPv4Address.IPAddress }
    return $null
}

# --- 1. Checks ---------------------------------------------------------------------------
Write-Step "1. Checking this computer"
if (-not (Test-Administrator)) { Stop-Install "Open PowerShell with 'Run as administrator' and run this again." }
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Stop-Install "Docker is not installed. Install Docker Desktop (or Docker Engine) first: see docs/guides/install-guide.md, section 3."
}
docker info *> $null
if ($LASTEXITCODE -ne 0) { Stop-Install "Docker is installed but not running. Start Docker Desktop, wait until it says 'running', then run this again." }
docker compose version *> $null
if ($LASTEXITCODE -ne 0) { Stop-Install "'docker compose' is missing. Update Docker Desktop." }

$freeGigabytes = [math]::Round((Get-PSDrive C).Free / 1GB, 1)
if ($freeGigabytes -lt 20) { Stop-Install "Only $freeGigabytes GB free on C:. At least 20 GB is needed." }
Write-Host "Docker works. Free disk on C: $freeGigabytes GB."

# --- 1b. Ready-made images instead of building from source -------------------------------
$imagesOnly = [bool]$ImagesFile -or -not (Test-Path (Join-Path $here "../../backend"))
if ($imagesOnly) {
    Write-Step "1b. Using ready-made images (no source code needed)"
    if ($ImagesFile) {
        if (-not (Test-Path $ImagesFile)) { Stop-Install "Images file not found: $ImagesFile" }
        docker load -i $ImagesFile
        if ($LASTEXITCODE -ne 0) { Stop-Install "docker load failed. Is the file complete?" }
    }
    docker image inspect upasthiti-backend:prod upasthiti-caddy:prod postgres:17 *> $null
    if ($LASTEXITCODE -ne 0) { Stop-Install "The images are not loaded. Run again with -ImagesFile <path to upasthiti-images.tar>." }
}
# Compose reads these two lines from .env, so every later command (backup, update) uses the images too.
function Add-ImagesOnlySettings {
    $text = Get-Content $envFile -Raw
    if ($text -notmatch "COMPOSE_FILE=") {
        [IO.File]::AppendAllText($envFile, "COMPOSE_PATH_SEPARATOR=,`nCOMPOSE_FILE=docker-compose.yml,docker-compose.images.yml`n", (New-Object Text.UTF8Encoding($false)))
    }
}
$buildFlag = "--build"
if ($imagesOnly) { $buildFlag = "--no-build" }

# --- 2. The .env file --------------------------------------------------------------------
Write-Step "2. Settings and secret keys"
$existingEnv = Test-Path $envFile
if ($existingEnv) {
    Write-Host ".env already exists: keeping it (your keys stay the same)."
    if ($imagesOnly) { Add-ImagesOnlySettings }
} else {
    $siteName = Read-Host "Address name WITHOUT https:// (example: yourname.duckdns.org)"
    if ($siteName -notmatch '^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$') { Stop-Install "That is not a valid name." }
    $port = Read-Answer "HTTPS port people will use (443, or 8443 if 443 is busy)" "443"
    $busy = Get-NetTCPConnection -State Listen -LocalPort ([int]$port) -ErrorAction SilentlyContinue
    if ($busy) { Stop-Install "Port $port is already in use on this computer. Run again and choose 8443." }
    $duckToken = ConvertTo-PlainText (Read-Host "DuckDNS token (typing is hidden)" -AsSecureString)
    if ([string]::IsNullOrWhiteSpace($duckToken)) { Stop-Install "The DuckDNS token is needed for the certificate." }
    $backupFolder = Read-Answer "Folder for backup files (use another disk if there is one)" $BackupDir
    New-Item -ItemType Directory -Force -Path $backupFolder | Out-Null

    $origin = "https://$siteName"
    if ($port -ne "443") { $origin = "https://${siteName}:$port" }

    # The images are built (or loaded) first, because the keys are made by our own backend image.
    # Compose wants every secret present even to build, so a throw-away value is set for this one command.
    foreach ($name in "POSTGRES_PASSWORD", "APP_SECRET_KEY", "QR_SIGNING_KEY", "SNAPSHOT_ENCRYPTION_KEY",
             "FACE_TEMPLATE_KEY", "OFFLINE_EVIDENCE_KEY", "BACKUP_KEY") {
        Set-Item -Path "Env:$name" -Value "build-only"
    }
    Set-Item -Path "Env:APP_PUBLIC_ORIGIN" -Value "https://build-only.invalid"
    Set-Item -Path "Env:SITE_ADDRESS" -Value "build-only.invalid"
    Write-Step "2b. Building the images (first time: 10 to 25 minutes, needs internet)"
    if (-not $imagesOnly) {
        docker compose build
        if ($LASTEXITCODE -ne 0) { Stop-Install "The build failed. Read the last lines above; see troubleshooting in the install guide." }
    }
    foreach ($name in "POSTGRES_PASSWORD", "APP_SECRET_KEY", "QR_SIGNING_KEY", "SNAPSHOT_ENCRYPTION_KEY",
             "FACE_TEMPLATE_KEY", "OFFLINE_EVIDENCE_KEY", "BACKUP_KEY", "APP_PUBLIC_ORIGIN", "SITE_ADDRESS") {
        Remove-Item -Path "Env:$name" -ErrorAction SilentlyContinue
    }

    $secretKeyBytes = New-Object byte[] 48
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($secretKeyBytes)
    $appSecret = [Convert]::ToBase64String($secretKeyBytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")

    $lines = @(
        "# Made by install.ps1. SECRET: never commit, never send by chat or email.",
        "SITE_ADDRESS=$siteName",
        "APP_PUBLIC_ORIGIN=$origin",
        "HTTPS_PORT=$port",
        "DUCKDNS_TOKEN=$duckToken",
        "CADDYFILE=Caddyfile.duckdns",
        "POSTGRES_PASSWORD=$(New-AlphanumericSecret 32)",
        "APP_SECRET_KEY=$appSecret",
        (New-KeyLine "app.scripts.make_qr_key"),
        "QR_SIGNING_KEY_ID=A",
        (New-KeyLine "app.scripts.make_snapshot_key"),
        (New-KeyLine "app.scripts.make_face_key"),
        (New-KeyLine "app.scripts.make_offline_key"),
        "OFFLINE_EVIDENCE_KEY_ID=A",
        (New-KeyLine "app.scripts.make_backup_key"),
        "BACKUP_KEY_ID=A",
        "BACKUP_DIR=$($backupFolder.Replace('\', '/'))",
        "CERT_DIR=./certs",
        "APP_VERSION=prod",
        "LOG_LEVEL=INFO"
    )
    # UTF-8 without a byte-order mark: Docker Compose reads it cleanly.
    [IO.File]::WriteAllText($envFile, (($lines -join "`n") + "`n"), (New-Object Text.UTF8Encoding($false)))
    if ($imagesOnly) { Add-ImagesOnlySettings }
    # Only administrators and this user may read the secrets.
    icacls $envFile /inheritance:r /grant:r "Administrators:F" "$($env:USERNAME):F" | Out-Null
    Write-Host ".env written with new keys."

    $answer = Read-Answer "Point $siteName to this computer's network address on DuckDNS now? (y/n)" "y"
    $lan = Get-LanAddress
    if ($answer -eq "y" -and $lan) {
        $result = Invoke-RestMethod "https://www.duckdns.org/update?domains=$($siteName -replace '\.duckdns\.org$','')&token=$duckToken&ip=$lan"
        Write-Host "DuckDNS answered: $result (address set to this computer's network address $lan)."
    } else {
        Write-Host "Skipped. Set the DuckDNS address to this computer's network address yourself (guide, section 5)."
    }
}

# --- 2c. Restore a backup (moving from another computer) ----------------------------------
if ($RestoreFrom) {
    Write-Step "2c. Restoring the backup of the old computer"
    if (-not $existingEnv) { Stop-Install "Copy the .env of the OLD computer into this folder first (same keys), then run again with -RestoreFrom." }
    if (-not (Test-Path $RestoreFrom)) { Stop-Install "Backup file not found: $RestoreFrom" }
    $backupFolder = ((Get-Content $envFile | Where-Object { $_ -like "BACKUP_DIR=*" }) -replace "BACKUP_DIR=", "").Trim()
    New-Item -ItemType Directory -Force -Path $backupFolder | Out-Null
    Copy-Item $RestoreFrom $backupFolder -Force
    $restoreName = Split-Path -Leaf $RestoreFrom
    if (-not $imagesOnly) { docker compose build }
    docker compose up -d postgres
    Start-Sleep -Seconds 15
    # The file name is part of the encryption: it must stay as the old computer made it.
    docker compose run --rm --no-deps backend python -m app.scripts.backup restore `
        --file "/backups/$restoreName" --target-database upasthiti --confirm-any-name --confirm `
        --snapshots-dir /data/snapshots
    if ($LASTEXITCODE -ne 0) { Stop-Install "The restore failed. Nothing was started. Read the lines above." }
    Write-Host "Restore finished and checked."
}

# --- 3. Start ----------------------------------------------------------------------------
Write-Step "3. Starting the system"
docker compose up -d $buildFlag
if ($LASTEXITCODE -ne 0) { Stop-Install "docker compose could not start. Run: docker compose logs" }

Write-Host "Waiting for the backend to become healthy (up to 5 minutes)..."
$healthy = $false
for ($attempt = 0; $attempt -lt 60; $attempt++) {
    $state = docker inspect --format "{{.State.Health.Status}}" upasthiti-prod-backend-1 2>$null
    if ($state -eq "healthy") { $healthy = $true; break }
    Start-Sleep -Seconds 5
}
if (-not $healthy) { Stop-Install "The backend did not become healthy. Run: docker compose logs backend" }
Write-Host "Backend is healthy."

# --- 4. Firewall -------------------------------------------------------------------------
if (-not $SkipFirewall) {
    Write-Step "4. Firewall: only the plant network may connect"
    $envText = Get-Content $envFile | Where-Object { $_ -like "HTTPS_PORT=*" }
    $firewallPort = [int]($envText -replace "HTTPS_PORT=", "")
    Get-NetFirewallRule -DisplayName "Upasthiti HTTPS" -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    New-NetFirewallRule -DisplayName "Upasthiti HTTPS" -Direction Inbound -Protocol TCP `
        -LocalPort $firewallPort -RemoteAddress LocalSubnet -Action Allow | Out-Null
    Write-Host "Rule 'Upasthiti HTTPS': port $firewallPort, local network only."
    Write-Host "(Phones outside the plant network need a different set-up: guide, section 11.)"
}

# --- 5. Scheduled tasks ------------------------------------------------------------------
if (-not $SkipScheduledTasks) {
    Write-Step "5. Nightly backup and start after sign-in"
    $backupAction = New-ScheduledTaskAction -Execute "powershell.exe" `
        -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$here\backup.ps1`" -Action create" -WorkingDirectory $here
    $backupTrigger = New-ScheduledTaskTrigger -Daily -At 2:00AM
    Register-ScheduledTask -TaskName "Upasthiti backup" -Action $backupAction -Trigger $backupTrigger `
        -RunLevel Highest -Force | Out-Null
    $startAction = New-ScheduledTaskAction -Execute "powershell.exe" `
        -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$here\start-after-signin.ps1`"" -WorkingDirectory $here
    $startTrigger = New-ScheduledTaskTrigger -AtLogOn
    Register-ScheduledTask -TaskName "Upasthiti start" -Action $startAction -Trigger $startTrigger `
        -RunLevel Highest -Force | Out-Null
    Write-Host "Tasks made: 'Upasthiti backup' (02:00 every night), 'Upasthiti start' (after sign-in)."
}

# --- 6. Preflight and first admin ----------------------------------------------------------
Write-Step "6. Preflight check"
docker compose exec -T backend python -m app.scripts.preflight

Write-Step "7. First Super Admin"
Write-Host "It asks for a username, name and password (typing is hidden). It refuses if one already exists."
docker compose exec backend python -m app.scripts.create_super_admin

Write-Step "Done"
$origin = (Get-Content $envFile | Where-Object { $_ -like "APP_PUBLIC_ORIGIN=*" }) -replace "APP_PUBLIC_ORIGIN=", ""
Write-Host "Admin website : $origin/admin"
Write-Host "Attendance device screen : $origin/attendance"
Write-Host ""
Write-Host "NOW, BEFORE ANYTHING ELSE: copy the keys of this file into the company password manager:" -ForegroundColor Yellow
Write-Host "    $envFile"
Write-Host "QR_SIGNING_KEY, SNAPSHOT_ENCRYPTION_KEY, FACE_TEMPLATE_KEY, OFFLINE_EVIDENCE_KEY, BACKUP_KEY, POSTGRES_PASSWORD."
Write-Host "Lost keys mean lost cards, photos, faces and backups. See docs/guides/install-guide.md, section 8."
