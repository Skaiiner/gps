"""Punto de entrada para el binario congelado con PyInstaller.

No se puede usar `ubiq_bridge/__main__.py` directamente: PyInstaller lo ejecuta
como script de nivel superior, sin paquete padre, y sus imports relativos
(`from .server import ...`) fallan con "attempted relative import with no known
parent package". Este arranque usa imports absolutos, que sí funcionan tanto
congelado como desde el código fuente.

En desarrollo se sigue usando `python -m ubiq_bridge`.
"""

from __future__ import annotations

import json
import sys


def main() -> int:
    # Sin buffering: si stdout se bufferiza, las coordenadas llegan a tirones.
    try:
        sys.stdout.reconfigure(line_buffering=True, encoding="utf-8")
        sys.stdin.reconfigure(encoding="utf-8")
    except AttributeError:  # pragma: no cover
        pass

    try:
        import pymobiledevice3  # noqa: F401
    except ImportError as exc:
        print(
            json.dumps(
                {
                    "event": "bridge.error",
                    "data": {
                        "code": "PYMOBILEDEVICE3_MISSING",
                        "message": "Falta pymobiledevice3 en el paquete del sidecar.",
                        "detail": f"{sys.executable}: {exc}",
                    },
                }
            ),
            flush=True,
        )
        return 2

    from ubiq_bridge.server import BridgeServer

    server = BridgeServer()
    try:
        server.run()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
