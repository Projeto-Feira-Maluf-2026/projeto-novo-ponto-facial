# Modo feira: roda o reconhecimento facial no proprio notebook.
#
# - A API facial e o site rodam em localhost: nada de ida e volta ate o
#   servidor na nuvem nem espera de container "frio". So o banco continua
#   no Supabase.
# - Tenta usar a GPU integrada (DirectML). Mede CPU x GPU com rostos reais e
#   fica com o que for mais rapido nesta maquina; se a GPU falhar, segue na CPU.
#
# Uso:  powershell -ExecutionPolicy Bypass -File scripts/feira-local.ps1
#       (acrescente -SemGpu para pular a tentativa de GPU)
param([switch]$SemGpu)

# Continue: no Windows PowerShell 5.1, stderr de programas externos (uv, python)
# vira erro fatal com "Stop". Os codigos de saida sao conferidos um a um.
$ErrorActionPreference = "Continue"

$Root = Split-Path -Parent $PSScriptRoot
$Api = Join-Path $Root "api"
$VenvPython = Join-Path $Api ".venv\Scripts\python.exe"
$BootstrapPython = Join-Path $Root ".cache\setup-python\Scripts\python.exe"

if (!(Test-Path $VenvPython) -or !(Test-Path $BootstrapPython) -or !(Test-Path (Join-Path $Root ".env"))) {
  Write-Host "Primeira vez nesta maquina: instalando dependencias..." -ForegroundColor Yellow
  & (Join-Path $PSScriptRoot "setup.ps1")
}

function Install-CpuRuntime {
  Push-Location $Api
  try {
    & $BootstrapPython -m uv pip uninstall --python $VenvPython onnxruntime-directml 2>$null | Out-Null
    & $BootstrapPython -m uv sync --locked --extra dev --extra ai --python 3.12
    if ($LASTEXITCODE -ne 0) { throw "Nao foi possivel restaurar o onnxruntime de CPU." }
  } finally { Pop-Location }
}

$Providers = "CPUExecutionProvider"
if (!$SemGpu) {
  Write-Host "Preparando a GPU integrada (DirectML)..." -ForegroundColor Yellow
  # onnxruntime e onnxruntime-directml ocupam o mesmo modulo: troca um pelo outro.
  & $BootstrapPython -m uv pip uninstall --python $VenvPython onnxruntime 2>$null | Out-Null
  & $BootstrapPython -m uv pip install --python $VenvPython onnxruntime-directml
  if ($LASTEXITCODE -ne 0) {
    Write-Host "DirectML nao instalou; seguindo na CPU." -ForegroundColor DarkYellow
    Install-CpuRuntime
  }

  Write-Host "Medindo CPU x GPU com rostos de exemplo (leva ~1 minuto)..." -ForegroundColor Yellow
  $Benchmark = & $VenvPython (Join-Path $PSScriptRoot "benchmark_face_runtime.py") 2>$null
  $Benchmark | Where-Object { $_ -notmatch "^MELHOR=" } | ForEach-Object { Write-Host "  $_" }
  $Best = $Benchmark | Where-Object { $_ -match "^MELHOR=" } | Select-Object -Last 1
  if ($Best) { $Providers = $Best.Substring(7) }
  if ($Providers -notmatch "Dml") {
    Write-Host "A CPU foi mais rapida (ou a GPU falhou): usando CPU." -ForegroundColor DarkYellow
    Install-CpuRuntime
    $Providers = "CPUExecutionProvider"
  }
}
Write-Host "Reconhecimento vai usar: $Providers" -ForegroundColor Green

& (Join-Path $PSScriptRoot "stop.ps1")

# Variaveis do processo valem mais que o .env, para a API e para o Vite.
$env:FACE_EXECUTION_PROVIDERS = $Providers
$env:FACE_RUNTIME_MODE = "full"
$env:FACE_EAGER_INITIALIZE = "true"
$env:VITE_FACE_API_URL = "/api/v1"

& (Join-Path $PSScriptRoot "start.ps1")

Write-Host ""
Write-Host "Terminal da feira: http://localhost:5174/terminal-facial" -ForegroundColor Green
Write-Host "Para voltar ao normal: npm run stop (e npm run setup restaura o onnxruntime de CPU)." -ForegroundColor Cyan
