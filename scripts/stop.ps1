$ErrorActionPreference = "SilentlyContinue"

foreach ($Port in @(8000, 5174)) {
  $connections = Get-NetTCPConnection -LocalPort $Port -State Listen
  foreach ($connection in $connections) {
    Stop-Process -Id $connection.OwningProcess -Force
    Write-Host "Processo da porta $Port encerrado." -ForegroundColor Yellow
  }
}

Write-Host "Servicos parados." -ForegroundColor Green
