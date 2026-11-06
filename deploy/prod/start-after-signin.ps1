# Runs at sign-in (task "Upasthiti start"): waits for Docker, then makes sure the containers run.
# The containers also restart by themselves ("restart: unless-stopped") once Docker is up.
Set-Location (Split-Path -Parent $MyInvocation.MyCommand.Path)
for ($attempt = 0; $attempt -lt 60; $attempt++) {
    docker info *> $null
    if ($LASTEXITCODE -eq 0) { break }
    Start-Sleep -Seconds 10
}
docker compose up -d
