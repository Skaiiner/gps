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


def run_tunneld() -> int:
    """Modo demonio: sirve el túnel RemoteXPC que iOS 17+ necesita.

    Se expone desde el mismo binario congelado para que el servicio del sistema
    pueda apuntar al paquete de la app en /Applications y siga funcionando
    aunque se borre la carpeta del proyecto. Requiere privilegios de root:
    crear la interfaz de red virtual no se puede hacer de otro modo.

    Es bloqueante a propósito; launchd es quien gestiona el ciclo de vida, así
    que no hay que demonizar por nuestra cuenta.
    """
    from pymobiledevice3.tunneld.server import TunneldRunner

    host, port = "127.0.0.1", 49151
    argv = sys.argv[1:]
    if "--host" in argv:
        host = argv[argv.index("--host") + 1]
    if "--port" in argv:
        port = int(argv[argv.index("--port") + 1])

    print(f"[tunneld] escuchando en {host}:{port}", file=sys.stderr, flush=True)
    TunneldRunner.create(host, port)
    return 0


def main() -> int:
    if "--tunneld" in sys.argv[1:]:
        return run_tunneld()

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
