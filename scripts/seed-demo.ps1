$ErrorActionPreference = "Stop"

$Base = "http://localhost:8000/api/v1"

Invoke-WebRequest -Uri "$Base/auth/bootstrap-admin" -Method POST -UseBasicParsing | Out-Null

$loginBody = @{
  email = "admin@curitibaempreiteira.com"
  password = "Admin@12345"
  device_label = "seed-demo"
} | ConvertTo-Json

$token = (Invoke-RestMethod -Uri "$Base/auth/login" -Method POST -Body $loginBody -ContentType "application/json").access_token
$headers = @{ Authorization = "Bearer $token" }

$worksiteBody = @{
  name = "Obra Demo Portaria"
  code = "DEMO"
  address = "Rua Demo, Curitiba"
  manager_name = "Gestor Demo"
  latitude = -25.443
  longitude = -49.287
  geofence_radius_meters = 5000
  active = $true
} | ConvertTo-Json

try {
  $worksite = Invoke-RestMethod -Uri "$Base/worksites" -Method POST -Body $worksiteBody -ContentType "application/json" -Headers $headers
} catch {
  $worksite = (Invoke-RestMethod -Uri "$Base/worksites?size=200" -Headers $headers).items | Where-Object { $_.code -eq "DEMO" } | Select-Object -First 1
}

$employeeBody = @{
  registration = "CE-DEMO-001"
  name = "Funcionario Demo"
  email = "funcionario.demo@curitibaempreiteira.com"
  document = "00000000000"
  phone = "(41) 99999-0000"
  worksite_ids = @($worksite.id)
  status = "ACTIVE"
} | ConvertTo-Json

try {
  Invoke-RestMethod -Uri "$Base/employees" -Method POST -Body $employeeBody -ContentType "application/json" -Headers $headers | Out-Null
} catch {}

$cameraBody = @{
  worksite_id = $worksite.id
  name = "Webcam Demo"
  serial_number = "WEBCAM-DEMO-001"
  api_key = "camera-local-dev-key"
  status = "ACTIVE"
  camera = @{
    camera_type = "WEBCAM"
    protocol = "LOCAL"
    ip_address = $null
    port = $null
    username = $null
    password = $null
    rtsp_url = $null
    location_label = "Computador local"
    recognition_enabled = $true
    developer_debug = $false
  }
} | ConvertTo-Json -Depth 4

try {
  Invoke-RestMethod -Uri "$Base/devices" -Method POST -Body $cameraBody -ContentType "application/json" -Headers $headers | Out-Null
} catch {}

Write-Host "Dados demo populados." -ForegroundColor Green
