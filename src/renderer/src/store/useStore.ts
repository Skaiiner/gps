import { create } from 'zustand'
import type {
  BridgeStatus,
  ConnectionState,
  DeviceInfo,
  FavoriteRoute,
  HistoryEntry,
  HumanizeSettings,
  LatLng,
  MovementProfile,
  Place,
  RouteOptions,
  RoutePlan,
  SimulationMode,
  SimulationState
} from '@shared/types'
import { PROFILE_SPEEDS } from '@shared/types'

export interface Toast {
  id: number
  kind: 'info' | 'success' | 'warn' | 'error'
  title: string
  message?: string
}

const IDLE_SIM: SimulationState = {
  mode: 'idle',
  active: false,
  current: null,
  heading: 0,
  speedKmh: 0,
  progress: 0,
  distanceRemainingMeters: 0,
  etaSeconds: Infinity,
  paused: false
}

const DEFAULT_HUMANIZE: HumanizeSettings = {
  enabled: true,
  jitterMeters: 3,
  speedVariance: 0.12,
  pausesEnabled: false,
  pauseChance: 0.004
}

interface State {
  // --- puente y dispositivo
  bridge: BridgeStatus
  devices: DeviceInfo[]
  activeUdid: string | null
  connection: ConnectionState
  connectionError: { code: string; message: string; detail?: string } | null
  ddiMessage: string | null
  busy: boolean

  // --- modo de trabajo
  mode: SimulationMode
  waypoints: LatLng[]
  plan: RoutePlan | null
  snapToRoads: boolean
  profile: MovementProfile
  speedKmh: number
  loop: boolean
  pingPong: boolean
  humanize: HumanizeSettings

  // --- simulación en curso
  sim: SimulationState
  /** Canal de simulación abierto: el iPhone usa la ubicación falsa. */
  sessionOpen: boolean
  /** Hay una operación de conexión/desconexión en vuelo. */
  sessionBusy: boolean
  /** Aviso de zona horaria en pantalla. */
  showTimezoneNotice: boolean
  /** El usuario ya marcó «no volver a mostrar». */
  timezoneNoticeSeen: boolean

  // --- mapa
  center: LatLng
  zoom: number
  followMarker: boolean
  mapStyle: 'streets' | 'dark' | 'satellite'

  // --- biblioteca
  favorites: Place[]
  savedRoutes: FavoriteRoute[]
  history: HistoryEntry[]
  searchResults: Place[]
  searching: boolean

  toasts: Toast[]
  logs: { ts: number; level: string; scope: string; message: string }[]
}

interface Actions {
  setBridge: (s: Partial<BridgeStatus>) => void
  setDevices: (d: DeviceInfo[]) => void
  setActiveUdid: (udid: string | null) => void
  setConnection: (state: ConnectionState, error?: State['connectionError']) => void
  setDdiMessage: (message: string | null) => void
  setBusy: (busy: boolean) => void

  setMode: (mode: SimulationMode) => void
  addWaypoint: (point: LatLng) => void
  updateWaypoint: (index: number, point: LatLng) => void
  removeWaypoint: (index: number) => void
  setWaypoints: (points: LatLng[]) => void
  clearWaypoints: () => void
  setPlan: (plan: RoutePlan | null) => void

  setSnapToRoads: (value: boolean) => void
  setProfile: (profile: MovementProfile) => void
  setSpeed: (kmh: number) => void
  setLoop: (value: boolean) => void
  setPingPong: (value: boolean) => void
  setHumanize: (partial: Partial<HumanizeSettings>) => void

  setSim: (sim: SimulationState) => void
  setSessionOpen: (open: boolean) => void
  setSessionBusy: (busy: boolean) => void
  setShowTimezoneNotice: (show: boolean) => void
  setTimezoneNoticeSeen: (seen: boolean) => void
  setCenter: (center: LatLng, zoom?: number) => void
  setFollow: (value: boolean) => void
  setMapStyle: (style: State['mapStyle']) => void

  setFavorites: (list: Place[]) => void
  setSavedRoutes: (list: FavoriteRoute[]) => void
  setHistory: (list: HistoryEntry[]) => void
  setSearchResults: (list: Place[]) => void
  setSearching: (value: boolean) => void

  toast: (toast: Omit<Toast, 'id'>) => void
  dismissToast: (id: number) => void
  pushLog: (line: State['logs'][number]) => void

  routeOptions: () => RouteOptions
}

let toastId = 0

export const useStore = create<State & Actions>((set, get) => ({
  bridge: {
    running: false,
    pythonPath: null,
    pymobiledevice3Version: null,
    tunneldRunning: false,
    lastError: null
  },
  devices: [],
  activeUdid: null,
  connection: 'bridge-starting',
  connectionError: null,
  ddiMessage: null,
  busy: false,

  mode: 'teleport',
  waypoints: [],
  plan: null,
  snapToRoads: true,
  profile: 'walk',
  speedKmh: PROFILE_SPEEDS.walk,
  loop: false,
  pingPong: false,
  humanize: DEFAULT_HUMANIZE,

  sim: IDLE_SIM,
  sessionOpen: false,
  sessionBusy: false,
  showTimezoneNotice: false,
  timezoneNoticeSeen: false,

  center: { lat: 40.4168, lng: -3.7038 },
  zoom: 13,
  followMarker: true,
  mapStyle: 'streets',

  favorites: [],
  savedRoutes: [],
  history: [],
  searchResults: [],
  searching: false,

  toasts: [],
  logs: [],

  // -------------------------------------------------------------- acciones
  setBridge: (partial) => set((s) => ({ bridge: { ...s.bridge, ...partial } })),
  setDevices: (devices) =>
    set((s) => ({
      devices,
      activeUdid: s.activeUdid && devices.some((d) => d.udid === s.activeUdid)
        ? s.activeUdid
        : (devices[0]?.udid ?? null)
    })),
  setActiveUdid: (activeUdid) => set({ activeUdid }),
  setConnection: (connection, connectionError = null) => set({ connection, connectionError }),
  setDdiMessage: (ddiMessage) => set({ ddiMessage }),
  setBusy: (busy) => set({ busy }),

  setMode: (mode) =>
    set((s) => ({
      mode,
      // Cambiar de modo descarta la ruta a medio trazar: mantenerla llevaría
      // a estados incoherentes (p. ej. 5 waypoints en modo Two-Spot).
      waypoints: mode === s.mode ? s.waypoints : [],
      plan: mode === s.mode ? s.plan : null
    })),

  addWaypoint: (point) =>
    set((s) => {
      // Two-Spot admite exactamente dos puntos: el tercero reemplaza al destino.
      if (s.mode === 'two-spot' && s.waypoints.length >= 2) {
        return { waypoints: [s.waypoints[0], point], plan: null }
      }
      return { waypoints: [...s.waypoints, point], plan: null }
    }),

  updateWaypoint: (index, point) =>
    set((s) => {
      const waypoints = [...s.waypoints]
      waypoints[index] = point
      return { waypoints, plan: null }
    }),

  removeWaypoint: (index) =>
    set((s) => ({ waypoints: s.waypoints.filter((_, i) => i !== index), plan: null })),

  setWaypoints: (waypoints) => set({ waypoints, plan: null }),
  clearWaypoints: () => set({ waypoints: [], plan: null }),
  setPlan: (plan) => set({ plan }),

  setSnapToRoads: (snapToRoads) => set({ snapToRoads, plan: null }),
  setProfile: (profile) =>
    set({
      profile,
      speedKmh: profile === 'custom' ? get().speedKmh : PROFILE_SPEEDS[profile],
      plan: null
    }),
  setSpeed: (speedKmh) => set({ speedKmh, profile: 'custom' }),
  setLoop: (loop) => set({ loop, pingPong: loop ? false : get().pingPong }),
  setPingPong: (pingPong) => set({ pingPong, loop: pingPong ? false : get().loop }),
  setHumanize: (partial) => set((s) => ({ humanize: { ...s.humanize, ...partial } })),

  setSim: (sim) =>
    set((s) => ({
      sim,
      center: s.followMarker && sim.current ? sim.current : s.center
    })),

  setSessionOpen: (sessionOpen) => set({ sessionOpen }),
  setSessionBusy: (sessionBusy) => set({ sessionBusy }),
  setShowTimezoneNotice: (showTimezoneNotice) => set({ showTimezoneNotice }),
  setTimezoneNoticeSeen: (timezoneNoticeSeen) =>
    set({ timezoneNoticeSeen, showTimezoneNotice: false }),

  setCenter: (center, zoom) => set((s) => ({ center, zoom: zoom ?? s.zoom })),
  setFollow: (followMarker) => set({ followMarker }),
  setMapStyle: (mapStyle) => set({ mapStyle }),

  setFavorites: (favorites) => set({ favorites }),
  setSavedRoutes: (savedRoutes) => set({ savedRoutes }),
  setHistory: (history) => set({ history }),
  setSearchResults: (searchResults) => set({ searchResults }),
  setSearching: (searching) => set({ searching }),

  toast: (toast) =>
    set((s) => ({ toasts: [...s.toasts, { ...toast, id: ++toastId }].slice(-4) })),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  pushLog: (line) => set((s) => ({ logs: [...s.logs, line].slice(-300) })),

  routeOptions: () => {
    const s = get()
    return {
      speedKmh: s.speedKmh,
      profile: s.profile,
      loop: s.loop,
      pingPong: s.pingPong,
      humanize: s.humanize
    }
  }
}))

/** El dispositivo está listo para recibir coordenadas. */
export const useIsReady = (): boolean =>
  useStore((s) => s.connection === 'ready' || s.connection === 'simulating')

export const useActiveDevice = (): DeviceInfo | null =>
  useStore((s) => s.devices.find((d) => d.udid === s.activeUdid) ?? null)
