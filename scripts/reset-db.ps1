$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Db = Join-Path $Root "api\ponto_facial.db"

& (Join-Path $PSScriptRoot "stop.ps1")

if (Test-Path $Db) {
  Remove-Item -LiteralPath $Db -Force
  Write-Host "Banco local removido." -ForegroundColor Yellow
}

& (Join-Path $PSScriptRoot "start.ps1")

Write-Host "Banco resetado e servicos reiniciados." -ForegroundColor Green
