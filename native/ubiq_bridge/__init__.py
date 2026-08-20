"""Sidecar de comunicación USB con dispositivos iOS para GeoPilot.

Expone un servidor JSON-RPC sobre stdin/stdout consumido por el proceso
principal de Electron. Toda la interacción con el iPhone (usbmuxd, lockdownd,
montaje de DeveloperDiskImage y el servicio com.apple.dt.simulatelocation)
ocurre aquí.
"""

__version__ = "1.0.0"
