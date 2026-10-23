$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Api = Join-Path $Root "api"
$Bootstrap = Join-Path $Root ".cache\setup-python"
$BootstrapPython = Join-Path $Bootstrap "Scripts\python.exe"

if (!(Test-Path (Join-Path $Root ".env"))) {
  Copy-Item (Join-Path $Root ".env.example") (Join-Path $Root ".env")
}

Write-Host "Instalando backend..." -ForegroundColor Yellow
if (!(Test-Path $BootstrapPython)) {
  $PyLauncher = Get-Command py -ErrorAction SilentlyContinue
  if ($null -ne $PyLauncher) {
    & py -3.12 -m venv $Bootstrap
  } else {
    $PythonCommand = Get-Command python -ErrorAction Stop
    $PythonVersion = & $PythonCommand.Source -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
    if ($PythonVersion -ne "3.12") {
      throw "Python 3.12 e obrigatorio. Versao encontrada: $PythonVersion"
    }
    & $PythonCommand.Source -m venv $Bootstrap
  }

  if ($LASTEXITCODE -ne 0 -or !(Test-Path $BootstrapPython)) {
    throw "Nao foi possivel criar o bootstrap isolado Python 3.12 em $Bootstrap"
  }
}

& $BootstrapPython -m pip install --disable-pip-version-check uv==0.10.11
if ($LASTEXITCODE -ne 0) { throw "Instalacao do uv falhou." }
Push-Location $Api
try {
  & $BootstrapPython -m uv sync --locked --extra dev --extra ai --python 3.12
  if ($LASTEXITCODE -ne 0) { throw "Instalacao pelo uv.lock falhou." }
} finally { Pop-Location }

Write-Host "Instalando frontend..." -ForegroundColor Yellow
Push-Location $Root
$NpmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if ($null -eq $NpmCommand) {
  $NpmCommand = Get-Command npm -ErrorAction Stop
}
try {
  & $NpmCommand.Source ci
  if ($LASTEXITCODE -ne 0) { throw "Instalacao pelo package-lock.json falhou." }
} finally { Pop-Location }

Write-Host "Setup concluido." -ForegroundColor Green
