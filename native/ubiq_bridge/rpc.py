"""Transporte JSON-RPC (línea a línea) sobre stdin/stdout.

Formato:
  petición  -> {"id": 12, "method": "location.set", "params": {...}}
  respuesta <- {"id": 12, "ok": true, "result": {...}}
              {"id": 12, "ok": false, "error": {"code": "...", "message": "..."}}
  evento    <- {"event": "device.attached", "data": {...}}

stdout queda reservado para el protocolo; cualquier traza de diagnóstico va a
stderr o se emite como evento `log`.
"""

from __future__ import annotations

import json
import sys
import threading
import traceback
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable

from .errors import classify

Handler = Callable[[dict], Any]


class RpcServer:
    def __init__(self, workers: int = 6) -> None:
        self._handlers: dict[str, Handler] = {}
        self._write_lock = threading.Lock()
        self._pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="rpc")
        self._stopped = threading.Event()

    # ---------------------------------------------------------------- registro
    def method(self, name: str) -> Callable[[Handler], Handler]:
        def decorator(fn: Handler) -> Handler:
            self._handlers[name] = fn
            return fn

        return decorator

    def register(self, name: str, fn: Handler) -> None:
        self._handlers[name] = fn

    # ---------------------------------------------------------------- salida
    def _write(self, payload: dict) -> None:
        line = json.dumps(payload, default=str, ensure_ascii=False)
        with self._write_lock:
            try:
                sys.stdout.write(line + "\n")
                sys.stdout.flush()
            except (BrokenPipeError, ValueError):
                # Electron cerró el pipe: nos vamos ordenadamente.
                self._stopped.set()

    def emit(self, event: str, data: Any = None) -> None:
        """Envía un evento push al proceso principal."""
        self._write({"event": event, "data": data})

    def log(self, level: str, scope: str, message: str) -> None:
        self.emit("log", {"level": level, "scope": scope, "message": message})

    # ---------------------------------------------------------------- entrada
    def _dispatch(self, request: dict) -> None:
        req_id = request.get("id")
        method = request.get("method", "")
        params = request.get("params") or {}

        handler = self._handlers.get(method)
        if handler is None:
            self._write(
                {
                    "id": req_id,
                    "ok": False,
                    "error": {"code": "UNKNOWN", "message": f"Método desconocido: {method}"},
                }
            )
            return

        try:
            result = handler(params)
            self._write({"id": req_id, "ok": True, "result": result})
        except BaseException as exc:  # noqa: BLE001 - el sidecar nunca debe morir
            err = classify(exc)
            self.log("error", method, f"{err.code}: {err.message}")
            if err.code == "UNKNOWN":
                self.log("debug", method, traceback.format_exc(limit=6))
            self._write({"id": req_id, "ok": False, "error": err.to_dict()})

    def serve_forever(self) -> None:
        """Bucle de lectura. Bloquea hasta EOF en stdin."""
        for raw in sys.stdin:
            if self._stopped.is_set():
                break
            raw = raw.strip()
            if not raw:
                continue
            try:
                request = json.loads(raw)
            except json.JSONDecodeError:
                self.log("warn", "rpc", f"Línea no válida descartada: {raw[:120]}")
                continue

            # Las llamadas se ejecutan en un pool: un montaje de DDI (lento)
            # no puede bloquear el streaming de coordenadas.
            self._pool.submit(self._dispatch, request)

        self._stopped.set()

    def shutdown(self) -> None:
        self._stopped.set()
        self._pool.shutdown(wait=False, cancel_futures=True)

    @property
    def stopped(self) -> threading.Event:
        return self._stopped
