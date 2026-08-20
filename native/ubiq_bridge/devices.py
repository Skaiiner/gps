"""Enumeración de dispositivos por usbmuxd, estado de emparejamiento y Modo Desarrollador."""

from __future__ import annotations

import contextlib
import threading
import time
from typing import Any, Callable, Iterator

from pymobiledevice3 import usbmux

from .errors import BridgeError, classify


def _create_lockdown() -> Any:
    """`pymobiledevice3.lockdown` es caro de importar; se difiere al primer uso."""
    from pymobiledevice3.lockdown import create_using_usbmux

    return create_using_usbmux


def _amfi_service() -> Any:
    """AmfiService sólo se usa para activar el Modo Desarrollador."""
    try:
        from pymobiledevice3.services.amfi import AmfiService

        return AmfiService
    except ImportError:  # pragma: no cover
        return None


# Enumerar por usbmux cuesta ~3 ms, así que se puede sondear a menudo sin coste.
POLL_INTERVAL_SECONDS = 1.0

# Un `describe()` completo cuesta ~60 ms (más de 200 ms si hay que rehacer el
# handshake), así que no se repite en cada sondeo. Mientras el dispositivo esté
# bloqueado esperando una acción del usuario —confiar, activar el Modo
# Desarrollador— se refresca a menudo para reaccionar al instante; una vez
# listo, basta con vigilar que siga enchufado.
DESCRIBE_INTERVAL_PENDING = 2.0
DESCRIBE_INTERVAL_READY = 20.0

# Cada cuánto se revalida un cliente lockdown cacheado.
VALIDATE_INTERVAL_SECONDS = 5.0


def _major_version(product_version: str) -> int:
    try:
        return int(str(product_version).split(".")[0])
    except (ValueError, IndexError):
        return 0


class DeviceRegistry:
    """Cachea clientes lockdown por UDID y publica cambios de conexión.

    usbmuxd soporta un modo LISTEN nativo, pero mantener ese socket vivo a
    través de suspensiones del sistema y reinicios del servicio en Windows es
    frágil. Un sondeo de 1 s es indistinguible para el usuario y se recupera
    solo de cualquier caída del demonio.
    """

    def __init__(self, emit: Callable[[str, Any], None]) -> None:
        self._emit = emit
        self._lock = threading.RLock()
        self._lockdowns: dict[str, Any] = {}
        self._validated: dict[str, float] = {}
        self._device_locks: dict[str, threading.RLock] = {}
        self._known: dict[str, dict] = {}
        self._watch_thread: threading.Thread | None = None
        self._stop = threading.Event()

    # ------------------------------------------------------------ enumeración
    def list_mux_devices(self) -> list[Any]:
        try:
            devices = usbmux.list_devices()
        except Exception as exc:  # noqa: BLE001
            raise classify(exc) from exc
        # Un mismo iPhone aparece dos veces cuando está enchufado y además
        # emparejado por Wi-Fi: una entrada 'USB' y otra 'Network'. Son el mismo
        # dispositivo, así que se deduplica por UDID quedándose con la de USB,
        # que es más rápida y estable (imprescindible para el túnel de iOS 17+).
        devices = sorted(devices, key=lambda d: 0 if _connection_type(d) == "USB" else 1)

        unique: dict[str, Any] = {}
        for device in devices:
            unique.setdefault(device.serial, device)
        return list(unique.values())

    def get_lockdown(self, udid: str, autopair: bool = False) -> Any:
        """Devuelve (y cachea) un cliente lockdown para el UDID."""
        with self._lock:
            client = self._lockdowns.get(udid)
            if client is not None:
                # La comprobación de vida es un ida y vuelta de ~26 ms. Hacerla
                # en cada llamada dominaba el coste del sondeo, así que se limita
                # a una vez cada pocos segundos: si la sesión muere entretanto,
                # la operación real fallará y el cliente se recreará entonces.
                now = time.monotonic()
                if now - self._validated.get(udid, 0.0) < VALIDATE_INTERVAL_SECONDS:
                    return client
                try:
                    client.get_value(key="ProductVersion")
                    self._validated[udid] = now
                    return client
                except Exception:  # noqa: BLE001 - sesión muerta, se recrea
                    self._lockdowns.pop(udid, None)
                    self._validated.pop(udid, None)

            try:
                client = _create_lockdown()(serial=udid, autopair=autopair)
            except Exception as exc:  # noqa: BLE001
                raise classify(exc) from exc

            self._lockdowns[udid] = client
            self._validated[udid] = time.monotonic()
            return client

    def _device_lock(self, udid: str) -> threading.RLock:
        with self._lock:
            lock = self._device_locks.get(udid)
            if lock is None:
                lock = threading.RLock()
                self._device_locks[udid] = lock
            return lock

    @contextlib.contextmanager
    def using(self, udid: str, autopair: bool = False) -> Iterator[Any]:
        """Acceso exclusivo al cliente lockdown de un dispositivo.

        El canal de control de lockdownd es una única conexión con
        petición/respuesta emparejadas: si dos hilos escriben a la vez, las
        respuestas se cruzan y se leen valores de la petición ajena. Como el
        RPC despacha en un pool y el watcher vive en su propio hilo, esto
        ocurría de verdad —`device.prepare` llegaba a informar de que el Modo
        Desarrollador estaba apagado teniéndolo encendido—. Toda operación
        sobre lockdown debe pasar por aquí.
        """
        with self._device_lock(udid):
            yield self.get_lockdown(udid, autopair=autopair)

    def forget(self, udid: str) -> None:
        with self._lock:
            client = self._lockdowns.pop(udid, None)
            self._validated.pop(udid, None)
        if client is not None:
            try:
                client.close()
            except Exception:  # noqa: BLE001
                pass

    def pair(self, udid: str) -> dict:
        """Fuerza el diálogo «Confiar en este ordenador»."""
        self.forget(udid)
        with self.using(udid, autopair=True) as lockdown:
            return {"paired": True, "udid": lockdown.identifier}

    # ------------------------------------------------------------ información
    def describe(self, mux_device: Any) -> dict:
        """Construye el DeviceInfo. Nunca lanza: degrada a estado 'untrusted'."""
        udid = mux_device.serial
        base = {
            "udid": udid,
            "name": "iPhone",
            "productType": "",
            "productVersion": "",
            "buildVersion": "",
            "deviceClass": "iPhone",
            "connectionType": _connection_type(mux_device),
            "majorVersion": 0,
            "trust": "unknown",
            "developerModeEnabled": None,
            "ddiMounted": False,
            "batteryLevel": None,
        }

        # Una sola toma del cerrojo para todas las consultas: así el bloque
        # entero es atómico frente al watcher y al resto de peticiones RPC.
        with self._device_lock(udid):
            try:
                lockdown = self.get_lockdown(udid)
            except BridgeError as err:
                base["trust"] = (
                    "password-protected" if err.code == "PASSWORD_REQUIRED" else "untrusted"
                )
                return base

            try:
                values = lockdown.all_values or {}
            except Exception:  # noqa: BLE001
                values = {}

            product_version = str(values.get("ProductVersion", "") or "")
            base.update(
                {
                    "name": values.get("DeviceName") or "iPhone",
                    "productType": values.get("ProductType", "") or "",
                    "productVersion": product_version,
                    "buildVersion": values.get("BuildVersion", "") or "",
                    "deviceClass": values.get("DeviceClass", "iPhone") or "iPhone",
                    "majorVersion": _major_version(product_version),
                    "trust": "trusted",
                    "developerModeEnabled": self.developer_mode_status(lockdown),
                    "batteryLevel": _battery_level(lockdown),
                }
            )
            return base

    def describe_by_udid(self, udid: str) -> dict:
        for dev in self.list_mux_devices():
            if dev.serial == udid:
                return self.describe(dev)
        raise BridgeError("DEVICE_NOT_FOUND", "El dispositivo ya no está conectado.")

    def list_devices(self, allow_cache: bool = True) -> list[dict]:
        """Lista los dispositivos, reutilizando lo que el watcher ya sabe.

        El watcher mantiene `_known` al día, así que la petición inicial de la
        interfaz no tiene por qué repetir el handshake y las consultas que
        acaban de hacerse. Se comprueba contra usbmux (3 ms) que la caché
        siga correspondiendo a lo que hay enchufado.
        """
        mux_devices = self.list_mux_devices()

        if allow_cache:
            with self._lock:
                cached = dict(self._known)
            connected = {d.serial for d in mux_devices}
            if cached and set(cached) == connected:
                return [cached[udid] for udid in connected]

        return [self.describe(d) for d in mux_devices]

    # -------------------------------------------------------- modo desarrollador
    def developer_mode_status(self, lockdown: Any) -> bool | None:
        """None = iOS < 16 (el concepto no existe y no hace falta)."""
        if _major_version(str(lockdown.product_version)) < 16:
            return None
        try:
            status = lockdown.get_value(
                domain="com.apple.security.mac.amfi", key="DeveloperModeStatus"
            )
            return bool(status)
        except Exception:  # noqa: BLE001
            # Algunos builds no exponen el dominio hasta que se emparejan del todo.
            return False

    def enable_developer_mode(self, udid: str) -> dict:
        """Dispara el flujo de activación; el usuario debe confirmar en el iPhone.

        El dispositivo se reinicia y, tras el arranque, muestra
        Ajustes > Privacidad y seguridad > Modo de desarrollador.
        """
        amfi = _amfi_service()
        if amfi is None:
            raise BridgeError(
                "DEVELOPER_MODE_DISABLED",
                "Esta versión de pymobiledevice3 no soporta activar el Modo Desarrollador. "
                "Actívalo manualmente en Ajustes > Privacidad y seguridad.",
            )
        with self.using(udid) as lockdown:
            if _major_version(str(lockdown.product_version)) < 16:
                return {"enabled": True, "rebootRequired": False}

            try:
                amfi(lockdown).enable_developer_mode()
            except Exception as exc:  # noqa: BLE001
                raise classify(exc) from exc

        # La sesión lockdown muere con el reinicio.
        self.forget(udid)
        return {"enabled": False, "rebootRequired": True}

    def reveal_developer_mode_toggle(self, udid: str) -> dict:
        """Hace aparecer el interruptor si el menú aún no está visible."""
        amfi = _amfi_service()
        if amfi is None:
            raise BridgeError("DEVELOPER_MODE_DISABLED", "AmfiService no disponible.")
        with self.using(udid) as lockdown:
            amfi(lockdown).create_amfi_show_override_path_file()
        return {"revealed": True}

    # ------------------------------------------------------------- hot-plug
    def start_watching(self) -> None:
        if self._watch_thread and self._watch_thread.is_alive():
            return
        self._stop.clear()
        self._watch_thread = threading.Thread(
            target=self._watch_loop, name="usb-watch", daemon=True
        )
        self._watch_thread.start()

    def stop_watching(self) -> None:
        self._stop.set()

    def minimal_info(self, mux_device: Any) -> dict:
        """DeviceInfo con lo que usbmux ya sabe, sin abrir lockdown (~0 ms).

        Permite avisar de la conexión al instante en vez de esperar los ~250 ms
        del handshake; los campos que faltan llegan enseguida por `device.updated`.
        """
        return {
            "udid": mux_device.serial,
            "name": "iPhone",
            "productType": "",
            "productVersion": "",
            "buildVersion": "",
            "deviceClass": "iPhone",
            "connectionType": _connection_type(mux_device),
            "majorVersion": 0,
            "trust": "unknown",
            "developerModeEnabled": None,
            "ddiMounted": False,
            "batteryLevel": None,
        }

    def _watch_loop(self) -> None:
        last_describe: dict[str, float] = {}

        while not self._stop.is_set():
            try:
                # Sondeo barato (~3 ms): sólo detecta altas y bajas.
                current = {d.serial: d for d in self.list_mux_devices()}
            except BridgeError as err:
                self._emit("bridge.error", err.to_dict())
                self._stop.wait(3.0)
                continue

            with self._lock:
                known_udids = set(self._known)

            for udid in known_udids - set(current):
                with self._lock:
                    self._known.pop(udid, None)
                last_describe.pop(udid, None)
                self.forget(udid)
                self._emit("device.detached", {"udid": udid})

            for udid, mux in current.items():
                with self._lock:
                    previous = self._known.get(udid)

                if previous is None:
                    # Fase 1: la UI reacciona ya.
                    quick = self.minimal_info(mux)
                    with self._lock:
                        self._known[udid] = quick
                    self._emit("device.attached", quick)

                    # Fase 2: datos completos (handshake + consultas).
                    full = self.describe(mux)
                    with self._lock:
                        self._known[udid] = full
                    last_describe[udid] = time.monotonic()
                    self._emit("device.updated", full)
                    continue

                # Ya conocido: describir sólo de vez en cuando. Rápido mientras
                # se espera una acción del usuario, muy espaciado una vez listo.
                interval = (
                    DESCRIBE_INTERVAL_READY if _is_usable(previous) else DESCRIBE_INTERVAL_PENDING
                )
                if time.monotonic() - last_describe.get(udid, 0.0) < interval:
                    continue

                info = self.describe(mux)
                last_describe[udid] = time.monotonic()
                with self._lock:
                    self._known[udid] = info
                if _significant_change(previous, info):
                    # p. ej. el usuario acaba de pulsar «Confiar» o activó el
                    # Modo Desarrollador: la UI debe reaccionar sin recargar.
                    self._emit("device.updated", info)

            self._stop.wait(POLL_INTERVAL_SECONDS)


def _connection_type(mux_device: Any) -> str:
    raw = getattr(mux_device, "connection_type", "USB")
    return "Network" if str(raw).lower().startswith("n") else "USB"


def _battery_level(lockdown: Any) -> int | None:
    try:
        return lockdown.get_value(domain="com.apple.mobile.battery", key="BatteryCurrentCapacity")
    except Exception:  # noqa: BLE001
        return None


_WATCHED_FIELDS = ("trust", "developerModeEnabled", "productVersion", "name")


def _significant_change(before: dict, after: dict) -> bool:
    return any(before.get(f) != after.get(f) for f in _WATCHED_FIELDS)


def _is_usable(info: dict) -> bool:
    """El dispositivo ya no espera ninguna acción del usuario."""
    return info.get("trust") == "trusted" and info.get("developerModeEnabled") is not False


def wait_for_device(registry: DeviceRegistry, udid: str, timeout: float = 30.0) -> dict:
    """Espera a que un UDID vuelva a aparecer (p. ej. tras un reinicio)."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            return registry.describe_by_udid(udid)
        except BridgeError:
            time.sleep(1.0)
    raise BridgeError("DEVICE_NOT_FOUND", "El dispositivo no volvió a conectarse a tiempo.")
