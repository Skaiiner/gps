"""Traducción de excepciones de pymobiledevice3 a códigos estables para la UI.

La jerarquía de excepciones de pymobiledevice3 cambia entre versiones menores,
así que se resuelve por nombre de clase además de por isinstance. Es feo pero
evita que una actualización de la librería rompa el diagnóstico en la UI.
"""

from __future__ import annotations


class BridgeError(Exception):
    """Error con código estable que el renderer sabe traducir a instrucciones."""

    def __init__(self, code: str, message: str, detail: str | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.detail = detail

    def to_dict(self) -> dict:
        return {"code": self.code, "message": self.message, "detail": self.detail}


# Nombre de excepción de pymobiledevice3 -> (código, mensaje para el usuario)
_EXCEPTION_MAP: dict[str, tuple[str, str]] = {
    "NotPairedError": (
        "NOT_TRUSTED",
        "El iPhone no ha confiado en este ordenador. Desbloquea el dispositivo y pulsa «Confiar».",
    ),
    "PairingError": (
        "NOT_TRUSTED",
        "Falló el emparejamiento con el dispositivo. Desconecta el cable, vuelve a conectarlo y acepta «Confiar».",
    ),
    "PairingDialogResponsePendingError": (
        "NOT_TRUSTED",
        "Hay un diálogo de confianza abierto en el iPhone. Púlsalo para continuar.",
    ),
    "UserDeniedPairingError": (
        "NOT_TRUSTED",
        "Se denegó la confianza en el iPhone. Reconecta el cable y pulsa «Confiar».",
    ),
    "PasswordRequiredError": (
        "PASSWORD_REQUIRED",
        "El iPhone está bloqueado. Desbloquéalo con tu código para continuar.",
    ),
    "DeviceNotFoundError": ("DEVICE_NOT_FOUND", "El dispositivo ya no está conectado."),
    "MuxException": ("USBMUXD_UNAVAILABLE", "No se puede hablar con usbmuxd."),
    "NotTrustedError": (
        "NOT_TRUSTED",
        "El iPhone no confía en este ordenador todavía.",
    ),
    "DeveloperModeIsNotEnabledError": (
        "DEVELOPER_MODE_DISABLED",
        "Activa el Modo Desarrollador en Ajustes > Privacidad y seguridad > Modo de desarrollador.",
    ),
    "DeveloperDiskImageNotFoundError": (
        "DDI_NOT_FOUND",
        "No hay DeveloperDiskImage disponible para esta versión de iOS.",
    ),
    "DeveloperModeError": (
        "DEVELOPER_MODE_DISABLED",
        "No se pudo activar el Modo Desarrollador en el dispositivo.",
    ),
    "UnsupportedCommandError": (
        "SERVICE_UNAVAILABLE",
        "El dispositivo rechazó el comando. Puede faltar el montaje de la imagen de desarrollador.",
    ),
    "InvalidServiceError": (
        "SERVICE_UNAVAILABLE",
        "El servicio de simulación de ubicación no está disponible. "
        "Comprueba que la imagen de desarrollador esté montada (y el túnel en iOS 17+).",
    ),
    "StartServiceError": (
        "SERVICE_UNAVAILABLE",
        "No se pudo iniciar el servicio en el dispositivo.",
    ),
    "ConnectionFailedError": (
        "SERVICE_UNAVAILABLE",
        "Fallo de conexión con el dispositivo.",
    ),
    "ConnectionTerminatedError": (
        "SERVICE_UNAVAILABLE",
        "El dispositivo cerró la conexión.",
    ),
    "AccessDeniedError": (
        "PERMISSION_DENIED",
        "Permisos insuficientes. En macOS/Linux el túnel RSD requiere privilegios de administrador.",
    ),
}


def classify(exc: BaseException) -> BridgeError:
    """Convierte cualquier excepción en un BridgeError con código conocido."""
    if isinstance(exc, BridgeError):
        return exc

    for klass in type(exc).__mro__:
        entry = _EXCEPTION_MAP.get(klass.__name__)
        if entry is not None:
            code, message = entry
            return BridgeError(code, message, detail=f"{type(exc).__name__}: {exc}")

    if isinstance(exc, (ConnectionRefusedError, FileNotFoundError)):
        return BridgeError(
            "USBMUXD_UNAVAILABLE",
            "No se encuentra usbmuxd. En Windows instala «Apple Devices» o iTunes; "
            "en Linux arranca el servicio usbmuxd.",
            detail=str(exc),
        )
    if isinstance(exc, PermissionError):
        return BridgeError("PERMISSION_DENIED", "Permisos insuficientes.", detail=str(exc))

    return BridgeError("UNKNOWN", str(exc) or type(exc).__name__, detail=type(exc).__name__)
