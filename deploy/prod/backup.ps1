<#
  Upasthiti backup helper (Windows). Run from deploy\prod (the nightly task does this).
      .\backup.ps1 -Action create          make an encrypted backup, delete backups older than -KeepDays
      .\backup.ps1 -Action test-restore    restore the newest backup into a throw-away database and check it
  Backup files are written to BACKUP_DIR of .env. The key (BACKUP_KEY) is NOT in the backup: keep it
  in the password manager (docs/guides/backup-restore.md).
#>
param(
    [ValidateSet("create", "test-restore")][string]$Action = "create",
    [int]$KeepDays = 30
)
$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $MyInvocation.MyCommand.Path)

$backupFolder = ((Get-Content .env | Where-Object { $_ -like "BACKUP_DIR=*" }) -replace "BACKUP_DIR=", "").Trim()
if (-not $backupFolder) { throw "BACKUP_DIR is not set in .env" }
$logFile = Join-Path $backupFolder "backup.log"
function Write-Log($text) { Add-Content -Path $logFile -Value "$(Get-Date -Format s) $text" }

if ($Action -eq "create") {
    Write-Log "backup starting"
    # docker writes progress to stderr: let it pass without turning it into a PowerShell error.
    $ErrorActionPreference = "Continue"
    $output = docker compose exec -T backend python -m app.scripts.backup create --output-dir /backups 2>&1
    $code = $LASTEXITCODE
    $ErrorActionPreference = "Stop"
    Add-Content -Path $logFile -Value $output
    if ($code -ne 0) { Write-Log "BACKUP FAILED"; exit 1 }
    # The script never deletes: the age rule lives here. Both the file and its manifest go.
    $limit = (Get-Date).AddDays(-$KeepDays)
    Get-ChildItem $backupFolder -Filter "upasthiti-backup-*" | Where-Object { $_.LastWriteTime -lt $limit } | Remove-Item -Force
    Write-Log "backup finished, files older than $KeepDays days removed"
    exit 0
}

# test-restore: the target name must end in _drill; it is dropped again afterwards.
$newest = Get-ChildItem $backupFolder -Filter "*.upsbak" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $newest) { throw "No backup file found in $backupFolder" }
Write-Host "Restoring $($newest.Name) into the throw-away database upasthiti_drill ..."
$ErrorActionPreference = "Continue"
docker compose exec -T postgres psql -U upasthiti -d postgres -c "DROP DATABASE IF EXISTS upasthiti_drill" | Out-Null
docker compose exec -T backend python -m app.scripts.backup restore --file "/backups/$($newest.Name)" --target-database upasthiti_drill --confirm
$code = $LASTEXITCODE
docker compose exec -T postgres psql -U upasthiti -d postgres -c "DROP DATABASE IF EXISTS upasthiti_drill" | Out-Null
if ($code -eq 0) { Write-Host "RESTORE TEST PASSED" -ForegroundColor Green } else { Write-Host "RESTORE TEST FAILED" -ForegroundColor Red }
exit $code
