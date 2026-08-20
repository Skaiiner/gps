import { readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type {
  BridgeStatus,
  DeviceInfo,
  JoystickVector,
  LatLng,
  LogLine,
  MovementProfile,
  Place,
  RouteOptions,
  RoutePlan,
  SimulationMode,
  SimulationState
} from '@shared/types'
import { BridgeCallError, PythonBridge } from './bridge/PythonBridge'
import { DeviceManager } from './services/DeviceManager'
import { LocationEngine } from './services/LocationEngine'
import {
  buildRoute,
  reverseGeocode,
  searchPlaces,
  straightLinePlan
} from './services/RouteService'
import { StorageService, parseGpx, toGpx } from './services/StorageService'

export interface AppContext {
  bridge: PythonBridge
  devices: DeviceManager
  engine: LocationEngine
  storage: StorageService
}

export function createContext(): AppContext {
  const bridge = new PythonBridge()
  const devices = new DeviceManager(bridge)
  const engine = new LocationEngine(bridge)
  const storage = new StorageService()
  return { bridge, devices, engine, storage }
}

/** Reenvía un evento a todas las ventanas abiertas. */
function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }
}

export function wireEvents(ctx: AppContext): void {
  const { bridge, devices, engine } = ctx

  const status = (): BridgeStatus => ({
    running: bridge.running,
    pythonPath: bridge.runtimeInfo?.command ?? null,
    pymobiledevice3Version: null,
    tunneldRunning: false,
    lastError: bridge.lastError
  })

  bridge.on('started', () => {
    broadcast('bridge:status', status())
    // El watcher de usbmuxd se arranca en cuanto el sidecar está vivo:
    // el usuario debe poder enchufar el cable en cualquier momento.
    void bridge
      .call('devices.watch')
      .then(() => devices.refresh())
      .then((list) => {
        // Preparar explícitamente lo que ya estaba conectado. El evento
        // `device.attached` del watcher no basta: si `refresh()` gana la
        // carrera y fija el dispositivo activo, ese manejador se salta la
        // preparación y la UI se queda con el último estado publicado —que
        // tras un arranque fallido del puente es la pantalla de error—.
        const udid = devices.activeId
        if (list.length > 0 && udid) return devices.prepare(udid)
        return undefined
      })
      .catch(() => undefined)
  })

  bridge.on('exited', () => broadcast('bridge:status', status()))

  bridge.on('fatal', (error: { code: string; message: string }) => {
    broadcast('bridge:status', { ...status(), lastError: error.message })
    broadcast('device:state', { udid: '', state: 'bridge-error', error })
  })

  bridge.on('stderr', (text: string) => {
    broadcast('log:line', {
      ts: Date.now(),
      level: 'debug',
      scope: 'sidecar',
      message: text
    } satisfies LogLine)
  })

  bridge.on('event', (name: string, data: unknown) => {
    switch (name) {
      case 'log': {
        const line = data as Omit<LogLine, 'ts'>
        broadcast('log:line', { ts: Date.now(), ...line })
        break
      }
      case 'ddi.progress':
        broadcast('ddi:progress', data)
        break
      case 'location.error':
        // Un fallo en el canal de simulación invalida la ruta en curso.
        engine.stop('error')
        broadcast('sim:ended', { reason: 'error', error: data })
        break
      case 'location.session':
        broadcast('sim:session', data)
        break
      case 'bridge.error':
        broadcast('bridge:status', { ...status(), lastError: (data as { message: string }).message })
        break
      default:
        break
    }
  })

  devices.on('list', (list: DeviceInfo[]) => broadcast('device:list', list))
  devices.on('attached', (device: DeviceInfo) => broadcast('device:attached', device))
  devices.on('detached', (payload) => {
    // Si se va el cable con una ruta en marcha, se para el motor: seguir
    // "avanzando" contra un dispositivo ausente sólo confunde al usuario.
    engine.stop('stopped')
    broadcast('device:detached', payload)
  })
  devices.on('state', (payload) => broadcast('device:state', payload))

  engine.on('tick', (state: SimulationState) => broadcast('sim:tick', state))
  engine.on('ended', (payload) => broadcast('sim:ended', payload))
}

export function registerIpc(ctx: AppContext): void {
  const { bridge, devices, engine, storage } = ctx

  const handle = <T>(channel: string, fn: (...args: never[]) => Promise<T> | T): void => {
    ipcMain.handle(channel, async (_event, ...args) => {
      try {
        return { ok: true, data: await fn(...(args as never[])) }
      } catch (error) {
        const payload =
          error instanceof BridgeCallError
            ? error.toJSON()
            : { code: 'UNKNOWN' as const, message: (error as Error).message }
        return { ok: false, error: payload }
      }
    })
  }

  // ------------------------------------------------------------------ puente
  handle('bridge:status', async () => {
    const remote: Record<string, unknown> = bridge.running
      ? await bridge.call<Record<string, unknown>>('bridge.status').catch(() => ({}))
      : {}
    return {
      running: bridge.running,
      pythonPath: bridge.runtimeInfo?.command ?? null,
      pymobiledevice3Version: (remote.pymobiledevice3Version as string) ?? null,
      tunneldRunning: Boolean(remote.tunneldRunning),
      lastError: bridge.lastError
    } satisfies BridgeStatus
  })

  handle('bridge:restart', async () => {
    await bridge.stop()
    bridge.start()
    return true
  })

  // ------------------------------------------------------------ dispositivos
  handle('devices:list', () => devices.list())
  handle('devices:refresh', () => devices.refresh(true))
  handle('device:select', (udid: string) => devices.select(udid))
  handle('device:prepare', (udid: string) => devices.prepare(udid))
  handle('device:pair', (udid: string) => devices.pair(udid))
  handle('device:enableDevMode', (udid: string) => devices.enableDeveloperMode(udid))
  handle('device:revealDevMode', (udid: string) => devices.revealDeveloperMode(udid))
  handle('device:mountImage', (udid: string) => devices.mountImage(udid))
  handle('tunnel:status', () => devices.tunnelStatus())
  handle('tunnel:start', () => devices.startTunnel())

  // -------------------------------------------------------------- simulación
  /** Abre la sesión de simulación si aún no existe. */
  const ensureSession = async (): Promise<string> => {
    const udid = devices.activeId
    if (!udid) throw new Error('No hay ningún iPhone seleccionado.')

    const state = await bridge.call<{ active: boolean }>('location.status')
    if (!state.active) {
      await bridge.call('location.start', { udid })
    }
    return udid
  }

  /**
   * Interruptor general de la simulación.
   *
   * «Desconectar» cierra el canal y el iPhone recupera su GPS real al instante;
   * «Conectar» reabre la sesión y restaura el último punto simulado, de modo que
   * el par funcione como un interruptor de verdad y no obligue a rehacer el
   * trabajo. La posición vive en el motor, que no la borra al parar.
   */
  handle('sim:connect', async () => {
    await ensureSession()
    const previous = engine.currentPosition
    if (previous) await engine.teleport(previous)
    return { open: true, state: engine.snapshot }
  })

  handle('sim:disconnect', async () => {
    engine.stop('stopped')
    if (bridge.running) {
      await bridge.call('location.stop', { reset: true }).catch(() => undefined)
    }
    return { open: false, state: engine.snapshot }
  })

  handle('sim:sessionStatus', async () => {
    if (!bridge.running) return { open: false }
    const status = await bridge
      .call<{ active: boolean }>('location.status')
      .catch(() => ({ active: false }))
    return { open: Boolean(status.active) }
  })

  handle('sim:teleport', async (point: LatLng, label?: string) => {
    await ensureSession()
    await engine.teleport(point)
    await storage.pushHistory({
      lat: point.lat,
      lng: point.lng,
      label: label ?? `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`
    })
    return engine.snapshot
  })

  handle(
    'sim:startRoute',
    async (plan: RoutePlan, options: RouteOptions, mode: SimulationMode = 'multi-spot') => {
      await ensureSession()
      engine.startRoute(plan, options, mode)
      return engine.snapshot
    }
  )

  handle('sim:startJoystick', async (origin?: LatLng) => {
    await ensureSession()
    engine.startJoystick(origin)
    return engine.snapshot
  })

  // Canal `on` (fire-and-forget): el joystick emite a la cadencia del teclado
  // o del ratón y no necesita respuesta.
  ipcMain.on('sim:setJoystick', (_event, vector: JoystickVector) => {
    engine.setJoystick(vector)
  })

  handle('sim:updateOptions', (partial: Partial<RouteOptions>) => {
    engine.updateOptions(partial)
    return engine.snapshot
  })

  handle('sim:pause', () => {
    engine.pause()
    return engine.snapshot
  })

  handle('sim:resume', () => {
    engine.resume()
    return engine.snapshot
  })

  handle('sim:seek', (progress: number) => {
    engine.seek(progress)
    return engine.snapshot
  })

  handle('sim:status', () => engine.snapshot)

  handle('sim:stop', async (reset = true) => {
    engine.stop('stopped')
    if (bridge.running) {
      await bridge.call('location.stop', { reset }).catch(() => undefined)
    }
    return engine.snapshot
  })

  // -------------------------------------------------------------- rutas/geo
  handle('route:search', (query: string) => searchPlaces(query))
  handle('route:reverse', (point: LatLng) => reverseGeocode(point))

  handle('route:build', async (waypoints: LatLng[], profile: MovementProfile, snapToRoads = true) =>
    snapToRoads ? buildRoute(waypoints, profile) : straightLinePlan(waypoints)
  )

  // ------------------------------------------------------------- persistencia
  handle('storage:favorites', () => storage.favorites())
  handle('storage:addFavorite', (place: Place) => storage.addFavorite(place))
  handle('storage:removeFavorite', (id: string) => storage.removeFavorite(id))
  handle('storage:routes', () => storage.routes())
  handle('storage:saveRoute', (name: string, waypoints: LatLng[]) =>
    storage.saveRoute(name, waypoints)
  )
  handle('storage:removeRoute', (id: string) => storage.removeRoute(id))
  handle('storage:history', () => storage.history())
  handle('storage:clearHistory', () => storage.clearHistory())
  handle('storage:settings', () => storage.settings())
  handle('storage:updateSettings', (partial: Record<string, unknown>) =>
    storage.updateSettings(partial)
  )

  // ------------------------------------------------------------------- GPX
  handle('gpx:import', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Importar ruta GPX',
      filters: [{ name: 'GPX', extensions: ['gpx'] }],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const file = result.filePaths[0]
    const parsed = parseGpx(await readFile(file, 'utf-8'))
    return { ...parsed, fileName: basename(file) }
  })

  handle('gpx:export', async (name: string, points: LatLng[], waypoints: LatLng[]) => {
    const result = await dialog.showSaveDialog({
      title: 'Exportar ruta GPX',
      defaultPath: `${name.replace(/[^\w\-. ]+/g, '_') || 'ruta'}.gpx`,
      filters: [{ name: 'GPX', extensions: ['gpx'] }]
    })
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, toGpx(name, points, waypoints), 'utf-8')
    return result.filePath
  })

  // ------------------------------------------------------------------ varios
  handle('shell:openExternal', (url: string) => shell.openExternal(url))
  handle('app:copyToClipboard', async (text: string) => {
    const { clipboard } = await import('electron')
    clipboard.writeText(text)
    return true
  })
}
