"""Ensamblado del sidecar: registra los métodos RPC y coordina los módulos."""

from __future__ import annotations

import platform
import sys
from typing import Any

from . import __version__, ddi, tunnel
from .devices import DeviceRegistry
from .errors import BridgeError
from .location import LocationSession, build_backend_factory
from .rpc import RpcServer


class BridgeServer:
    def __init__(self) -> None:
        self.rpc = RpcServer()
        self.registry = DeviceRegistry(self.rpc.emit)
        self.session: LocationSession | None = None
        self._register()

    # ------------------------------------------------------------------ utils
    def _log(self, level: str, message: str, scope: str = "bridge") -> None:
        self.rpc.log(level, scope, message)

    def _udid(self, params: dict) -> str:
        udid = params.get("udid")
        if not udid:
            raise BridgeError("DEVICE_NOT_FOUND", "Falta el UDID del dispositivo.")
        return udid

    # ------------------------------------------------------------------ setup
    def _register(self) -> None:
        r = self.rpc

        # ---------------------------------------------------------- diagnóstico
        @r.method("ping")
        def _ping(_params: dict) -> dict:
            return {"pong": True, "version": __version__}

        @r.method("bridge.status")
        def _bridge_status(_params: dict) -> dict:
            return {
                "running": True,
                "bridgeVersion": __version__,
                "pythonPath": sys.executable,
                "pythonVersion": platform.python_version(),
                "pymobiledevice3Version": _pymobiledevice3_version(),
                "platform": platform.system(),
                "tunneldRunning": tunnel.is_running(),
                "lastError": None,
            }

        @r.method("shutdown")
        def _shutdown(_params: dict) -> dict:
            self._teardown()
            r.stopped.set()
            return {"ok": True}

        # ------------------------------------------------------------ dispositivos
        @r.method("devices.list")
        def _devices_list(params: dict) -> list[dict]:
            return self.registry.list_devices(allow_cache=not params.get("force", False))

        @r.method("devices.watch")
        def _devices_watch(_params: dict) -> dict:
            self.registry.start_watching()
            return {"watching": True}

        @r.method("devices.unwatch")
        def _devices_unwatch(_params: dict) -> dict:
            self.registry.stop_watching()
            return {"watching": False}

        @r.method("device.info")
        def _device_info(params: dict) -> dict:
            return self.registry.describe_by_udid(params["udid"])

        @r.method("device.pair")
        def _device_pair(params: dict) -> dict:
            self._log("info", "Solicitando confianza al dispositivo…")
            return self.registry.pair(params["udid"])

        @r.method("device.forget")
        def _device_forget(params: dict) -> dict:
            self.registry.forget(params["udid"])
            return {"ok": True}

        # -------------------------------------------------------- modo desarrollador
        @r.method("developerMode.enable")
        def _dev_mode_enable(params: dict) -> dict:
            self._log("info", "Activando Modo Desarrollador (el iPhone se reiniciará)…")
            return self.registry.enable_developer_mode(params["udid"])

        @r.method("developerMode.reveal")
        def _dev_mode_reveal(params: dict) -> dict:
            return self.registry.reveal_developer_mode_toggle(params["udid"])

        # ------------------------------------------------------------------ DDI
        @r.method("ddi.status")
        def _ddi_status(params: dict) -> dict:
            with self.registry.using(self._udid(params)) as lockdown:
                major = _major(lockdown)
                return {"mounted": ddi.is_mounted(lockdown), "imageType": ddi.image_type_for(major)}

        @r.method("ddi.mount")
        def _ddi_mount(params: dict) -> dict:
            udid = self._udid(params)
            self.rpc.emit("ddi.progress", {"udid": udid, "message": "Preparando montaje…"})

            def progress(message: str) -> None:
                self.rpc.emit("ddi.progress", {"udid": udid, "message": message})
                self._log("info", message, scope="ddi")

            with self.registry.using(udid) as lockdown:
                result = ddi.mount(lockdown, on_progress=progress)
            self._log("info", f"Imagen de desarrollador lista ({result['imageType']}).", scope="ddi")
            return result

        @r.method("ddi.mountLocal")
        def _ddi_mount_local(params: dict) -> dict:
            with self.registry.using(self._udid(params)) as lockdown:
                return ddi.mount_from_path(
                    lockdown, params["imagePath"], params.get("signaturePath")
                )

        @r.method("ddi.unmount")
        def _ddi_unmount(params: dict) -> dict:
            with self.registry.using(self._udid(params)) as lockdown:
                return ddi.unmount(lockdown)

        # ---------------------------------------------------------------- túnel
        @r.method("tunnel.status")
        def _tunnel_status(params: dict) -> dict:
            return tunnel.status(params.get("udid"))

        @r.method("tunnel.start")
        def _tunnel_start(_params: dict) -> dict:
            self._log("info", "Solicitando privilegios para levantar el túnel RSD…", scope="tunnel")
            return tunnel.start_tunneld_elevated()

        # ------------------------------------------------------------ preparación
        @r.method("device.prepare")
        def _device_prepare(params: dict) -> dict:
            """Ejecuta la secuencia completa hasta dejar el dispositivo listo.

            Devuelve el primer obstáculo encontrado como `state`, de modo que la
            UI sepa exactamente qué pantalla de ayuda mostrar.
            """
            udid = params["udid"]
            auto_mount = params.get("autoMount", True)

            info = self.registry.describe_by_udid(udid)
            if info["trust"] != "trusted":
                state = "locked" if info["trust"] == "password-protected" else "untrusted"
                return {"state": state, "device": info}

            major = info["majorVersion"]

            if info["developerModeEnabled"] is False:
                return {"state": "dev-mode-required", "device": info}

            with self.registry.using(udid) as lockdown:
                mounted = ddi.is_mounted(lockdown)
                if not mounted and auto_mount:
                    self.rpc.emit("device.state", {"udid": udid, "state": "mounting"})
                    ddi.mount(
                        lockdown,
                        on_progress=lambda m: self.rpc.emit(
                            "ddi.progress", {"udid": udid, "message": m}
                        ),
                    )
                    mounted = True
            info["ddiMounted"] = mounted
            if not mounted:
                return {"state": "mounting", "device": info}

            if tunnel.is_required(major):
                tunnel_state = tunnel.status(udid)
                if not tunnel_state["running"] or not tunnel_state.get("deviceTunneled"):
                    return {"state": "tunnel-required", "device": info, "tunnel": tunnel_state}

            return {"state": "ready", "device": info}

        # ------------------------------------------------------------- ubicación
        @r.method("location.start")
        def _location_start(params: dict) -> dict:
            udid = params["udid"]
            if self.session is not None and self.session.alive:
                if self.session.udid == udid:
                    return self.session.status()
                self.session.stop(reset=True)

            info = self.registry.describe_by_udid(udid)
            major = info["majorVersion"]

            rsd_provider = (lambda: tunnel.get_rsd(udid)) if tunnel.is_required(major) else None

            factory = build_backend_factory(
                lambda: self.registry.using(udid),
                major,
                rsd_provider,
                lambda level, message: self._log(level, message, scope="location"),
            )
            self.session = LocationSession(udid, factory, self.rpc.emit)
            status = self.session.start()

            # Punto inicial opcional para no dejar la sesión "vacía".
            if params.get("lat") is not None and params.get("lng") is not None:
                self.session.set(params["lat"], params["lng"])

            self._log("info", f"Simulación abierta ({status.get('backend')}).", scope="location")
            return status

        @r.method("location.set")
        def _location_set(params: dict) -> dict:
            if self.session is None or not self.session.alive:
                raise BridgeError("SERVICE_UNAVAILABLE", "No hay una sesión de simulación abierta.")
            self.session.set(params["lat"], params["lng"])
            return {"queued": True}

        @r.method("location.stop")
        def _location_stop(params: dict) -> dict:
            if self.session is None:
                return {"stopped": True, "reset": False, "pointsSent": 0}
            result = self.session.stop(reset=params.get("reset", True))
            self.session = None
            self._log("info", "Simulación detenida; el dispositivo vuelve al GPS real.", scope="location")
            return result

        @r.method("location.status")
        def _location_status(_params: dict) -> dict:
            if self.session is None:
                return {"active": False, "backend": None, "lastPoint": None, "pointsSent": 0}
            return self.session.status()

    # --------------------------------------------------------------- ejecución
    # Nota: se probó precargar `pymobiledevice3.lockdown` en un hilo de fondo
    # para adelantar sus ~700 ms de import. No aporta nada medible: el GIL y el
    # bloqueo por módulo hacen que el watcher espere igual a que termine. El
    # coste sólo se puede esconder, y ya se esconde con la detección en dos
    # fases (el iPhone aparece en pantalla a los ~265 ms).

    def run(self) -> None:
        self.rpc.emit("bridge.ready", {"version": __version__, "python": platform.python_version()})
        try:
            self.rpc.serve_forever()
        finally:
            self._teardown()

    def _teardown(self) -> None:
        self.registry.stop_watching()
        if self.session is not None:
            try:
                self.session.stop(reset=True)
            except Exception:  # noqa: BLE001
                pass
            self.session = None
        self.rpc.shutdown()


def _major(lockdown: Any) -> int:
    try:
        return int(str(lockdown.product_version).split(".")[0])
    except (ValueError, AttributeError, IndexError):
        return 0


def _pymobiledevice3_version() -> str | None:
    try:
        from importlib.metadata import version

        return version("pymobiledevice3")
    except Exception:  # noqa: BLE001
        return None
