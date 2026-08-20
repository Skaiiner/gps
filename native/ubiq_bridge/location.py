"""Inyección de coordenadas vía `com.apple.dt.simulatelocation`.

Dos back-ends, elegidos por versión de iOS:

  iOS 12 – 16.x
      Servicio lockdown `com.apple.dt.simulatelocation`. El protocolo es
      trivial: un uint32 big-endian de comando (0 = START, 1 = STOP) seguido,
      en el caso de START, de latitud y longitud como cadenas ASCII con
      prefijo de longitud. La clave para que el movimiento se vea fluido es
      mantener **el mismo socket abierto** y reenviar pares START+coordenadas:
      abrir y cerrar el servicio en cada punto provoca los saltos y el
      "temblor" típicos de las implementaciones ingenuas.

  iOS 17.0+
      El servicio se sirve tras RemoteServiceDiscovery. Se usa el canal DTX
      de instruments (`LocationSimulation` sobre DvtSecureSocketProxyService),
      que requiere un túnel activo (ver tunnel.py).

Un hilo dedicado es el único que toca el socket. El RPC sólo deja el último
punto en un buzón, de modo que una llamada a `location.set` nunca bloquea ni
se encola: si la UI empuja a 20 Hz y el dispositivo sólo absorbe 8, se
descartan los intermedios en vez de acumular latencia.
"""

from __future__ import annotations

import threading
import time
from typing import Any, Callable

from .errors import BridgeError, classify

# Los transportes se importan bajo demanda. El canal DVT arrastra medio
# pymobiledevice3 (~1 s de carga) y sólo hace falta al abrir una sesión, no
# para enumerar dispositivos: cargarlo al arrancar retrasaba la detección del
# iPhone en cada inicio de la aplicación.


def _lockdown_service() -> Any:
    from pymobiledevice3.services.simulate_location import DtSimulateLocation

    return DtSimulateLocation


def _dvt_services() -> tuple[Any, Any]:
    from pymobiledevice3.services.dvt.dvt_secure_socket_proxy import DvtSecureSocketProxyService
    from pymobiledevice3.services.dvt.instruments.location_simulation import LocationSimulation

    return DvtSecureSocketProxyService, LocationSimulation


# Reenvío periódico del último punto. Barato, y evita que el dispositivo
# revierta a GPS real si el enlace se queda ocioso mucho tiempo.
KEEPALIVE_SECONDS = 2.0
IDLE_POLL_SECONDS = 0.25


class _Backend:
    """Interfaz mínima común a los dos transportes."""

    name = "base"

    def set(self, lat: float, lng: float) -> None:  # pragma: no cover - interfaz
        raise NotImplementedError

    def clear(self) -> None:  # pragma: no cover - interfaz
        raise NotImplementedError

    def close(self) -> None:  # pragma: no cover - interfaz
        raise NotImplementedError


class LockdownBackend(_Backend):
    """iOS ≤ 16: servicio lockdown directo."""

    name = "lockdown:com.apple.dt.simulatelocation"

    def __init__(self, lockdown: Any) -> None:
        try:
            service_cls = _lockdown_service()
        except ImportError as exc:
            raise BridgeError(
                "SERVICE_UNAVAILABLE",
                "pymobiledevice3 no expone DtSimulateLocation en esta versión.",
                detail=str(exc),
            ) from exc
        self._service = service_cls(lockdown)

    def set(self, lat: float, lng: float) -> None:
        self._service.set(lat, lng)

    def clear(self) -> None:
        self._service.clear()

    def close(self) -> None:
        _safe_close(self._service)


class DvtBackend(_Backend):
    """iOS 17+ (y respaldo en versiones anteriores): canal DTX de instruments."""

    name = "dvt:LocationSimulation"

    def __init__(self, service_provider: Any) -> None:
        try:
            proxy_cls, simulation_cls = _dvt_services()
        except ImportError as exc:
            raise BridgeError(
                "SERVICE_UNAVAILABLE",
                "pymobiledevice3 no expone el canal DVT de simulación de ubicación.",
                detail=str(exc),
            ) from exc
        self._dvt = proxy_cls(lockdown=service_provider)
        handshake = getattr(self._dvt, "perform_handshake", None)
        if callable(handshake):
            try:
                handshake()
            except Exception as exc:  # noqa: BLE001 - algunas versiones ya lo hacen en __init__
                if "already" not in str(exc).lower():
                    raise
        self._sim = simulation_cls(self._dvt)

    def set(self, lat: float, lng: float) -> None:
        self._sim.set(lat, lng)

    def clear(self) -> None:
        self._sim.clear()

    def close(self) -> None:
        _safe_close(self._sim)
        _safe_close(self._dvt)


class LocationSession:
    """Sesión de simulación viva sobre un dispositivo concreto."""

    def __init__(
        self,
        udid: str,
        backend_factory: Callable[[], _Backend],
        emit: Callable[[str, Any], None],
    ) -> None:
        self.udid = udid
        self._factory = backend_factory
        self._emit = emit

        self._backend: _Backend | None = None
        self._lock = threading.Lock()
        self._pending: tuple[float, float] | None = None
        self._last_sent: tuple[float, float] | None = None
        self._last_sent_at = 0.0
        self._new_point = threading.Event()
        self._stop = threading.Event()
        self._ready = threading.Event()
        self._startup_error: BridgeError | None = None
        self._thread: threading.Thread | None = None
        self._points_sent = 0
        # Si es True, al cerrar se envía STOP y el iPhone vuelve al GPS real.
        self._reset_on_exit = True

    # ------------------------------------------------------------------ ciclo
    def start(self, timeout: float = 45.0) -> dict:
        if self._thread and self._thread.is_alive():
            return self.status()

        self._stop.clear()
        self._ready.clear()
        self._startup_error = None
        self._thread = threading.Thread(
            target=self._run, name=f"loc-{self.udid[:8]}", daemon=True
        )
        self._thread.start()

        if not self._ready.wait(timeout):
            self.stop(reset=False)
            raise BridgeError(
                "SERVICE_UNAVAILABLE",
                "El servicio de simulación no respondió a tiempo. Mantén el iPhone desbloqueado "
                "y vuelve a intentarlo.",
            )
        if self._startup_error is not None:
            raise self._startup_error

        return self.status()

    def _run(self) -> None:
        try:
            self._backend = self._factory()
        except BaseException as exc:  # noqa: BLE001
            self._startup_error = classify(exc)
            self._ready.set()
            return

        self._ready.set()
        self._emit("location.session", {"udid": self.udid, "state": "open", "backend": self._backend.name})

        try:
            self._pump()
        except BaseException as exc:  # noqa: BLE001
            err = classify(exc)
            self._emit("location.error", {"udid": self.udid, **err.to_dict()})
        finally:
            backend = self._backend
            self._backend = None
            if backend is not None:
                if self._reset_on_exit:
                    try:
                        backend.clear()
                    except Exception:  # noqa: BLE001
                        pass
                backend.close()
            self._emit("location.session", {"udid": self.udid, "state": "closed"})

    def _pump(self) -> None:
        backend = self._backend
        assert backend is not None

        while not self._stop.is_set():
            self._new_point.wait(IDLE_POLL_SECONDS)
            if self._stop.is_set():
                break

            self._new_point.clear()
            with self._lock:
                point = self._pending
                self._pending = None

            now = time.monotonic()
            if point is None:
                # Keepalive: reenvía el último punto conocido.
                if self._last_sent and now - self._last_sent_at >= KEEPALIVE_SECONDS:
                    point = self._last_sent
                else:
                    continue

            lat, lng = point
            backend.set(lat, lng)
            self._last_sent = (lat, lng)
            self._last_sent_at = now
            self._points_sent += 1

    # ------------------------------------------------------------------- API
    def set(self, lat: float, lng: float) -> None:
        if self._thread is None or not self._thread.is_alive():
            raise BridgeError("SERVICE_UNAVAILABLE", "No hay una sesión de simulación abierta.")
        with self._lock:
            self._pending = (float(lat), float(lng))
        self._new_point.set()

    def stop(self, reset: bool = True) -> dict:
        self._reset_on_exit = reset
        self._stop.set()
        self._new_point.set()
        thread = self._thread
        if thread is not None and thread.is_alive():
            thread.join(timeout=6.0)
        self._thread = None
        return {"stopped": True, "reset": reset, "pointsSent": self._points_sent}

    @property
    def alive(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def status(self) -> dict:
        return {
            "udid": self.udid,
            "active": self.alive,
            "backend": self._backend.name if self._backend else None,
            "lastPoint": (
                {"lat": self._last_sent[0], "lng": self._last_sent[1]} if self._last_sent else None
            ),
            "pointsSent": self._points_sent,
        }


# ---------------------------------------------------------------------------
# Selección de back-end


def build_backend_factory(
    lockdown_session: Callable[[], Any],
    major_version: int,
    rsd_provider: Callable[[], Any] | None,
    log: Callable[[str, str], None],
) -> Callable[[], _Backend]:
    """Devuelve una fábrica que abre el transporte adecuado para esta versión de iOS.

    `lockdown_session` es un gestor de contexto que da acceso exclusivo al
    cliente lockdown: arrancar el servicio de simulación usa el canal de control
    de lockdownd, que no admite dos hilos a la vez. Sólo hace falta mientras se
    construye el backend; después éste habla por su propio socket.
    """

    def factory() -> _Backend:
        if major_version >= 17:
            if rsd_provider is None:
                raise BridgeError(
                    "TUNNEL_REQUIRED",
                    "iOS 17+ requiere un túnel activo para simular la ubicación.",
                )
            log("info", "Abriendo canal DVT sobre RSD (iOS 17+)…")
            return DvtBackend(rsd_provider())

        # iOS ≤ 16: la vía lockdown es más ligera y no depende de instruments.
        with lockdown_session() as lockdown:
            try:
                log("info", "Abriendo com.apple.dt.simulatelocation por lockdown…")
                return LockdownBackend(lockdown)
            except Exception as exc:  # noqa: BLE001
                log("warn", f"Vía lockdown no disponible ({exc}); probando canal DVT…")
                return DvtBackend(lockdown)

    return factory


def _safe_close(obj: Any) -> None:
    for name in ("close", "service_close", "stop"):
        closer = getattr(obj, name, None)
        if callable(closer):
            try:
                closer()
            except Exception:  # noqa: BLE001
                pass
            return
