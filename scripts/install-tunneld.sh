#!/usr/bin/env bash
# Instala (o desinstala) el túnel de iOS 17+ como servicio del sistema, para
# que se levante solo al arrancar el Mac y no haya que lanzarlo a mano.
#
#   sudo bash scripts/install-tunneld.sh
#   sudo bash scripts/install-tunneld.sh --uninstall
#
# Requiere root: crear la interfaz de red virtual sobre USB no es posible sin
# privilegios. El servicio sólo escucha en 127.0.0.1.
set -euo pipefail

LABEL="com.geopilot.tunneld"
PLIST="/Library/LaunchDaemons/$LABEL.plist"
BRIDGE="/Applications/GeoPilot.app/Contents/Resources/bridge/geopilot-bridge"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ "$(id -u)" -ne 0 ]; then
  echo "Hay que ejecutarlo con sudo:" >&2
  echo "  sudo bash $0 ${1:-}" >&2
  exit 1
fi

uninstall() {
  echo "==> Deteniendo y quitando $LABEL"
  launchctl bootout system "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Servicio eliminado. El túnel ya no se levantará solo."
}

if [ "${1:-}" = "--uninstall" ]; then
  uninstall
  exit 0
fi

if [ ! -x "$BRIDGE" ]; then
  echo "No encuentro el sidecar en:" >&2
  echo "  $BRIDGE" >&2
  echo "Instala primero la app: npm run dist:mac && npm run install:mac" >&2
  exit 1
fi

echo "==> Comprobando que el binario soporta el modo túnel"
"$BRIDGE" --tunneld --help >/dev/null 2>&1 || true

# Si ya estaba cargado, se descarga antes para poder reinstalar limpiamente.
launchctl bootout system "$PLIST" 2>/dev/null || true

# Un tunneld lanzado a mano deja el puerto 49151 ocupado y el servicio entraría
# en bucle de reinicios. Peor: la comprobación de más abajo la respondería el
# proceso viejo, así que el instalador daría éxito con el servicio caído.
if pgrep -f "remote tunneld" >/dev/null 2>&1 || pgrep -f "geopilot-bridge --tunneld" >/dev/null 2>&1; then
  echo "==> Cerrando un túnel anterior que ocupaba el puerto"
  pkill -f "remote tunneld" 2>/dev/null || true
  pkill -f "geopilot-bridge --tunneld" 2>/dev/null || true
  sleep 2
fi

echo "==> Instalando $PLIST"
install -m 644 -o root -g wheel "$ROOT/build/$LABEL.plist" "$PLIST"

echo "==> Arrancando el servicio"
launchctl bootstrap system "$PLIST"
launchctl enable "system/$LABEL"

echo "==> Esperando a que responda…"
for _ in $(seq 1 25); do
  # Se exige que responda Y que el proceso sea hijo del servicio: si sólo se
  # comprobara el puerto, cualquier tunneld suelto daría un falso positivo.
  if curl -s --max-time 1 http://127.0.0.1:49151/ >/dev/null 2>&1 \
     && launchctl print "system/$LABEL" 2>/dev/null | grep -qE "state = running|pid = [0-9]+"; then
    echo
    echo "Túnel activo y configurado para arrancar solo."
    echo "Registro: /var/log/geopilot-tunneld.log"
    echo "Para quitarlo: sudo bash $0 --uninstall"
    exit 0
  fi
  sleep 1
done

echo >&2
echo "El servicio se instaló pero no llegó a responder." >&2
echo "Diagnóstico:" >&2
launchctl print "system/$LABEL" 2>&1 | grep -E "state|pid|last exit" | head -5 >&2
echo "Registro completo: tail -50 /var/log/geopilot-tunneld.log" >&2
exit 1
