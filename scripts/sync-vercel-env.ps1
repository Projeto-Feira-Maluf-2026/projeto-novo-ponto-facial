param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("web", "face")]
    [string]$Profile,

    [Parameter(Mandatory = $true)]
    [string]$Project,

    [string]$EnvironmentFile = ".env",

    [switch]$ReadableSecrets
)

$ErrorActionPreference = "Stop"

function Read-DotEnv([string]$Path) {
    $map = @{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        if ($line -match "^\s*#" -or $line -notmatch "=") {
            continue
        }

        $parts = $line -split "=", 2
        $key = $parts[0].Trim()
        $value = $parts[1].Trim()
        if (
            ($value.StartsWith('"') -and $value.EndsWith('"')) -or
            ($value.StartsWith("'") -and $value.EndsWith("'"))
        ) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        $map[$key] = $value
    }
    return $map
}

$values = Read-DotEnv (Join-Path (Get-Location) $EnvironmentFile)
$corsOrigins = (
    "http://localhost:5174,http://localhost:8080," +
    "https://curitiba-gestao.vercel.app,https://curitiba-gestao-face.vercel.app"
)
$corsRegex = "^https://curitiba-gestao(?:-face)?(?:-[a-z0-9-]+)*\.vercel\.app$"

$commonSecretKeys = @(
    "DATABASE_URL",
    "PASSWORD_PEPPER",
    "FIELD_ENCRYPTION_KEY",
    "SUPABASE_URL",
    "SUPABASE_PUBLISHABLE_KEY",
    "REDIS_URL"
)

if ($Profile -eq "face") {
    $overrides = @{
        ENVIRONMENT = "development"
        REDIS_REQUIRED = "false"
        CORS_ORIGINS = $corsOrigins
        CORS_ORIGIN_REGEX = $corsRegex
        FACE_RUNTIME_MODE = "full"
        FACE_PROVIDER = "insightface"
        FACE_MODEL_NAME = "buffalo_l"
        FACE_MODEL_ROOT = "/opt/insightface"
        FACE_MODEL_SHA256 = "4c06341c33c2ca1f86781dab0e829f88ad5b64be9fba56e56bc9ebdefc619e43"
        FACE_EXECUTION_PROVIDERS = "CPUExecutionProvider"
        FACE_DETECTION_SIZES = "320,640,1280"
        FACE_EAGER_INITIALIZE = "false"
        FACE_THRESHOLDS_CALIBRATED = "false"
        FACE_THRESHOLD_PROFILE = "development-uncalibrated"
        VERCEL_SUPPORT_LARGE_FUNCTIONS = "1"
    }
    $configKeys = @(
        "ENVIRONMENT", "REDIS_REQUIRED", "CORS_ORIGINS", "CORS_ORIGIN_REGEX",
        "FACE_RUNTIME_MODE", "FACE_PROVIDER", "FACE_MODEL_NAME", "FACE_MODEL_ROOT",
        "FACE_MODEL_SHA256", "FACE_EXECUTION_PROVIDERS", "FACE_EAGER_INITIALIZE",
        "FACE_THRESHOLDS_CALIBRATED", "FACE_THRESHOLD_PROFILE",
        "FACE_DETECTION_SIZES", "FACE_MIN_DETECTION_CONFIDENCE",
        "FACE_SECONDARY_FACE_SCORE_GAP", "FACE_SECONDARY_FACE_CONFIDENCE",
        "FACE_MIN_SIMILARITY", "FACE_STRONG_SIMILARITY", "FACE_MATCH_MARGIN",
        "FACE_ENROLLMENT_MIN_IMAGES", "FACE_ENROLLMENT_MIN_QUALITY",
        "FACE_ENROLLMENT_MIN_FACE_AREA_RATIO", "FACE_ENROLLMENT_TURN_MIN_YAW",
        "FACE_ENROLLMENT_TURN_MAX_YAW", "FACE_ENROLLMENT_LOOK_UP_MIN_PITCH",
        "FACE_ENROLLMENT_LOOK_UP_MAX_PITCH",
        "FACE_TEMPORAL_MIN_FRAMES", "FACE_TEMPORAL_MIN_EMBEDDING_SIMILARITY",
        "FACE_IDENTITY_MAX_TEMPLATES", "FACE_IDENTITY_TOP_K",
        "VERCEL_SUPPORT_LARGE_FUNCTIONS"
    )
    $secretKeys = $commonSecretKeys
}
else {
    $overrides = @{
        ENVIRONMENT = "production"
        REDIS_REQUIRED = "false"
        CORS_ORIGINS = $corsOrigins
        CORS_ORIGIN_REGEX = $corsRegex
        FACE_RUNTIME_MODE = "lightweight"
        FACE_EAGER_INITIALIZE = "false"
        VITE_API_URL = "/api/v1"
        VITE_FACE_API_URL = "https://curitiba-gestao-face.vercel.app/api/v1"
        VITE_ENABLE_MOCKS = "false"
    }
    $configKeys = @(
        "ENVIRONMENT", "REDIS_REQUIRED", "CORS_ORIGINS", "CORS_ORIGIN_REGEX",
        "FACE_RUNTIME_MODE", "FACE_EAGER_INITIALIZE", "VITE_API_URL",
        "VITE_FACE_API_URL", "VITE_ENABLE_MOCKS"
    )
    $secretKeys = $commonSecretKeys + @(
        "VITE_SUPABASE_URL",
        "VITE_SUPABASE_PUBLISHABLE_KEY"
    )
}

foreach ($key in $secretKeys + $configKeys) {
    $value = if ($overrides.ContainsKey($key)) { $overrides[$key] } else { $values[$key] }
    if ([string]::IsNullOrWhiteSpace($value)) {
        throw "Variavel obrigatoria ausente ou vazia: $key"
    }

    $visibility = if (($secretKeys -contains $key) -and -not $ReadableSecrets) {
        "--sensitive"
    }
    else {
        "--no-sensitive"
    }
    $value | & npx.cmd --yes vercel@latest env add $key "production,preview" `
        --project $Project --force --yes $visibility --no-color | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao sincronizar $key no projeto $Project"
    }
    Write-Output "Sincronizado: $key"
}
