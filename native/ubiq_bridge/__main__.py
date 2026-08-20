"""Punto de entrada del sidecar.

    python -m ubiq_bridge

stdin/stdout hablan JSON-RPC; stderr queda para diagnóstico legible.
"""

from __future__ import annotations

import json
import sys


def main() -> int:
    # Sin buffering: si stdout se bufferiza, las coordenadas llegan a tirones.
    try:
        sys.stdout.reconfigure(line_buffering=True, encoding="utf-8")
        sys.stdin.reconfigure(encoding="utf-8")
    except AttributeError:  # pragma: no cover - Python < 3.7
        pass

    try:
        import pymobiledevice3  # noqa: F401
    except ImportError as exc:
        # Se responde en el propio protocolo para que la UI muestre la ayuda
        # de instalación en vez de un fallo opaco del proceso.
        print(
            json.dumps(
                {
                    "event": "bridge.error",
                    "data": {
                        "code": "PYMOBILEDEVICE3_MISSING",
                        "message": "Falta pymobiledevice3 en el intérprete de Python.",
                        "detail": f"{sys.executable}: {exc}",
                    },
                }
            ),
            flush=True,
        )
        return 2

    from .server import BridgeServer

    server = BridgeServer()
    try:
        server.run()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
