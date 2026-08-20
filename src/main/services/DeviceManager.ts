import { EventEmitter } from 'node:events'
import type { BridgeError, ConnectionState, DeviceInfo } from '@shared/types'
import { BridgeCallError, PythonBridge } from '../bridge/PythonBridge'

interface PrepareResult {
  state: ConnectionState
  device: DeviceInfo
  tunnel?: { running: boolean; deviceTunneled?: boolean; manualCommand: string }
}

/**
 * Estado de conexión de alto nivel. Encapsula la secuencia
 * detectar → confiar → Modo Desarrollador → montar DDI → (túnel) → listo
 * y expone un único `ConnectionState` que la UI traduce a una pantalla.
 */
export class DeviceManager extends EventEmitter {
  private devices = new Map<string, DeviceInfo>()
  private states = new Map<string, ConnectionState>()
  private activeUdid: string | null = null
  private preparing = new Set<string>()

  constructor(private readonly bridge: PythonBridge) {
    super()
    this.bindBridgeEvents()
  }

  private bindBridgeEvents(): void {
    this.bridge.on('event', (name: string, data: unknown) => {
      switch (name) {
        case 'device.attached': {
          const device = data as DeviceInfo
          this.devices.set(device.udid, device)
          this.emit('attached', device)
          this.emit('list', this.list())
          // Auto-selección: con un solo iPhone conectado no tiene sentido
          // obligar al usuario a elegirlo de una lista de uno.
          if (!this.activeUdid) void this.select(device.udid)
          break
        }
        case 'device.updated': {
          const device = data as DeviceInfo
          const previous = this.devices.get(device.udid)
          this.devices.set(device.udid, device)
          this.emit('list', this.list())
          // Si acaba de confiar o de activar el Modo Desarrollador,
          // reintentamos la preparación sin intervención del usuario.
          const unblocked =
            previous &&
            ((previous.trust !== 'trusted' && device.trust === 'trusted') ||
              (previous.developerModeEnabled === false && device.developerModeEnabled === true))
          if (unblocked && device.udid === this.activeUdid) {
            void this.prepare(device.udid)
          }
          break
        }
        case 'device.detached': {
          const { udid } = data as { udid: string }
          this.devices.delete(udid)
          this.states.delete(udid)
          if (this.activeUdid === udid) this.activeUdid = null
          this.emit('detached', { udid })
          this.emit('list', this.list())
          break
        }
        case 'device.state': {
          const payload = data as { udid: string; state: ConnectionState }
          this.setState(payload.udid, payload.state)
          break
        }
        default:
          break
      }
    })
  }

  // ------------------------------------------------------------------ lectura
  list(): DeviceInfo[] {
    return [...this.devices.values()]
  }

  get active(): DeviceInfo | null {
    return this.activeUdid ? (this.devices.get(this.activeUdid) ?? null) : null
  }

  get activeId(): string | null {
    return this.activeUdid
  }

  stateOf(udid: string): ConnectionState {
    return this.states.get(udid) ?? 'waiting'
  }

  private setState(udid: string, state: ConnectionState, error?: BridgeError): void {
    if (this.states.get(udid) === state && !error) return
    this.states.set(udid, state)
    this.emit('state', { udid, state, error })
  }

  // ---------------------------------------------------------------- acciones
  /**
   * @param force Ignora la caché del watcher. Se usa cuando el usuario pulsa
   * «buscar de nuevo»: ahí espera una lectura real, no lo que ya sabíamos.
   */
  async refresh(force = false): Promise<DeviceInfo[]> {
    const devices = await this.bridge.call<DeviceInfo[]>('devices.list', { force })
    this.devices = new Map(devices.map((d) => [d.udid, d]))
    if (this.activeUdid && !this.devices.has(this.activeUdid)) this.activeUdid = null
    if (!this.activeUdid && devices.length > 0) this.activeUdid = devices[0].udid
    this.emit('list', devices)
    return devices
  }

  async startWatching(): Promise<void> {
    await this.bridge.call('devices.watch')
  }

  async select(udid: string): Promise<PrepareResult> {
    this.activeUdid = udid
    return this.prepare(udid)
  }

  /** Recorre la secuencia de preparación y publica el primer bloqueo. */
  async prepare(udid: string, autoMount = true): Promise<PrepareResult> {
    if (this.preparing.has(udid)) {
      return { state: this.stateOf(udid), device: this.devices.get(udid)! }
    }
    this.preparing.add(udid)

    try {
      const result = await this.bridge.call<PrepareResult>('device.prepare', { udid, autoMount })
      this.devices.set(udid, result.device)
      this.setState(udid, result.state)
      this.emit('list', this.list())
      this.emit('prepared', result)
      return result
    } catch (error) {
      const bridgeError =
        error instanceof BridgeCallError
          ? error.toJSON()
          : { code: 'UNKNOWN' as const, message: (error as Error).message }

      const state = mapErrorToState(bridgeError.code)
      this.setState(udid, state, bridgeError)
      throw error
    } finally {
      this.preparing.delete(udid)
    }
  }

  /** Dispara el diálogo «Confiar en este ordenador». */
  async pair(udid: string): Promise<void> {
    await this.bridge.call('device.pair', { udid })
    await this.prepare(udid)
  }

  /** Activa el Modo Desarrollador (iOS 16+). El iPhone se reinicia. */
  async enableDeveloperMode(udid: string): Promise<{ rebootRequired: boolean }> {
    const result = await this.bridge.call<{ rebootRequired: boolean }>('developerMode.enable', {
      udid
    })
    this.setState(udid, 'dev-mode-required')
    return result
  }

  async revealDeveloperMode(udid: string): Promise<void> {
    await this.bridge.call('developerMode.reveal', { udid })
  }

  async mountImage(udid: string): Promise<void> {
    this.setState(udid, 'mounting')
    await this.bridge.call('ddi.mount', { udid })
    await this.prepare(udid, false)
  }

  async startTunnel(): Promise<void> {
    await this.bridge.call('tunnel.start')
    if (this.activeUdid) await this.prepare(this.activeUdid)
  }

  async tunnelStatus(): Promise<{ running: boolean; manualCommand: string }> {
    return this.bridge.call('tunnel.status', { udid: this.activeUdid ?? undefined })
  }
}

function mapErrorToState(code: string): ConnectionState {
  switch (code) {
    case 'NOT_TRUSTED':
      return 'untrusted'
    case 'PASSWORD_REQUIRED':
      return 'locked'
    case 'DEVELOPER_MODE_DISABLED':
      return 'dev-mode-required'
    case 'TUNNEL_REQUIRED':
    case 'TUNNEL_START_FAILED':
      return 'tunnel-required'
    case 'DEVICE_NOT_FOUND':
      return 'waiting'
    case 'PYTHON_MISSING':
    case 'PYMOBILEDEVICE3_MISSING':
    case 'USBMUXD_UNAVAILABLE':
      return 'bridge-error'
    default:
      return 'waiting'
  }
}
