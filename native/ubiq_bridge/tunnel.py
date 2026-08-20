"""Túnel RemoteXPC / RSD para iOS 17 y superiores.

A partir de iOS 17 Apple movió los servicios de desarrollo (entre ellos
`com.apple.instruments.dtservicehub`, que expone LocationSimulation) detrás de
RemoteServiceDiscovery: ya no se alcanzan por lockdownd, sino por una interfaz
de red virtual IPv6 sobre el propio cable USB.

Crear esa interfaz requiere privilegios de administrador, así que se delega en
el demonio `tunneld` de pymobiledevice3, que se lanza elevado una sola vez y
publica un API HTTP local con los túneles activos. El sidecar corre sin
privilegios y sólo consulta ese API.
"""

from __future__ import annotations

import json
import os
import platform
import shlex
import subprocess
import sys
import time
import urllib.error
import urllib.request
from typing import Any

from .errors import BridgeError

TUNNELD_HOST = "127.0.0.1"
TUNNELD_PORT = 49151
TUNNELD_URL = f"http://{TUNNELD_HOST}:{TUNNELD_PORT}"

RSD_MIN_MAJOR = 17

def _rsd_class() -> Any:
    """RSD sólo hace falta en iOS 17+, y arrastra la pila QUIC. Diferido."""
    from pymobiledevice3.remote.remote_service_discovery import RemoteServiceDiscoveryService

    return RemoteServiceDiscoveryService


def is_required(major_version: int) -> bool:
    return major_version >= RSD_MIN_MAJOR


def is_running(timeout: float = 0.8) -> bool:
    try:
        with urllib.request.urlopen(TUNNELD_URL, timeout=timeout):
            return True
    except urllib.error.HTTPError:
        # Responde aunque sea con 4xx => el demonio está vivo.
        return True
    except Exception:  # noqa: BLE001
        return False


def list_tunnels(timeout: float = 2.0) -> dict[str, list[dict]]:
    """{udid: [{'tunnel-address': 'fd..', 'tunnel-port': 1234}, ...]}"""
    try:
        with urllib.request.urlopen(TUNNELD_URL, timeout=timeout) as response:
            payload = json.loads(response.read().decode())
    except Exception as exc:  # noqa: BLE001
        raise BridgeError(
            "TUNNEL_REQUIRED",
            "El túnel para iOS 17+ no está activo.",
            detail=str(exc),
        ) from exc

    if not isinstance(payload, dict):
        return {}

    normalized: dict[str, list[dict]] = {}
    for udid, entries in payload.items():
        if isinstance(entries, dict):
            entries = [entries]
        normalized[udid] = [e for e in entries if isinstance(e, dict)]
    return normalized


def get_rsd(udid: str, timeout: float = 20.0) -> Any:
    """Devuelve un RemoteServiceDiscoveryService conectado para el UDID.

    El llamante es responsable de cerrarlo.
    """
    try:
        rsd_class = _rsd_class()
    except ImportError as exc:
        raise BridgeError(
            "PYMOBILEDEVICE3_MISSING",
            "Esta versión de pymobiledevice3 no soporta RSD (necesario para iOS 17+).",
            detail=str(exc),
        ) from exc

    deadline = time.monotonic() + timeout
    last_detail: str | None = None

    while time.monotonic() < deadline:
        tunnels = list_tunnels()
        entries = tunnels.get(udid) or []
        for entry in entries:
            host = entry.get("tunnel-address") or entry.get("address")
            port = entry.get("tunnel-port") or entry.get("port")
            if not host or not port:
                continue
            try:
                rsd = rsd_class((host, int(port)))
                _connect(rsd)
                return rsd
            except Exception as exc:  # noqa: BLE001
                last_detail = f"{host}:{port} -> {exc}"
                continue
        time.sleep(1.0)

    raise BridgeError(
        "TUNNEL_REQUIRED",
        "No hay túnel activo para este dispositivo. Inicia el túnel (requiere permisos de "
        "administrador) y mantén el iPhone desbloqueado.",
        detail=last_detail,
    )


def _connect(rsd: Any) -> None:
    """`connect()` es corrutina en pymobiledevice3 4.x y síncrona en 3.x."""
    import asyncio
    import inspect

    result = rsd.connect()
    if inspect.isawaitable(result):
        asyncio.run(_await(result))


async def _await(awaitable: Any) -> Any:
    return await awaitable


# ---------------------------------------------------------------------------
# Arranque elevado del demonio


def _python_executable() -> str:
    # Con PyInstaller, sys.executable es el propio sidecar: buscamos el intérprete
    # del entorno declarado por el proceso padre.
    return os.environ.get("GEOPILOT_PYTHON") or sys.executable


def tunneld_command() -> list[str]:
    return [_python_executable(), "-m", "pymobiledevice3", "remote", "tunneld", "--daemonize"]


def start_tunneld_elevated() -> dict:
    """Lanza tunneld con privilegios. El SO pedirá confirmación al usuario."""
    if is_running():
        return {"started": True, "alreadyRunning": True}

    system = platform.system()
    cmd = tunneld_command()

    try:
        if system == "Darwin":
            inner = " ".join(shlex.quote(part) for part in cmd)
            script = f'do shell script "{inner}" with administrator privileges'
            subprocess.run(
                ["osascript", "-e", script],
                check=True,
                capture_output=True,
                timeout=120,
            )
        elif system == "Windows":
            args = ", ".join(f"'{part}'" for part in cmd[1:])
            subprocess.run(
                [
                    "powershell",
                    "-NoProfile",
                    "-Command",
                    f"Start-Process -FilePath '{cmd[0]}' -ArgumentList {args} "
                    f"-Verb RunAs -WindowStyle Hidden",
                ],
                check=True,
                capture_output=True,
                timeout=120,
            )
        else:  # Linux
            subprocess.run(["pkexec", *cmd], check=True, capture_output=True, timeout=120)
    except subprocess.CalledProcessError as exc:
        stderr = (exc.stderr or b"").decode(errors="replace")
        raise BridgeError(
            "TUNNEL_START_FAILED",
            "No se pudo iniciar el túnel. Se requieren permisos de administrador.",
            detail=stderr[:500] or str(exc),
        ) from exc
    except FileNotFoundError as exc:
        raise BridgeError(
            "TUNNEL_START_FAILED",
            "No se encontró la herramienta de elevación de privilegios del sistema.",
            detail=str(exc),
        ) from exc

    # tunneld tarda un par de segundos en levantar el API.
    for _ in range(20):
        if is_running():
            return {"started": True, "alreadyRunning": False}
        time.sleep(0.5)

    raise BridgeError(
        "TUNNEL_START_FAILED",
        "El túnel se lanzó pero no respondió. Ejecútalo manualmente:\n"
        f"  sudo {' '.join(tunneld_command())}",
    )


def status(udid: str | None = None) -> dict:
    running = is_running()
    result: dict[str, Any] = {
        "running": running,
        "url": TUNNELD_URL,
        "manualCommand": "sudo " + " ".join(tunneld_command()),
    }
    if running and udid:
        try:
            result["deviceTunneled"] = bool(list_tunnels().get(udid))
        except BridgeError:
            result["deviceTunneled"] = False
    return result
