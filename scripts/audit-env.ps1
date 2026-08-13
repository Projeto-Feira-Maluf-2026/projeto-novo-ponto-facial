param(
    [string]$LocalPath = ".env",
    [string]$VercelEnvironment = "production"
)

$ErrorActionPreference = "Stop"
$auditPath = Join-Path (Get-Location) ".vercel\env.$VercelEnvironment.audit"

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

function Get-ValueHash([string]$Value) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($Value)
        return [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace("-", "")
    }
    finally {
        $sha.Dispose()
    }
}

try {
    npx.cmd --yes vercel@latest env pull $auditPath --environment=$VercelEnvironment --yes --no-color | Out-Host

    $local = Read-DotEnv (Join-Path (Get-Location) $LocalPath)
    $remote = Read-DotEnv $auditPath
    $configKeys = @(
        "VITE_API_URL", "VITE_FACE_API_URL", "VITE_ENABLE_MOCKS", "ENVIRONMENT",
        "FACE_RUNTIME_MODE", "FACE_PROVIDER", "FACE_MODEL_NAME", "FACE_MODEL_ROOT",
        "FACE_EAGER_INITIALIZE", "FACE_THRESHOLDS_CALIBRATED", "REDIS_REQUIRED",
        "CORS_ORIGINS", "CORS_ORIGIN_REGEX"
    )
    $secretKeys = @(
        "DATABASE_URL", "PASSWORD_PEPPER", "FIELD_ENCRYPTION_KEY",
        "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_URL",
        "VITE_SUPABASE_PUBLISHABLE_KEY", "BLOB_READ_WRITE_TOKEN"
    )

    Write-Output "CONFIG_OPERACIONAL"
    $configRows = foreach ($key in $configKeys) {
        $localValue = if ($local.ContainsKey($key)) { $local[$key] } else { "<ausente>" }
        $remoteValue = if ($remote.ContainsKey($key)) { $remote[$key] } else { "<ausente>" }
        [PSCustomObject]@{ Key = $key; Local = $localValue; Vercel = $remoteValue }
    }
    $configRows | Format-Table -AutoSize | Out-String -Width 300 | Write-Output

    Write-Output "SEGREDOS_E_CONEXOES"
    $secretRows = foreach ($key in $secretKeys) {
        $hasLocal = $local.ContainsKey($key) -and -not [string]::IsNullOrWhiteSpace($local[$key])
        $remoteIsReadable = $remote.ContainsKey($key) -and $remote[$key] -ne "[SENSITIVE]"
        $hasRemote = $remote.ContainsKey($key) -and -not [string]::IsNullOrWhiteSpace($remote[$key])
        $same = $hasLocal -and $remoteIsReadable -and (
            (Get-ValueHash $local[$key]) -eq (Get-ValueHash $remote[$key])
        )
        [PSCustomObject]@{
            Key = $key
            LocalPresent = $hasLocal
            VercelPresent = $hasRemote
            SameValue = if ($remoteIsReadable) { $same } else { "protegido" }
        }
    }
    $secretRows | Format-Table -AutoSize | Out-String -Width 240 | Write-Output

    Write-Output "CHAVES_LOCAIS_NAO_PUBLICADAS"
    ($local.Keys | Where-Object { -not $remote.ContainsKey($_) } | Sort-Object) -join ", "
    Write-Output "CHAVES_PUBLICADAS_NAO_LOCAIS"
    ($remote.Keys | Where-Object { -not $local.ContainsKey($_) } | Sort-Object) -join ", "
}
finally {
    if (Test-Path -LiteralPath $auditPath) {
        Remove-Item -LiteralPath $auditPath -Force
    }
}
