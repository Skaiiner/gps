import { EventEmitter } from 'node:events'
import type {
  HumanizeSettings,
  JoystickVector,
  LatLng,
  RouteOptions,
  RoutePlan,
  SimulationMode,
  SimulationState
} from '@shared/types'
import {
  bearing,
  densify,
  destinationPoint,
  distanceMeters,
  gaussian,
  indexPolyline,
  jitter,
  kmhToMs,
  pointAtDistance,
  type PolylineIndex
} from '@shared/geo'
import type { PythonBridge } from '../bridge/PythonBridge'

/** 10 Hz: suficiente para que el punto azul se mueva sin escalones. */
const TICK_MS = 100
/** Cadencia máxima de escritura al dispositivo. */
const MIN_DEVICE_INTERVAL_MS = 100

export const DEFAULT_HUMANIZE: HumanizeSettings = {
  enabled: true,
  jitterMeters: 3,
  speedVariance: 0.12,
  pausesEnabled: false,
  pauseChance: 0.004
}

interface EngineEvents {
  tick: (state: SimulationState) => void
  ended: (payload: { reason: 'completed' | 'stopped' | 'error'; error?: unknown }) => void
}

export declare interface LocationEngine {
  on<E extends keyof EngineEvents>(event: E, listener: EngineEvents[E]): this
  emit<E extends keyof EngineEvents>(event: E, ...args: Parameters<EngineEvents[E]>): boolean
}

/**
 * Motor de movimiento. Vive en el proceso principal (no en el renderer) para
 * que la ruta siga avanzando con la ventana minimizada o el mapa sin foco, y
 * para que un repintado pesado de React no introduzca jitter temporal en el
 * envío de coordenadas.
 */
export class LocationEngine extends EventEmitter {
  private timer: NodeJS.Timeout | null = null
  private lastTickAt = 0
  private lastDeviceSendAt = 0

  private mode: SimulationMode = 'idle'
  private path: PolylineIndex | null = null
  private traveled = 0
  private direction: 1 | -1 = 1
  private options: RouteOptions = {
    speedKmh: 5,
    profile: 'walk',
    loop: false,
    pingPong: false,
    humanize: DEFAULT_HUMANIZE
  }

  private position: LatLng | null = null
  private heading = 0
  private instantSpeedKmh = 0
  private joystick: JoystickVector = { heading: 0, magnitude: 0 }
  private paused = false
  private pauseUntil = 0

  constructor(private readonly bridge: PythonBridge) {
    super()
  }

  // ------------------------------------------------------------------ estado
  get snapshot(): SimulationState {
    const total = this.path?.totalMeters ?? 0
    const remaining = this.path ? Math.max(0, total - this.traveled) : 0
    const speedMs = kmhToMs(this.instantSpeedKmh)
    return {
      mode: this.mode,
      active: this.timer !== null || this.mode === 'teleport',
      current: this.position,
      heading: this.heading,
      speedKmh: Number(this.instantSpeedKmh.toFixed(1)),
      progress: total > 0 ? Math.min(1, this.traveled / total) : 0,
      distanceRemainingMeters: remaining,
      etaSeconds: speedMs > 0.1 ? remaining / speedMs : Infinity,
      paused: this.paused
    }
  }

  get currentPosition(): LatLng | null {
    return this.position
  }

  // --------------------------------------------------------------- teleport
  /** Salto instantáneo. No arranca el bucle: sólo fija el punto. */
  async teleport(point: LatLng): Promise<void> {
    this.stopLoop()
    this.mode = 'teleport'
    this.path = null
    this.traveled = 0
    this.position = point
    this.instantSpeedKmh = 0
    this.paused = false
    await this.sendToDevice(point, true)
    this.emit('tick', this.snapshot)
  }

  // ------------------------------------------------------------------ rutas
  /**
   * Arranca el recorrido de una polilínea. Se densifica a 20 m por segmento
   * para que la interpolación no "corte curvas" en tramos largos de OSRM.
   */
  startRoute(plan: RoutePlan, options: RouteOptions, mode: SimulationMode = 'multi-spot'): void {
    if (plan.polyline.length < 2) {
      throw new Error('La ruta necesita al menos dos puntos.')
    }

    this.options = { ...options, humanize: { ...DEFAULT_HUMANIZE, ...options.humanize } }
    this.path = indexPolyline(densify(plan.polyline, 20))
    this.traveled = 0
    this.direction = 1
    this.mode = mode
    this.paused = false
    this.pauseUntil = 0

    const start = pointAtDistance(this.path, 0)
    this.position = start.position
    this.heading = start.heading
    this.instantSpeedKmh = this.options.speedKmh

    this.startLoop()
  }

  updateOptions(partial: Partial<RouteOptions>): void {
    this.options = {
      ...this.options,
      ...partial,
      humanize: { ...this.options.humanize, ...(partial.humanize ?? {}) }
    }
  }

  pause(): void {
    this.paused = true
    this.instantSpeedKmh = 0
    this.emit('tick', this.snapshot)
  }

  resume(): void {
    this.paused = false
    this.pauseUntil = 0
    this.lastTickAt = Date.now()
    this.emit('tick', this.snapshot)
  }

  // --------------------------------------------------------------- joystick
  startJoystick(origin?: LatLng): void {
    const start = origin ?? this.position
    if (!start) throw new Error('Fija una ubicación antes de usar el joystick.')
    this.mode = 'joystick'
    this.path = null
    this.position = start
    this.paused = false
    this.joystick = { heading: this.heading, magnitude: 0 }
    this.startLoop()
  }

  setJoystick(vector: JoystickVector): void {
    this.joystick = {
      heading: ((vector.heading % 360) + 360) % 360,
      magnitude: Math.max(0, Math.min(1, vector.magnitude))
    }
    if (this.joystick.magnitude > 0) this.heading = this.joystick.heading
  }

  // ------------------------------------------------------------------ bucle
  private startLoop(): void {
    this.stopLoop()
    this.lastTickAt = Date.now()
    this.timer = setInterval(() => {
      void this.tick()
    }, TICK_MS)
    this.emit('tick', this.snapshot)
  }

  private stopLoop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  stop(reason: 'completed' | 'stopped' | 'error' = 'stopped'): void {
    this.stopLoop()
    this.mode = 'idle'
    this.instantSpeedKmh = 0
    this.joystick = { heading: this.heading, magnitude: 0 }
    this.emit('tick', this.snapshot)
    this.emit('ended', { reason })
  }

  private async tick(): Promise<void> {
    const now = Date.now()
    const dt = Math.min(0.5, (now - this.lastTickAt) / 1000) // clamp anti-salto tras suspensión
    this.lastTickAt = now

    if (this.paused) return

    if (this.mode === 'joystick') {
      this.tickJoystick(dt)
    } else if (this.path) {
      const finished = this.tickRoute(dt, now)
      if (finished) return
    } else {
      return
    }

    if (!this.position) return
    await this.sendToDevice(this.position)
    this.emit('tick', this.snapshot)
  }

  private tickJoystick(dt: number): void {
    const { magnitude, heading } = this.joystick
    if (magnitude <= 0 || !this.position) {
      this.instantSpeedKmh = 0
      return
    }
    this.instantSpeedKmh = this.effectiveSpeedKmh() * magnitude
    const step = kmhToMs(this.instantSpeedKmh) * dt
    this.position = destinationPoint(this.position, heading, step)
    this.heading = heading
  }

  /** @returns true si el recorrido terminó en este tick. */
  private tickRoute(dt: number, now: number): boolean {
    const path = this.path!
    const { humanize } = this.options

    // Micro-pausas: un peatón real se para en cruces y semáforos.
    if (humanize.enabled && humanize.pausesEnabled) {
      if (now < this.pauseUntil) {
        this.instantSpeedKmh = 0
        return false
      }
      if (Math.random() < humanize.pauseChance) {
        this.pauseUntil = now + 2000 + Math.random() * 8000
        this.instantSpeedKmh = 0
        return false
      }
    }

    this.instantSpeedKmh = this.effectiveSpeedKmh()
    this.traveled += kmhToMs(this.instantSpeedKmh) * dt * this.direction

    if (this.traveled >= path.totalMeters) {
      if (this.options.pingPong) {
        this.traveled = path.totalMeters
        this.direction = -1
      } else if (this.options.loop) {
        this.traveled = 0
      } else {
        this.traveled = path.totalMeters
        const end = pointAtDistance(path, this.traveled)
        this.position = end.position
        void this.sendToDevice(end.position, true)
        this.emit('tick', this.snapshot)
        this.stop('completed')
        return true
      }
    } else if (this.traveled <= 0 && this.direction === -1) {
      if (this.options.pingPong) {
        this.traveled = 0
        this.direction = 1
      } else {
        this.traveled = 0
      }
    }

    const at = pointAtDistance(path, this.traveled)
    this.position = at.position
    this.heading = this.direction === 1 ? at.heading : (at.heading + 180) % 360
    return false
  }

  /**
   * Velocidad instantánea con fluctuación gaussiana. Un valor perfectamente
   * constante durante kilómetros es la señal más obvia de simulación: ningún
   * desplazamiento humano mantiene ±0.0 km/h.
   */
  private effectiveSpeedKmh(): number {
    const base = this.options.speedKmh
    const { humanize } = this.options
    if (!humanize.enabled || humanize.speedVariance <= 0) return base
    const factor = 1 + gaussian(0, humanize.speedVariance)
    return Math.max(base * 0.35, Math.min(base * 1.65, base * factor))
  }

  /** Aplica jitter y empuja el punto al dispositivo respetando la cadencia. */
  private async sendToDevice(point: LatLng, force = false): Promise<void> {
    const now = Date.now()
    if (!force && now - this.lastDeviceSendAt < MIN_DEVICE_INTERVAL_MS) return
    this.lastDeviceSendAt = now

    const { humanize } = this.options
    const outgoing =
      humanize.enabled && humanize.jitterMeters > 0 && this.mode !== 'teleport'
        ? jitter(point, humanize.jitterMeters)
        : point

    // notify() en vez de call(): a 10 Hz, esperar el ACK de cada punto sólo
    // añadiría latencia; los errores reales llegan por el evento location.error.
    this.bridge.notify('location.set', { lat: outgoing.lat, lng: outgoing.lng })
  }

  /** Reposiciona el marcador sin mover el dispositivo (arrastre en el mapa). */
  setPositionSilently(point: LatLng): void {
    if (this.position) this.heading = bearing(this.position, point)
    this.position = point
  }

  /** Salta a un porcentaje de la ruta (scrub de la barra de progreso). */
  seek(progress: number): void {
    if (!this.path) return
    this.traveled = Math.max(0, Math.min(1, progress)) * this.path.totalMeters
    const at = pointAtDistance(this.path, this.traveled)
    this.position = at.position
    this.heading = at.heading
    void this.sendToDevice(at.position, true)
    this.emit('tick', this.snapshot)
  }

  /** Longitud total de la ruta cargada, en metros. */
  get pathLength(): number {
    return this.path?.totalMeters ?? 0
  }

  /** Distancia entre dos puntos, expuesta para la capa IPC. */
  static distance(a: LatLng, b: LatLng): number {
    return distanceMeters(a, b)
  }
}
