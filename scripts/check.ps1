$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$previousPythonPath = $env:PYTHONPATH

try {
    $env:PYTHONPATH = Join-Path $projectRoot "api"

    Write-Host "[1/4] Lint do backend"
    python -m ruff check (Join-Path $projectRoot "api\app") (Join-Path $projectRoot "tests")
    if ($LASTEXITCODE -ne 0) { throw "Lint do backend falhou ($LASTEXITCODE)." }

    Write-Host "[2/4] Testes do backend"
    python -m pytest -q (Join-Path $projectRoot "tests")
    if ($LASTEXITCODE -ne 0) { throw "Testes do backend falharam ($LASTEXITCODE)." }

    Write-Host "[3/4] Testes do frontend"
    npm --prefix (Join-Path $projectRoot "web") test -- --run
    if ($LASTEXITCODE -ne 0) { throw "Testes do frontend falharam ($LASTEXITCODE)." }

    Write-Host "[4/4] Tipos e build de produção"
    npm --prefix (Join-Path $projectRoot "web") run build
    if ($LASTEXITCODE -ne 0) { throw "Build do frontend falhou ($LASTEXITCODE)." }

    Write-Host "Verificação concluída com sucesso."
}
finally {
    $env:PYTHONPATH = $previousPythonPath
}
