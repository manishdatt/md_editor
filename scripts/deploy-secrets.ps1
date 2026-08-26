# Deploy all environment keys to Cloudflare Pages as encrypted secrets in one go.
#
# Prerequisites:
#   1. Fill in your real values in a local ".env" file at the project root
#      (copy .env.example -> .env and edit). .env is gitignored and never committed.
#   2. Authenticate once:  npx wrangler login
#
# Usage:
#   pwsh scripts/deploy-secrets.ps1                 # deploy from .env to project "md-editor"
#   pwsh scripts/deploy-secrets.ps1 -Project my-app # deploy to a different Pages project
#   pwsh scripts/deploy-secrets.ps1 -EnvFile .env.production
#
# Notes:
#   - Keys listed here are pushed as SECRETS (encrypted). Cloudflare reads them as process.env.*,
#     which is exactly how the Nuxt/Nitro server code consumes them.
#   - NUXT_PUBLIC_SITE_URL is intentionally NOT here: it is public and already set as a
#     plaintext [vars] entry in wrangler.toml.
#   - For production, make sure BETTER_AUTH_URL in your .env points at your real domain
#     (e.g. https://shbd.bioinfo.guru), not localhost.
#   - Keys left blank in .env are skipped with a warning.

param(
  [string]$Project = "md-editor",
  [string]$EnvFile = ".env"
)

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$envPath = Join-Path $root $EnvFile

if (-not (Test-Path $envPath)) {
  Write-Error ".env file not found at $envPath. Copy .env.example to .env and fill in your values first."
  exit 1
}

# Keys to push as secrets (keep in sync with .env.example)
$secretKeys = @(
  "NUXT_AI_PROVIDER",
  "NUXT_GEMINI_API_KEY",
  "NUXT_GEMINI_MODEL",
  "NUXT_NVIDIA_API_KEY",
  "TURSO_URL",
  "TURSO_AUTH_TOKEN",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "NUXT_PDF_SERVICE_KEY"
)

# Parse .env (KEY=VALUE, ignore comments/blank lines, strip surrounding quotes)
$values = @{}
Get-Content $envPath | ForEach-Object {
  $line = $_.Trim()
  if ($line -eq "" -or $line.StartsWith("#")) { return }
  if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') {
    $k = $Matches[1]
    $v = $Matches[2].Trim().Trim('"').Trim("'")
    $values[$k] = $v
  }
}

$missing = 0
foreach ($key in $secretKeys) {
  if (-not $values.ContainsKey($key) -or [string]::IsNullOrWhiteSpace($values[$key])) {
    Write-Warning "Skipping $key (not set in $EnvFile)"
    $missing++
    continue
  }
  Write-Host "Deploying $key -> $Project ..." -ForegroundColor Cyan
  # Pass the value via stdin so it is never echoed to the shell or process list.
  $values[$key] | npx wrangler pages secret put $key --project-name $Project
  if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to deploy $key (wrangler exit code $LASTEXITCODE)"
    exit $LASTEXITCODE
  }
}

Write-Host ""
if ($missing -gt 0) {
  Write-Host "Done. $missing key(s) skipped because they were blank in $EnvFile." -ForegroundColor Yellow
} else {
  Write-Host "All secrets deployed to $Project." -ForegroundColor Green
}
