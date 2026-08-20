"""Montaje de la imagen de disco de desarrollador (DDI).

Sin la DDI montada, lockdownd no publica los servicios de instrumentación y
`com.apple.dt.simulatelocation` responde InvalidService. Hay dos regímenes:

  * iOS 12 – 16.x  ->  imagen clásica `DeveloperDiskImage.dmg` + `.signature`,
                       tipo de imagen "Developer".
  * iOS 17.0+      ->  imagen *personalizada*: el host pide un ticket a los
                       servidores de Apple (TSS) firmado contra el ECID del
                       dispositivo concreto, tipo de imagen "Personalized".
                       Requiere conexión a Internet la primera vez.

pymobiledevice3 resuelve ambos con `auto_mount`, descargando la imagen desde
su repositorio de DDIs o reutilizando la de un Xcode instalado. Aquí sólo se
envuelve con detección de estado, caché y errores traducibles.
"""

from __future__ import annotations

import asyncio
import inspect
from pathlib import Path
from typing import Any, Callable

from .errors import BridgeError, classify

def _mounter_api() -> Any:
    """Importa `mobile_image_mounter` bajo demanda.

    Se difiere a propósito: este módulo arrastra buena parte de pymobiledevice3
    y tarda cerca de un segundo en cargar, pero sólo hace falta al montar o
    comprobar la imagen. Importarlo al arrancar retrasaba la detección del
    iPhone sin ningún motivo.
    """
    try:
        from pymobiledevice3.services import mobile_image_mounter

        return mobile_image_mounter
    except ImportError as exc:  # pragma: no cover
        raise BridgeError(
            "PYMOBILEDEVICE3_MISSING",
            "pymobiledevice3 no está instalado o es demasiado antiguo.",
            detail=str(exc),
        ) from exc


PERSONALIZED_MIN_MAJOR = 17


def image_type_for(major_version: int) -> str:
    return "Personalized" if major_version >= PERSONALIZED_MIN_MAJOR else "Developer"


def _major(lockdown: Any) -> int:
    try:
        return int(str(lockdown.product_version).split(".")[0])
    except (ValueError, AttributeError, IndexError):
        return 0


def _run_maybe_async(fn: Callable, *args, **kwargs) -> Any:
    """pymobiledevice3 convirtió varias APIs en corrutinas a partir de 4.x."""
    result = fn(*args, **kwargs)
    if inspect.isawaitable(result):
        return asyncio.run(_await(result))
    return result


async def _await(awaitable: Any) -> Any:
    return await awaitable


def is_mounted(lockdown: Any) -> bool:
    """True si ya hay una DDI del tipo correcto montada."""
    major = _major(lockdown)
    image_type = image_type_for(major)

    try:
        mounter = _mounter_api().MobileImageMounterService(lockdown=lockdown)
    except TypeError:
        mounter = _mounter_api().MobileImageMounterService(lockdown)

    try:
        # Vía canónica en pymobiledevice3 moderno.
        checker = getattr(mounter, "is_image_mounted", None)
        if callable(checker):
            return bool(checker(image_type))

        # Respaldo para versiones antiguas que no la exponían.
        for entry in mounter.copy_devices() or []:
            if entry.get("DiskImageType") == image_type:
                return True
        # iOS 17 no siempre rellena DiskImageType; caemos a lookup.
        return bool(mounter.lookup_image(image_type))
    except Exception:  # noqa: BLE001 - "no montada" también llega como excepción
        return False
    finally:
        _safe_close(mounter)


def mount(lockdown: Any, on_progress: Callable[[str], None] | None = None) -> dict:
    """Monta la DDI adecuada. Idempotente."""
    major = _major(lockdown)
    image_type = image_type_for(major)

    if is_mounted(lockdown):
        return {"mounted": True, "imageType": image_type, "alreadyMounted": True}

    def progress(message: str) -> None:
        if on_progress:
            on_progress(message)

    if major >= PERSONALIZED_MIN_MAJOR:
        progress("Solicitando ticket de firma personalizado a Apple (requiere Internet)…")
    else:
        progress("Descargando/localizando DeveloperDiskImage para iOS %s…" % lockdown.product_version)

    try:
        _run_maybe_async(_mounter_api().auto_mount, lockdown)
    except TypeError:
        # Firmas antiguas: auto_mount(lockdown, xcode=..., version=...)
        try:
            _run_maybe_async(_mounter_api().auto_mount, service_provider=lockdown)
        except Exception as exc:  # noqa: BLE001
            raise _mount_error(exc, major) from exc
    except Exception as exc:  # noqa: BLE001
        # "Image already mounted" no es un fallo.
        if "already mounted" in str(exc).lower():
            return {"mounted": True, "imageType": image_type, "alreadyMounted": True}

        # Corte de socket durante el montaje personalizado: reintentar por la
        # vía manual, que sí trata el cierre como "no hay manifiesto cacheado".
        if major >= PERSONALIZED_MIN_MAJOR and isinstance(
            exc, (BrokenPipeError, ConnectionResetError)
        ):
            progress("Reintentando el montaje tras el cierre de conexión…")
            try:
                _mount_personalized_resilient(lockdown, progress)
            except Exception as retry_exc:  # noqa: BLE001
                raise _mount_error(retry_exc, major) from retry_exc
        else:
            raise _mount_error(exc, major) from exc

    progress("Verificando montaje…")
    if not is_mounted(lockdown):
        raise BridgeError(
            "DDI_MOUNT_FAILED",
            "La imagen de desarrollador no quedó montada. Reconecta el iPhone e inténtalo de nuevo.",
        )

    return {"mounted": True, "imageType": image_type, "alreadyMounted": False}


def _mount_personalized_resilient(lockdown: Any, progress: Callable[[str], None]) -> None:
    """Reintento del montaje personalizado tolerante al corte de socket.

    Cuando el dispositivo no tiene manifiesto cacheado, cierra la conexión a
    propósito; pymobiledevice3 cuenta con ello y espera un MissingManifestError
    para pedirle entonces el ticket a Apple. Sobre una conexión de red (iPhone
    emparejado por Wi-Fi) ese cierre aflora como BrokenPipeError crudo desde la
    capa SSL antes de que la librería llegue a interpretar el plist de error, y
    el camino alternativo nunca se ejecuta.

    Aquí se replica `PersonalizedImageMounter.mount` capturando además los
    errores de socket, de modo que el fallback a TSS ocurra igualmente.
    """
    import hashlib
    import plistlib

    from pymobiledevice3.common import get_home_folder
    from pymobiledevice3.exceptions import MissingManifestError

    local = get_home_folder() / "Xcode_iOS_DDI_Personalized"
    image_path = local / "Image.dmg"
    manifest_path = local / "BuildManifest.plist"
    trustcache_path = local / "Image.trustcache"

    missing = [p.name for p in (image_path, manifest_path, trustcache_path) if not p.exists()]
    if missing:
        raise BridgeError(
            "DDI_NOT_FOUND",
            "Faltan ficheros de la imagen de desarrollador en la caché local.",
            detail=f"{local}: {', '.join(missing)}",
        )

    mounter = _mounter_api().PersonalizedImageMounter(lockdown=lockdown)
    try:
        mounter.raise_if_cannot_mount()

        image = image_path.read_bytes()
        trust_cache = trustcache_path.read_bytes()
        service_name = getattr(mounter, "service_name", None) or mounter.SERVICE_NAME

        try:
            progress("Consultando si el dispositivo ya tiene un permiso firmado…")
            manifest = mounter.query_personalization_manifest(
                "DeveloperDiskImage", hashlib.sha384(image).digest()
            )
        except (MissingManifestError, BrokenPipeError, ConnectionResetError, OSError):
            # Camino esperado la primera vez: reabrir el servicio y pedir el
            # ticket a los servidores de firma de Apple.
            progress("Solicitando permiso firmado a Apple para este dispositivo…")
            mounter.service = lockdown.start_lockdown_service(service_name)
            manifest = _run_maybe_async(
                mounter.get_manifest_from_tss, plistlib.loads(manifest_path.read_bytes())
            )

        progress(f"Subiendo la imagen al dispositivo ({len(image) // (1024 * 1024)} MB)…")
        mounter.upload_image(mounter.IMAGE_TYPE, image, manifest)

        progress("Montando…")
        mounter.mount_image(mounter.IMAGE_TYPE, manifest, extras={"ImageTrustCache": trust_cache})
    finally:
        _safe_close(mounter)


def mount_from_path(lockdown: Any, image_path: str, signature_path: str | None = None) -> dict:
    """Monta una DDI clásica proporcionada por el usuario (iOS ≤ 16).

    Útil sin Internet o con versiones de iOS cuya imagen no está en el
    repositorio público (betas, por ejemplo).
    """
    major = _major(lockdown)
    if major >= PERSONALIZED_MIN_MAJOR:
        raise BridgeError(
            "DDI_MOUNT_FAILED",
            "iOS 17+ usa imágenes personalizadas firmadas por Apple; no se puede montar un .dmg suelto. "
            "Usa el montaje automático.",
        )

    image = Path(image_path)
    signature = Path(signature_path) if signature_path else image.with_suffix(image.suffix + ".signature")
    if not image.exists():
        raise BridgeError("DDI_NOT_FOUND", f"No existe la imagen: {image}")
    if not signature.exists():
        raise BridgeError("DDI_NOT_FOUND", f"No existe la firma: {signature}")

    mounter = _mounter_api().DeveloperDiskImageMounter(lockdown=lockdown)
    try:
        _run_maybe_async(mounter.mount, image, signature)
    except Exception as exc:  # noqa: BLE001
        raise _mount_error(exc, major) from exc
    finally:
        _safe_close(mounter)

    return {"mounted": True, "imageType": "Developer", "alreadyMounted": False}


def unmount(lockdown: Any) -> dict:
    """Desmonta la DDI (sólo iOS 17+ lo permite sin reiniciar)."""
    major = _major(lockdown)
    image_type = image_type_for(major)
    api = _mounter_api()
    cls = api.PersonalizedImageMounter if major >= PERSONALIZED_MIN_MAJOR else api.DeveloperDiskImageMounter
    mounter = cls(lockdown=lockdown)
    try:
        _run_maybe_async(mounter.umount)
        return {"mounted": False, "imageType": image_type}
    except Exception as exc:  # noqa: BLE001
        raise classify(exc) from exc
    finally:
        _safe_close(mounter)


def _mount_error(exc: BaseException, major: int) -> BridgeError:
    err = classify(exc)
    text = str(exc).lower()

    if "developer mode" in text or err.code == "DEVELOPER_MODE_DISABLED":
        return BridgeError(
            "DEVELOPER_MODE_DISABLED",
            "Activa el Modo Desarrollador en el iPhone (Ajustes > Privacidad y seguridad > "
            "Modo de desarrollador) y reinícialo.",
            detail=str(exc),
        )
    if any(k in text for k in ("connection", "urlopen", "timed out", "resolve", "ssl")):
        return BridgeError(
            "DDI_MOUNT_FAILED",
            "No se pudo descargar la imagen de desarrollador. Comprueba tu conexión a Internet "
            + ("(iOS 17+ necesita contactar con los servidores de firma de Apple)." if major >= 17 else "."),
            detail=str(exc),
        )
    if "not found" in text or err.code == "DDI_NOT_FOUND":
        return BridgeError(
            "DDI_NOT_FOUND",
            "No hay imagen de desarrollador para esta versión de iOS. "
            "Actualiza pymobiledevice3 o instala un Xcode que la incluya.",
            detail=str(exc),
        )
    if err.code == "UNKNOWN":
        return BridgeError("DDI_MOUNT_FAILED", f"Fallo al montar la imagen: {exc}", detail=str(exc))
    return err


def _safe_close(service: Any) -> None:
    for name in ("close", "service_close"):
        closer = getattr(service, name, None)
        if callable(closer):
            try:
                closer()
            except Exception:  # noqa: BLE001
                pass
            return
