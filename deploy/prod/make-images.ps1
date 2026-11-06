<#
  Makes the delivery files for an install WITHOUT source code. Run on the team's own computer
  (needs the full repository, Docker running, internet):
      powershell -ExecutionPolicy Bypass -File .\make-images.ps1 -OutputDir D:\upasthiti-delivery

  Result in OutputDir:
      upasthiti-images.tar      the backend, web front door and database images (about 2 GB)
      deploy-prod\              the install folder (compose files, scripts, caddy files, .env.production.example)
      upasthiti-images.tar.sha256   a check value so the client can see the file arrived whole
  It never copies .env, certificates, backups, or any source folder.
#>
param([Parameter(Mandatory = $true)][string]$OutputDir)
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker is not running." }

# Compose wants every secret present even to build: throw-away values for this process only.
foreach ($name in "POSTGRES_PASSWORD", "APP_SECRET_KEY", "QR_SIGNING_KEY", "SNAPSHOT_ENCRYPTION_KEY",
         "FACE_TEMPLATE_KEY", "OFFLINE_EVIDENCE_KEY", "BACKUP_KEY") {
    Set-Item -Path "Env:$name" -Value "build-only"
}
Set-Item -Path "Env:APP_PUBLIC_ORIGIN" -Value "https://build-only.invalid"
Set-Item -Path "Env:SITE_ADDRESS" -Value "build-only.invalid"
# An own .env of this folder must not leak into the build: build with the plain compose file only.
$env:COMPOSE_FILE = "docker-compose.yml"
docker compose build
if ($LASTEXITCODE -ne 0) { throw "The build failed." }

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$tar = Join-Path $OutputDir "upasthiti-images.tar"
docker pull postgres:17
docker save -o $tar upasthiti-backend:prod upasthiti-caddy:prod postgres:17
if ($LASTEXITCODE -ne 0) { throw "docker save failed." }
(Get-FileHash $tar -Algorithm SHA256).Hash | Set-Content -Path "$tar.sha256" -Encoding ascii

$target = Join-Path $OutputDir "deploy-prod"
New-Item -ItemType Directory -Force -Path $target | Out-Null
$files = "docker-compose.yml", "docker-compose.images.yml", ".env.production.example", "install.ps1", "install.sh",
         "backup.ps1", "backup.sh", "start-after-signin.ps1"
foreach ($file in $files) { Copy-Item (Join-Path $here $file) $target -Force }
Copy-Item (Join-Path $here "caddy") $target -Recurse -Force
Copy-Item (Join-Path $here "..\..\docs\guides\install-guide.md") $target -Force
Copy-Item (Join-Path $here "..\..\docs\guides\install-checklist.md") $target -Force
Copy-Item (Join-Path $here "..\..\docs\guides\backup-restore.md") $target -Force
Copy-Item (Join-Path $here "..\..\docs\guides\runbook.md") $target -Force

Write-Host "Done. Copy the whole folder $OutputDir to the client computer (USB drive)."
Write-Host "On the client computer, from deploy-prod:"
Write-Host "  powershell -ExecutionPolicy Bypass -File .\install.ps1 -ImagesFile ..\upasthiti-images.tar"
