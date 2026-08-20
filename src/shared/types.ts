/**
 * Contratos compartidos entre main, preload y renderer.
 * Todo lo que cruza IPC vive aquí.
 */

export interface LatLng {
  lat: number
  lng: number
}

export type ConnectionState =
  | 'bridge-starting' // arrancando el sidecar python
  | 'bridge-error' // el sidecar no arrancó (falta pymobiledevice3, etc.)
  | 'waiting' // sidecar vivo, sin iPhone conectado
  | 'untrusted' // iPhone conectado pero sin "Confiar en este ordenador"
  | 'locked' // iPhone conectado con código de bloqueo activo
  | 'dev-mode-required' // iOS 16+ sin Modo Desarrollador
  | 'tunnel-required' // iOS 17+ sin túnel RSD activo
  | 'mounting' // montando DeveloperDiskImage
  | 'ready' // listo para inyectar coordenadas
  | 'simulating' // sesión de simulación abierta

export type DeviceTrust = 'trusted' | 'untrusted' | 'password-protected' | 'unknown'

export interface DeviceInfo {
  udid: string
  name: string
  productType: string // iPhone15,2
  productVersion: string // 17.5.1
  buildVersion: string
  deviceClass: string
  connectionType: 'USB' | 'Network'
  /** Mayor de productVersion, para decidir el camino DVT/RSD. */
  majorVersion: number
  trust: DeviceTrust
  /** iOS 16+. null si no aplica (iOS < 16). */
  developerModeEnabled: boolean | null
  /** DeveloperDiskImage / Personalized DDI ya montado. */
  ddiMounted: boolean
  batteryLevel?: number | null
}

export interface BridgeStatus {
  running: boolean
  pythonPath: string | null
  pymobiledevice3Version: string | null
  /** iOS 17+ necesita tunneld corriendo con privilegios de root. */
  tunneldRunning: boolean
  lastError: string | null
}

export type SimulationMode = 'idle' | 'teleport' | 'two-spot' | 'multi-spot' | 'joystick'

export type MovementProfile = 'walk' | 'run' | 'bike' | 'car' | 'custom'

/** km/h por perfil — coincide con los presets de las herramientas comerciales. */
export const PROFILE_SPEEDS: Record<Exclude<MovementProfile, 'custom'>, number> = {
  walk: 5,
  run: 10,
  bike: 15,
  car: 60
}

export interface HumanizeSettings {
  enabled: boolean
  /** Desviación estándar del ruido posicional, en metros (0–15). */
  jitterMeters: number
  /** Fluctuación de velocidad como fracción de la velocidad base (0–0.5). */
  speedVariance: number
  /** Micro-pausas aleatorias (semáforos, esperas). */
  pausesEnabled: boolean
  /** Probabilidad por tick de iniciar una pausa (0–0.02). */
  pauseChance: number
}

export interface RouteOptions {
  /** km/h efectivos. */
  speedKmh: number
  profile: MovementProfile
  /** Repetir la ruta al llegar al final. */
  loop: boolean
  /** Al llegar al final, volver por donde vino. */
  pingPong: boolean
  humanize: HumanizeSettings
}

export interface RoutePlan {
  /** Puntos que el usuario marcó en el mapa. */
  waypoints: LatLng[]
  /** Polilínea resuelta (calles reales vía OSRM, o línea recta como fallback). */
  polyline: LatLng[]
  distanceMeters: number
  /** 'osrm' = ruta por calles; 'straight' = interpolación en línea recta. */
  source: 'osrm' | 'straight'
  profileUsed?: string
}

export interface SimulationState {
  mode: SimulationMode
  active: boolean
  current: LatLng | null
  /** Grados, 0 = norte. */
  heading: number
  /** km/h instantáneos (con fluctuación aplicada). */
  speedKmh: number
  /** 0–1 dentro de la polilínea actual. */
  progress: number
  distanceRemainingMeters: number
  etaSeconds: number
  paused: boolean
}

export interface JoystickVector {
  /** Grados, 0 = norte, sentido horario. */
  heading: number
  /** 0–1, magnitud del stick. */
  magnitude: number
}

export interface Place {
  id: string
  label: string
  address?: string
  lat: number
  lng: number
}

export interface FavoriteRoute {
  id: string
  name: string
  waypoints: LatLng[]
  createdAt: number
  distanceMeters: number
}

export interface HistoryEntry {
  id: string
  lat: number
  lng: number
  label: string
  usedAt: number
}

export interface LogLine {
  ts: number
  level: 'debug' | 'info' | 'warn' | 'error'
  scope: string
  message: string
}

/** Errores tipados que la UI traduce a instrucciones accionables. */
export type BridgeErrorCode =
  | 'PYTHON_MISSING'
  | 'PYMOBILEDEVICE3_MISSING'
  | 'USBMUXD_UNAVAILABLE'
  | 'DEVICE_NOT_FOUND'
  | 'NOT_TRUSTED'
  | 'PASSWORD_REQUIRED'
  | 'DEVELOPER_MODE_DISABLED'
  | 'DDI_MOUNT_FAILED'
  | 'DDI_NOT_FOUND'
  | 'TUNNEL_REQUIRED'
  | 'TUNNEL_START_FAILED'
  | 'SERVICE_UNAVAILABLE'
  | 'PERMISSION_DENIED'
  | 'UNKNOWN'

export interface BridgeError {
  code: BridgeErrorCode
  message: string
  detail?: string
}

/** Eventos push del main hacia el renderer. */
export interface IpcEvents {
  'bridge:status': BridgeStatus
  'device:list': DeviceInfo[]
  'device:attached': DeviceInfo
  'device:detached': { udid: string }
  'device:state': { udid: string; state: ConnectionState; error?: BridgeError }
  'sim:tick': SimulationState
  'sim:ended': { reason: 'completed' | 'stopped' | 'error'; error?: BridgeError }
  'log:line': LogLine
}

export type IpcEventName = keyof IpcEvents
