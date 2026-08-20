#!/usr/bin/env bash
# Instala la app compilada en /Applications de este equipo.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$ROOT/release/mac/GeoPilot.app"
DEST="/Applications/GeoPilot.app"

if [ ! -d "$APP" ]; then
  echo "No hay paquete compilado. Ejecuta primero: npm run dist:mac" >&2
  exit 1
fi

# La app de desarrollo y la instalada comparten identificador y carpeta de
# datos, así que sólo una puede correr a la vez: la segunda no consigue el
# bloqueo de instancia única y se cierra sin mostrar nada.
if pgrep -f "electron-vite dev" >/dev/null 2>&1; then
  echo "AVISO: hay una instancia de desarrollo abierta (npm run dev)." >&2
  echo "       Ciérrala o la app instalada no arrancará." >&2
fi

echo "==> Instalando en $DEST"
rm -rf "$DEST"
cp -R "$APP" /Applications/

echo "==> Comprobando el sidecar incluido"
printf '{"id":1,"method":"ping"}\n' | "$DEST/Contents/Resources/bridge/geopilot-bridge" \
  | grep -q '"pong": true' || { echo "El sidecar del paquete no responde" >&2; exit 1; }

echo "Listo. Ábrela desde Launchpad o con: open -a GeoPilot"
