#!/usr/bin/env bash
# Firma ad-hoc del paquete de macOS.
#
# Sin cuenta de desarrollador de Apple no se puede firmar con certificado ni
# notarizar. Un paquete *sin firma alguna* no es lo mismo que uno con firma
# ad-hoc: el framework de Electron viene firmado por Apple, así que dejar el
# resto sin firmar produce un bundle incoherente que el cargador rechaza sin
# mensaje. La firma ad-hoc (`--sign -`) le da una identidad válida aunque no
# certificada, y macOS lo ejecuta en local.
#
# No desactiva ninguna protección: la app sigue sin estar notarizada y
# Gatekeeper la bloqueará si se descarga de internet.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="${1:-$ROOT/release/mac/GeoPilot.app}"

if [ ! -d "$APP" ]; then
  echo "No existe el paquete: $APP" >&2
  exit 1
fi

echo "==> Firmando ad-hoc $APP"
codesign --force --deep --sign - "$APP"

echo "==> Verificando"
codesign -dv "$APP" 2>&1 | grep -E "Identifier|Signature"

if codesign --verify --deep "$APP" 2>&1; then
  echo "Firma correcta."
else
  echo "La verificación de firma falló." >&2
  exit 1
fi
