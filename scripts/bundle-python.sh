#!/usr/bin/env bash
# Congela el sidecar con PyInstaller para distribuirlo sin exigir Python
# al usuario final. Genera native/dist/geopilot-bridge.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NATIVE="$ROOT/native"
VENV="$NATIVE/.venv"

if [ ! -d "$VENV" ]; then
  echo "Falta el entorno virtual. Ejecuta primero: npm run python:setup" >&2
  exit 1
fi

"$VENV/bin/python" -m pip install --upgrade pyinstaller >/dev/null

cd "$NATIVE"

# pymobiledevice3 carga recursos por ruta (plists de irecv, DDIs, certificados)
# y resuelve varios servicios de forma dinámica, así que hay que declararlos
# explícitamente o el binario congelado falla en tiempo de ejecución.
"$VENV/bin/pyinstaller" \
  --name geopilot-bridge \
  --onedir \
  --noconfirm \
  --clean \
  --console \
  --collect-data pymobiledevice3 \
  --collect-submodules pymobiledevice3 \
  --recursive-copy-metadata pymobiledevice3 \
  --hidden-import pymobiledevice3.services.simulate_location \
  --hidden-import pymobiledevice3.services.dvt.instruments.location_simulation \
  --hidden-import pymobiledevice3.services.mobile_image_mounter \
  --hidden-import pymobiledevice3.services.amfi \
  --hidden-import pymobiledevice3.remote.remote_service_discovery \
  --hidden-import pymobiledevice3.tunneld.server \
  --hidden-import daemonize \
  --paths . \
  bridge_main.py

# PyInstaller en modo --onedir deja el ejecutable y su _internal/ dentro de
# native/dist/geopilot-bridge/. electron-builder copia ese directorio tal cual
# a Resources/bridge/, que es donde lo busca pythonResolver.
BUNDLE="$NATIVE/dist/geopilot-bridge"
if [ ! -x "$BUNDLE/geopilot-bridge" ]; then
  echo "El binario no se generó en $BUNDLE" >&2
  exit 1
fi

# `ping` no basta: responde aunque falten metadatos de distribución o módulos
# que sólo se cargan bajo demanda. Se ejercita la ruta pesada de verdad
# (lockdown + enumeración), que es donde PyInstaller suele quedarse corto.
echo "Verificando el binario congelado…"
OUT=$(printf '{"id":1,"method":"ping"}\n{"id":2,"method":"devices.list"}\n' \
  | "$BUNDLE/geopilot-bridge" 2>&1)

echo "$OUT" | grep -q '"pong": true' \
  || { echo "El sidecar congelado no responde al protocolo:" >&2; echo "$OUT" >&2; exit 1; }

if echo "$OUT" | grep -q '"ok": false'; then
  echo "El sidecar congelado falla al enumerar dispositivos:" >&2
  echo "$OUT" | grep '"ok": false' >&2
  exit 1
fi

echo "Sidecar congelado y verificado en $BUNDLE ($(du -sh "$BUNDLE" | cut -f1))"
