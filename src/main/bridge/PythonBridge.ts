import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { createInterface, type Interface } from 'node:readline'
import type { BridgeError, BridgeErrorCode } from '@shared/types'
import { resolveRuntime, type ResolvedRuntime } from './pythonResolver'

interface PendingCall {
  resolve: (value: unknown) => void
  reject: (error: BridgeCallError) => void
  method: string
  timer: NodeJS.Timeout
}

export class BridgeCallError extends Error {
  readonly code: BridgeErrorCode
  readonly detail?: string

  constructor(error: BridgeError) {
    super(error.message)
    this.name = 'BridgeCallError'
    this.code = error.code
    this.detail = error.detail
  }

  toJSON(): BridgeError {
    return { code: this.code, message: this.message, detail: this.detail }
  }
}

/** Métodos que pueden tardar (descargas, TSS, reinicios) y necesitan más margen. */
const LONG_METHODS = new Set([
  'ddi.mount',
  'ddi.mountLocal',
  'device.prepare',
  'device.pair',
  'developerMode.enable',
  'tunnel.start',
  'location.start'
])
const DEFAULT_TIMEOUT_MS = 15_000
const LONG_TIMEOUT_MS = 180_000
const RESTART_DELAY_MS = 1_500
const MAX_RESTARTS = 5

/**
 * Cliente del sidecar Python. Traduce llamadas a JSON por stdin y reparte las
 * respuestas por id; los mensajes sin id son eventos push (`bridge:event`).
 *
 * Se reinicia solo si el proceso muere, porque un crash del sidecar durante una
 * ruta activa no debe tumbar la aplicación entera.
 */
export class PythonBridge extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null
  private reader: Interface | null = null
  private pending = new Map<number, PendingCall>()
  private nextId = 1
  private restarts = 0
  private runtime: ResolvedRuntime | null = null
  private intentionalStop = false
  private startupError: string | null = null
  private stopping: Promise<void> | null = null

  get running(): boolean {
    return this.child !== null && !this.child.killed
  }

  get runtimeInfo(): ResolvedRuntime | null {
    return this.runtime
  }

  get lastError(): string | null {
    return this.startupError
  }

  start(): void {
    if (this.running) return
    this.intentionalStop = false

    try {
      this.runtime = resolveRuntime()
    } catch (error) {
      this.startupError = (error as Error).message
      this.emit('fatal', {
        code: 'PYTHON_MISSING' as BridgeErrorCode,
        message: this.startupError
      })
      return
    }

    const child = spawn(this.runtime.command, this.runtime.args, {
      cwd: this.runtime.cwd,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        PYTHONIOENCODING: 'utf-8',
        // El sidecar necesita saber qué intérprete usar si tiene que
        // relanzar tunneld con privilegios.
        ...(this.runtime.interpreter ? { GEOPILOT_PYTHON: this.runtime.interpreter } : {})
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })

    this.child = child
    this.startupError = null

    this.reader = createInterface({ input: child.stdout })
    this.reader.on('line', (line) => this.handleLine(line))

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim()
      if (text) this.emit('stderr', text)
    })

    child.on('error', (error) => {
      this.startupError = error.message
      this.emit('fatal', { code: 'PYTHON_MISSING' as BridgeErrorCode, message: error.message })
    })

    child.on('exit', (code, signal) => this.handleExit(code, signal))

    this.emit('started', this.runtime)
  }

  private handleLine(line: string): void {
    let message: Record<string, unknown>
    try {
      message = JSON.parse(line)
    } catch {
      this.emit('stderr', `Línea no JSON del sidecar: ${line.slice(0, 200)}`)
      return
    }

    if (typeof message.event === 'string') {
      this.emit('event', message.event, message.data)
      return
    }

    // id null = respuesta a un `notify`, que nadie está esperando.
    const id = message.id as number | null | undefined
    if (id === undefined || id === null) return

    const call = this.pending.get(id)
    if (!call) return
    this.pending.delete(id)
    clearTimeout(call.timer)

    if (message.ok) {
      call.resolve(message.result)
    } else {
      const error = (message.error as BridgeError) ?? {
        code: 'UNKNOWN' as BridgeErrorCode,
        message: 'Error desconocido del sidecar'
      }
      call.reject(new BridgeCallError(error))
    }
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.reader?.close()
    this.reader = null
    this.child = null

    const reason = `El sidecar terminó (code=${code}, signal=${signal})`
    for (const [id, call] of this.pending) {
      clearTimeout(call.timer)
      call.reject(new BridgeCallError({ code: 'UNKNOWN', message: reason, detail: call.method }))
      this.pending.delete(id)
    }

    this.emit('exited', { code, signal })

    if (this.intentionalStop) return

    if (this.restarts < MAX_RESTARTS) {
      this.restarts += 1
      this.emit('stderr', `${reason}; reintentando (${this.restarts}/${MAX_RESTARTS})…`)
      setTimeout(() => this.start(), RESTART_DELAY_MS)
    } else {
      this.startupError = `${reason}. Se agotaron los reintentos.`
      this.emit('fatal', { code: 'UNKNOWN' as BridgeErrorCode, message: this.startupError })
    }
  }

  call<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!this.child || !this.child.stdin.writable) {
      return Promise.reject(
        new BridgeCallError({
          code: 'PYTHON_MISSING',
          message: this.startupError ?? 'El puente con el dispositivo no está activo.'
        })
      )
    }

    const id = this.nextId++
    const timeoutMs = LONG_METHODS.has(method) ? LONG_TIMEOUT_MS : DEFAULT_TIMEOUT_MS

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(
          new BridgeCallError({
            code: 'UNKNOWN',
            message: `Tiempo de espera agotado en ${method}.`,
            detail: `${timeoutMs} ms`
          })
        )
      }, timeoutMs)

      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        method,
        timer
      })

      this.child!.stdin.write(`${JSON.stringify({ id, method, params })}\n`, (error) => {
        if (!error) return
        clearTimeout(timer)
        this.pending.delete(id)
        reject(new BridgeCallError({ code: 'UNKNOWN', message: error.message }))
      })
    })
  }

  /**
   * Envío sin respuesta para el flujo de alta frecuencia de coordenadas.
   * Esperar el ACK de cada punto añadiría un round-trip por tick sin aportar
   * nada: el sidecar ya descarta los puntos obsoletos.
   */
  notify(method: string, params: Record<string, unknown> = {}): void {
    if (!this.child?.stdin.writable) return
    this.child.stdin.write(`${JSON.stringify({ id: null, method, params })}\n`)
  }

  /**
   * Parada idempotente. Dos llamadas solapadas —el usuario pulsando «Reiniciar»
   * dos veces seguidas— compartían el mismo `this.child`: ambas lo mataban, cada
   * una arrancaba un sidecar nuevo y el segundo `stop()` acababa matando al que
   * el primero acababa de crear, dejando procesos huérfanos y el puente muerto.
   */
  stop(): Promise<void> {
    if (this.stopping) return this.stopping

    this.intentionalStop = true
    const child = this.child
    if (!child) return Promise.resolve()

    // Se desvincula ya, para que una llamada concurrente no vuelva a operar
    // sobre el mismo proceso.
    this.child = null

    this.stopping = (async () => {
      try {
        await this.callOn(child, 'shutdown').catch(() => undefined)
      } finally {
        child.stdin.end()
        // Margen para que cierre el socket de simulación (STOP al dispositivo).
        const killTimer = setTimeout(() => child.kill('SIGKILL'), 3_000)
        child.once('exit', () => clearTimeout(killTimer))
        child.kill('SIGTERM')
        this.stopping = null
      }
    })()

    return this.stopping
  }

  /** Envía a un proceso concreto, aunque ya no sea `this.child`. */
  private callOn(child: ChildProcessWithoutNullStreams, method: string): Promise<void> {
    if (!child.stdin.writable) return Promise.resolve()
    return new Promise((resolve) => {
      child.stdin.write(`${JSON.stringify({ id: null, method, params: {} })}\n`, () => resolve())
      setTimeout(resolve, 2_000)
    })
  }
}
