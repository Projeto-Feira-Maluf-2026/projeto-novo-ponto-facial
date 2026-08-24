$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$EnvFile = Join-Path $Root ".env"
$Values = @{}

Get-Content $EnvFile | ForEach-Object {
  if ($_ -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
    $Values[$Matches[1]] = $Matches[2]
  }
}

$Required = @(
  "SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "INITIAL_ADMIN_NAME",
  "INITIAL_ADMIN_EMAIL",
  "INITIAL_ADMIN_PASSWORD"
)
foreach ($Name in $Required) {
  if (-not $Values[$Name]) {
    throw "$Name nao configurado em .env"
  }
}

$Headers = @{
  apikey = $Values["SUPABASE_SECRET_KEY"]
  Authorization = "Bearer $($Values['SUPABASE_SECRET_KEY'])"
}
$UserAgent = "ponto-facial-bootstrap/1.0"
$Base = $Values["SUPABASE_URL"].TrimEnd("/")
$Users = Invoke-RestMethod `
  -Uri "$Base/auth/v1/admin/users?page=1&per_page=1000" `
  -Headers $Headers `
  -UserAgent $UserAgent

$Existing = @($Users.users) | Where-Object { $_.email -eq $Values["INITIAL_ADMIN_EMAIL"] } | Select-Object -First 1
if ($Existing) {
  $ExistingMetadata = @{}
  if ($Existing.app_metadata) {
    $Existing.app_metadata.PSObject.Properties | ForEach-Object {
      $ExistingMetadata[$_.Name] = $_.Value
    }
  }
  $ExistingMetadata["role"] = "SUPER_ADMIN"
  $UpdateBody = @{
    app_metadata = $ExistingMetadata
  } | ConvertTo-Json -Depth 4

  Invoke-RestMethod `
    -Uri "$Base/auth/v1/admin/users/$($Existing.id)" `
    -Method Put `
    -Headers $Headers `
    -UserAgent $UserAgent `
    -ContentType "application/json" `
    -Body $UpdateBody | Out-Null

  Write-Host "Administrador existente atualizado com acesso SUPER_ADMIN." -ForegroundColor Green
  exit 0
}

$Body = @{
  email = $Values["INITIAL_ADMIN_EMAIL"]
  password = $Values["INITIAL_ADMIN_PASSWORD"]
  email_confirm = $true
  user_metadata = @{ name = $Values["INITIAL_ADMIN_NAME"] }
  app_metadata = @{ role = "SUPER_ADMIN" }
} | ConvertTo-Json -Depth 4

Invoke-RestMethod `
  -Uri "$Base/auth/v1/admin/users" `
  -Method Post `
  -Headers $Headers `
  -UserAgent $UserAgent `
  -ContentType "application/json" `
  -Body $Body | Out-Null

Write-Host "Administrador criado no Supabase Auth." -ForegroundColor Green
