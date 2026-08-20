#!/usr/bin/env bash
# Crea el entorno virtual del sidecar USB (macOS / Linux).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NATIVE="$ROOT/native"
VENV="$NATIVE/.venv"

echo "==> Buscando un intérprete de Python 3.10+"
PY=""
for candidate in python3.13 python3.12 python3.11 python3.10 python3; do
  if command -v "$candidate" >/dev/null 2>&1; then
    version="$("$candidate" -c 'import sys; print("%d%02d" % sys.version_info[:2])')"
    if [ "$version" -ge 310 ]; then
      PY="$candidate"
      break
    fi
  fi
done

if [ -z "$PY" ]; then
  cat <<'MSG' >&2
No se encontró Python 3.10 o superior.

  macOS:  brew install python@3.12
  Debian: sudo apt install python3.12 python3.12-venv

MSG
  exit 1
fi

echo "==> Usando $($PY -V) ($(command -v "$PY"))"

if [ ! -d "$VENV" ]; then
  "$PY" -m venv "$VENV"
fi

"$VENV/bin/python" -m pip install --upgrade pip wheel >/dev/null
"$VENV/bin/python" -m pip install "pymobiledevice3>=4.14.0,<5"

echo "==> Comprobando la instalación"
"$VENV/bin/python" - <<'PYCODE'
import importlib.metadata as md
print("pymobiledevice3", md.version("pymobiledevice3"))
from pymobiledevice3 import usbmux
try:
    devices = usbmux.list_devices()
    print(f"usbmuxd accesible. Dispositivos detectados: {len(devices)}")
    for device in devices:
        print(f"  - {device.serial} ({device.connection_type})")
except Exception as exc:
    print(f"AVISO: no se pudo hablar con usbmuxd: {exc}")
    print("En macOS lo proporciona el sistema; en Linux instala y arranca 'usbmuxd'.")
PYCODE

echo
echo "Listo. Arranca la aplicación con:  npm run dev"
