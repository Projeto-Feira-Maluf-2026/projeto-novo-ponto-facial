$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$previousPythonPath = $env:PYTHONPATH

try {
    $env:PYTHONPATH = Join-Path $projectRoot "api"

    Write-Host "[1/3] Testes do backend"
    python -m pytest -q (Join-Path $projectRoot "tests")

    Write-Host "[2/3] Testes do frontend"
    npm --prefix (Join-Path $projectRoot "web") test -- --run

    Write-Host "[3/3] Tipos e build de produção"
    npm --prefix (Join-Path $projectRoot "web") run build

    Write-Host "Verificação concluída com sucesso."
}
finally {
    $env:PYTHONPATH = $previousPythonPath
}
