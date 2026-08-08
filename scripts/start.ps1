$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Api = Join-Path $Root "api"
$Web = Join-Path $Root "web"
$Logs = Join-Path $Root "logs"
$VenvPython = Join-Path $Api ".venv\Scripts\python.exe"
$ViteCommand = Join-Path $Web "node_modules\.bin\vite.cmd"
$SetupScript = Join-Path $PSScriptRoot "setup.ps1"

New-Item -ItemType Directory -Force -Path $Logs | Out-Null

function Test-Port($Port) {
  return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Wait-HttpService {
  param(
    [string]$Name,
    [string]$Uri,
    [int]$TimeoutSeconds = 60
  )

  $Deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $Deadline) {
    try {
      $Response = Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec 2
      if ($Response.StatusCode -ge 200 -and $Response.StatusCode -lt 400) {
        Write-Host "$Name pronto: $Uri" -ForegroundColor Green
        return
      }
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }

  throw "$Name nao respondeu em $Uri dentro de $TimeoutSeconds segundos. Consulte a pasta logs."
}

function Test-BackendReady {
  if (!(Test-Path $VenvPython)) {
    return $false
  }

  & $VenvPython -c "import uvicorn" 2>$null
  return $LASTEXITCODE -eq 0
}

if (!(Test-BackendReady) -or !(Test-Path $ViteCommand) -or !(Test-Path (Join-Path $Root ".env"))) {
  Write-Host "Dependencias ou configuracao ausentes. Executando o setup inicial..." -ForegroundColor Yellow
  & $SetupScript
}

if (!(Test-BackendReady)) {
  throw "O backend nao esta pronto. Execute 'npm run setup' e consulte os erros exibidos."
}

if (!(Test-Path $ViteCommand)) {
  throw "O frontend nao esta pronto. Execute 'npm run setup' e consulte os erros exibidos."
}

$NpmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if ($null -eq $NpmCommand) {
  $NpmCommand = Get-Command npm -ErrorAction Stop
}
$NpmPath = $NpmCommand.Source

if (!(Test-Port 8000)) {
  Start-Process -FilePath $VenvPython `
    -ArgumentList @("-m", "uvicorn", "app.main:application", "--host", "127.0.0.1", "--port", "8000") `
    -WorkingDirectory $Api `
    -RedirectStandardOutput (Join-Path $Logs "api.out.log") `
    -RedirectStandardError (Join-Path $Logs "api.err.log") `
    -WindowStyle Hidden
  Write-Host "API iniciando em http://localhost:8000" -ForegroundColor Yellow
} else {
  Write-Host "API ja esta rodando na porta 8000" -ForegroundColor DarkYellow
}

if (!(Test-Port 5174)) {
  Start-Process -FilePath "cmd.exe" `
    -ArgumentList @("/c", "`"$NpmPath`" run dev") `
    -WorkingDirectory $Web `
    -RedirectStandardOutput (Join-Path $Logs "web.out.log") `
    -RedirectStandardError (Join-Path $Logs "web.err.log") `
    -WindowStyle Hidden
  Write-Host "Web iniciando em http://localhost:5174" -ForegroundColor Yellow
} else {
  Write-Host "Web ja esta rodando na porta 5174" -ForegroundColor DarkYellow
}

try {
  Wait-HttpService -Name "API" -Uri "http://localhost:8000/health/live"
  Wait-HttpService -Name "Web" -Uri "http://localhost:5174/login"
} catch {
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host "Logs: $Logs" -ForegroundColor Yellow
  throw
}

Write-Host "Sistema iniciado. Abra http://localhost:5174/login" -ForegroundColor Green
Write-Host "Swagger: http://localhost:8000/api/docs" -ForegroundColor Green
Write-Host "Para encerrar tudo: npm run stop" -ForegroundColor Cyan
