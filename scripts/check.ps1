$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$previousPythonPath = $env:PYTHONPATH
$checkPython = if ($env:CHECK_PYTHON) {
    $env:CHECK_PYTHON
} else {
    Join-Path $projectRoot "api\.venv\Scripts\python.exe"
}

if (-not (Test-Path -LiteralPath $checkPython)) {
    throw "Python do projeto ausente. Execute o setup ou defina CHECK_PYTHON para Python 3.12."
}
$pythonVersion = & $checkPython -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
if ($LASTEXITCODE -ne 0 -or $pythonVersion -ne "3.12") {
    throw "O projeto requer Python 3.12; encontrado $pythonVersion. Defina CHECK_PYTHON ou recrie o ambiente."
}

try {
    $env:PYTHONPATH = Join-Path $projectRoot "api"

    Write-Host "[1/4] Lint do backend"
    & $checkPython -m ruff check (Join-Path $projectRoot "api\app") (Join-Path $projectRoot "tests")
    if ($LASTEXITCODE -ne 0) { throw "Lint do backend falhou ($LASTEXITCODE)." }

    Write-Host "[2/4] Testes do backend"
    & $checkPython -m pytest -q (Join-Path $projectRoot "tests")
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
