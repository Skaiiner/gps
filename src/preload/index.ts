import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  BridgeError,
  BridgeStatus,
  DeviceInfo,
  FavoriteRoute,
  HistoryEntry,
  JoystickVector,
  LatLng,
  MovementProfile,
  Place,
  RouteOptions,
  RoutePlan,
  SimulationMode,
  SimulationState
} from '@shared/types'

interface Envelope<T> {
  ok: boolean
  data?: T
  error?: BridgeError
}

/** Error de IPC que conserva el código para que la UI muestre la ayuda correcta. */
export class GeoPilotError extends Error {
  readonly code: string
  readonly detail?: string

  constructor(error: BridgeError) {
    super(error.message)
    this.name = 'GeoPilotError'
    this.code = error.code
    this.detail = error.detail
  }
}

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, ...args)) as Envelope<T>
  if (!result.ok) {
    throw new GeoPilotError(result.error ?? { code: 'UNKNOWN', message: 'Error desconocido' })
  }
  return result.data as T
}

/** Suscripción con función de baja incluida, para usar en useEffect. */
function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  bridge: {
    status: () => invoke<BridgeStatus>('bridge:status'),
    restart: () => invoke<boolean>('bridge:restart')
  },

  devices: {
    list: () => invoke<DeviceInfo[]>('devices:list'),
    refresh: () => invoke<DeviceInfo[]>('devices:refresh'),
    select: (udid: string) => invoke<{ state: string; device: DeviceInfo }>('device:select', udid),
    prepare: (udid: string) =>
      invoke<{ state: string; device: DeviceInfo }>('device:prepare', udid),
    pair: (udid: string) => invoke<void>('device:pair', udid),
    enableDeveloperMode: (udid: string) =>
      invoke<{ rebootRequired: boolean }>('device:enableDevMode', udid),
    revealDeveloperMode: (udid: string) => invoke<void>('device:revealDevMode', udid),
    mountImage: (udid: string) => invoke<void>('device:mountImage', udid)
  },

  tunnel: {
    status: () => invoke<{ running: boolean; manualCommand: string }>('tunnel:status'),
    start: () => invoke<void>('tunnel:start')
  },

  sim: {
    /** Interruptor general: abre la sesión y restaura el último punto. */
    connect: () => invoke<{ open: boolean; state: SimulationState }>('sim:connect'),
    /** Cierra el canal; el iPhone vuelve a su GPS real. */
    disconnect: () => invoke<{ open: boolean; state: SimulationState }>('sim:disconnect'),
    sessionStatus: () => invoke<{ open: boolean }>('sim:sessionStatus'),

    teleport: (point: LatLng, label?: string) =>
      invoke<SimulationState>('sim:teleport', point, label),
    startRoute: (plan: RoutePlan, options: RouteOptions, mode?: SimulationMode) =>
      invoke<SimulationState>('sim:startRoute', plan, options, mode),
    startJoystick: (origin?: LatLng) => invoke<SimulationState>('sim:startJoystick', origin),
    /** Alta frecuencia: sin round-trip. */
    setJoystick: (vector: JoystickVector) => ipcRenderer.send('sim:setJoystick', vector),
    updateOptions: (partial: Partial<RouteOptions>) =>
      invoke<SimulationState>('sim:updateOptions', partial),
    pause: () => invoke<SimulationState>('sim:pause'),
    resume: () => invoke<SimulationState>('sim:resume'),
    seek: (progress: number) => invoke<SimulationState>('sim:seek', progress),
    stop: (reset = true) => invoke<SimulationState>('sim:stop', reset),
    status: () => invoke<SimulationState>('sim:status')
  },

  route: {
    search: (query: string) => invoke<Place[]>('route:search', query),
    reverse: (point: LatLng) => invoke<Place | null>('route:reverse', point),
    build: (waypoints: LatLng[], profile: MovementProfile, snapToRoads = true) =>
      invoke<RoutePlan>('route:build', waypoints, profile, snapToRoads)
  },

  storage: {
    favorites: () => invoke<Place[]>('storage:favorites'),
    addFavorite: (place: Place) => invoke<Place[]>('storage:addFavorite', place),
    removeFavorite: (id: string) => invoke<Place[]>('storage:removeFavorite', id),
    routes: () => invoke<FavoriteRoute[]>('storage:routes'),
    saveRoute: (name: string, waypoints: LatLng[]) =>
      invoke<FavoriteRoute[]>('storage:saveRoute', name, waypoints),
    removeRoute: (id: string) => invoke<FavoriteRoute[]>('storage:removeRoute', id),
    history: () => invoke<HistoryEntry[]>('storage:history'),
    clearHistory: () => invoke<HistoryEntry[]>('storage:clearHistory'),
    settings: () => invoke<Record<string, unknown>>('storage:settings'),
    updateSettings: (partial: Record<string, unknown>) =>
      invoke<Record<string, unknown>>('storage:updateSettings', partial)
  },

  gpx: {
    import: () =>
      invoke<{ name: string; points: LatLng[]; waypoints: LatLng[]; fileName: string } | null>(
        'gpx:import'
      ),
    export: (name: string, points: LatLng[], waypoints: LatLng[]) =>
      invoke<string | null>('gpx:export', name, points, waypoints)
  },

  system: {
    openExternal: (url: string) => invoke<void>('shell:openExternal', url),
    copy: (text: string) => invoke<boolean>('app:copyToClipboard', text)
  },

  on: {
    bridgeStatus: (cb: (s: BridgeStatus) => void) => subscribe('bridge:status', cb),
    deviceList: (cb: (d: DeviceInfo[]) => void) => subscribe('device:list', cb),
    deviceAttached: (cb: (d: DeviceInfo) => void) => subscribe('device:attached', cb),
    deviceDetached: (cb: (d: { udid: string }) => void) => subscribe('device:detached', cb),
    deviceState: (cb: (d: { udid: string; state: string; error?: BridgeError }) => void) =>
      subscribe('device:state', cb),
    ddiProgress: (cb: (d: { udid: string; message: string }) => void) =>
      subscribe('ddi:progress', cb),
    simTick: (cb: (s: SimulationState) => void) => subscribe('sim:tick', cb),
    simSession: (cb: (d: { udid: string; state: 'open' | 'closed'; backend?: string }) => void) =>
      subscribe('sim:session', cb),
    simEnded: (cb: (p: { reason: string; error?: unknown }) => void) => subscribe('sim:ended', cb),
    log: (cb: (l: { ts: number; level: string; scope: string; message: string }) => void) =>
      subscribe('log:line', cb)
  },

  platform: process.platform
}

export type GeoPilotApi = typeof api

contextBridge.exposeInMainWorld('geopilot', api)
