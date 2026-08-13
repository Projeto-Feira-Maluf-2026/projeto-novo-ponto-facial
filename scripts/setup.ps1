$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Api = Join-Path $Root "api"
$Web = Join-Path $Root "web"
$Venv = Join-Path $Api ".venv"
$VenvPython = Join-Path $Venv "Scripts\python.exe"

if (!(Test-Path (Join-Path $Root ".env"))) {
  Copy-Item (Join-Path $Root ".env.example") (Join-Path $Root ".env")
}

Write-Host "Instalando backend..." -ForegroundColor Yellow
if (!(Test-Path $VenvPython)) {
  $PyLauncher = Get-Command py -ErrorAction SilentlyContinue
  if ($null -ne $PyLauncher) {
    & py -3.12 -m venv $Venv
  } else {
    $PythonCommand = Get-Command python -ErrorAction Stop
    $PythonVersion = & $PythonCommand.Source -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
    if ($PythonVersion -ne "3.12") {
      throw "Python 3.12 e obrigatorio. Versao encontrada: $PythonVersion"
    }
    & $PythonCommand.Source -m venv $Venv
  }

  if (!(Test-Path $VenvPython)) {
    throw "Nao foi possivel criar a venv com Python 3.12 em $Venv"
  }
}

Push-Location $Api
& $VenvPython -m pip install -U pip
& $VenvPython -m pip install -e ".[dev,ai]"
Pop-Location

Write-Host "Instalando frontend..." -ForegroundColor Yellow
Push-Location $Web
$NpmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if ($null -eq $NpmCommand) {
  $NpmCommand = Get-Command npm -ErrorAction Stop
}
& $NpmCommand.Source install
Pop-Location

Write-Host "Setup concluido." -ForegroundColor Green
