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
    & py -3.11 -m venv $Venv
    if ($LASTEXITCODE -ne 0) {
      & py -3 -m venv $Venv
    }
  } else {
    & python -m venv $Venv
  }

  if (!(Test-Path $VenvPython)) {
    throw "Nao foi possivel criar a venv em $Venv"
  }
}

Push-Location $Api
& $VenvPython -m pip install -U pip
& $VenvPython -m pip install -e ".[dev]"
& $VenvPython -m app.db.migrate
if ($LASTEXITCODE -ne 0) {
  throw "Falha ao aplicar migrations do backend."
}
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
