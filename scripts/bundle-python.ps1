# Congela el sidecar con PyInstaller para distribuirlo sin exigir Python al
# usuario final (Windows). Genera native/dist/geopilot-bridge/geopilot-bridge.exe.
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$native = Join-Path $root 'native'
$venv = Join-Path $native '.venv'
$venvPython = Join-Path $venv 'Scripts\python.exe'

if (-not (Test-Path $venvPython)) {
  Write-Error "Falta el entorno virtual. Ejecuta primero: npm run python:setup:win"
}

& $venvPython -m pip install --upgrade pyinstaller | Out-Null

Push-Location $native
try {
  # pymobiledevice3 carga recursos por ruta (plists de irecv, DDIs, certificados)
  # y resuelve varios servicios de forma dinámica, así que hay que declararlos
  # explícitamente o el binario congelado falla en tiempo de ejecución.
  & $venvPython -m PyInstaller `
    --name geopilot-bridge `
    --onedir `
    --noconfirm `
    --clean `
    --console `
    --collect-data pymobiledevice3 `
    --collect-submodules pymobiledevice3 `
    --recursive-copy-metadata pymobiledevice3 `
    --hidden-import pymobiledevice3.services.simulate_location `
    --hidden-import pymobiledevice3.services.dvt.instruments.location_simulation `
    --hidden-import pymobiledevice3.services.mobile_image_mounter `
    --hidden-import pymobiledevice3.services.amfi `
    --hidden-import pymobiledevice3.remote.remote_service_discovery `
    --hidden-import pymobiledevice3.tunneld.server `
    --hidden-import daemonize `
    --paths . `
    bridge_main.py
} finally {
  Pop-Location
}

# PyInstaller en modo --onedir deja el ejecutable y su _internal\ dentro de
# native\dist\geopilot-bridge\. electron-builder copia ese directorio tal cual
# a resources\bridge\, que es donde lo busca pythonResolver.
$bundle = Join-Path $native 'dist\geopilot-bridge'
$exe = Join-Path $bundle 'geopilot-bridge.exe'
if (-not (Test-Path $exe)) {
  Write-Error "El binario no se generó en $bundle"
}

# `ping` no basta: responde aunque falten metadatos de distribución o módulos
# que sólo se cargan bajo demanda. Se ejercita la ruta pesada de verdad
# (lockdown + enumeración), que es donde PyInstaller suele quedarse corto.
Write-Host 'Verificando el binario congelado...'
$input = "{`"id`":1,`"method`":`"ping`"}`n{`"id`":2,`"method`":`"devices.list`"}`n"
$out = $input | & $exe 2>&1 | Out-String

if ($out -notmatch '"pong":\s*true') {
  Write-Host $out
  Write-Error 'El sidecar congelado no responde al protocolo.'
}

if ($out -match '"ok":\s*false') {
  Write-Host $out
  Write-Error 'El sidecar congelado falla al enumerar dispositivos.'
}

$size = (Get-ChildItem $bundle -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB
Write-Host ("Sidecar congelado y verificado en {0} ({1:N1} MB)" -f $bundle, $size)
