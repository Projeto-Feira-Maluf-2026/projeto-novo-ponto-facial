$ErrorActionPreference = "Stop"

$keys = @(
    "DATABASE_URL", "PASSWORD_PEPPER", "FIELD_ENCRYPTION_KEY",
    "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "REDIS_URL",
    "ENVIRONMENT", "REDIS_REQUIRED", "CORS_ORIGINS", "CORS_ORIGIN_REGEX",
    "FACE_RUNTIME_MODE", "FACE_PROVIDER", "FACE_MODEL_NAME", "FACE_MODEL_ROOT",
    "FACE_MODEL_SHA256", "FACE_EXECUTION_PROVIDERS", "FACE_EAGER_INITIALIZE",
    "FACE_THRESHOLDS_CALIBRATED", "FACE_THRESHOLD_PROFILE"
)

$arguments = @(
    "--yes", "vercel@latest", "sandbox", "run",
    "--project", "curitiba-gestao-face",
    "--image", "face-api:e88ccff21924",
    "--vcpus", "2",
    "--timeout", "5m",
    "--network-policy", "allow-all",
    "--rm",
    "--env", "VERCEL=1"
)

foreach ($key in $keys) {
    $value = [Environment]::GetEnvironmentVariable($key)
    if (-not [string]::IsNullOrWhiteSpace($value)) {
        $arguments += @("--env", "$key=$value")
    }
}

$program = "from app.application import create_application; service=create_application(); print('application_ok', len(service.routes))"
$arguments += @("--", "python", "-c", $program)

& npx.cmd @arguments
if ($LASTEXITCODE -ne 0) {
    throw "Diagnostico no Vercel Sandbox falhou"
}
