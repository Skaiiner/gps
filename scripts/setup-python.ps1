# Crea el entorno virtual del sidecar USB (Windows).
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$native = Join-Path $root 'native'
$venv = Join-Path $native '.venv'

Write-Host '==> Buscando un intérprete de Python 3.10+'

$python = $null
foreach ($candidate in @('py -3.12', 'py -3.11', 'py -3', 'python')) {
  $parts = $candidate.Split(' ')
  $exe = $parts[0]
  if (Get-Command $exe -ErrorAction SilentlyContinue) {
    try {
      $args = @()
      if ($parts.Length -gt 1) { $args += $parts[1] }
      $args += @('-c', 'import sys; print("%d%02d" % sys.version_info[:2])')
      $version = & $exe @args 2>$null
      if ([int]$version -ge 310) { $python = $candidate; break }
    } catch { }
  }
}

if (-not $python) {
  Write-Error @'
No se encontró Python 3.10 o superior.
Descárgalo de https://www.python.org/downloads/windows/ y marca
"Add python.exe to PATH" durante la instalación.
'@
}

Write-Host "==> Usando $python"

if (-not (Test-Path $venv)) {
  $parts = $python.Split(' ')
  & $parts[0] @($parts[1..($parts.Length - 1)] + @('-m', 'venv', $venv))
}

$venvPython = Join-Path $venv 'Scripts\python.exe'
& $venvPython -m pip install --upgrade pip wheel | Out-Null
& $venvPython -m pip install 'pymobiledevice3>=4.14.0,<5'

Write-Host '==> Comprobando la instalación'
& $venvPython -c @'
import importlib.metadata as md
print("pymobiledevice3", md.version("pymobiledevice3"))
from pymobiledevice3 import usbmux
try:
    devices = usbmux.list_devices()
    print(f"usbmuxd accesible. Dispositivos detectados: {len(devices)}")
except Exception as exc:
    print(f"AVISO: no se pudo hablar con usbmuxd: {exc}")
    print("Instala 'Apple Devices' desde Microsoft Store (o iTunes) y reinicia.")
'@

Write-Host ''
Write-Host 'Listo. Arranca la aplicación con:  npm run dev'
