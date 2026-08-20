import type { LatLng, SimulationMode } from '@shared/types'
import { useStore } from '../store/useStore'

/** Traduce el código de error del puente a un aviso accionable. */
function reportError(error: unknown, fallbackTitle: string): void {
  const err = error as { code?: string; message?: string }
  const store = useStore.getState()

  const titles: Record<string, string> = {
    NOT_TRUSTED: 'Confía en este ordenador desde el iPhone',
    PASSWORD_REQUIRED: 'Desbloquea el iPhone',
    DEVELOPER_MODE_DISABLED: 'Activa el Modo Desarrollador',
    DDI_MOUNT_FAILED: 'No se pudo montar la imagen de desarrollador',
    DDI_NOT_FOUND: 'Falta la imagen de desarrollador',
    TUNNEL_REQUIRED: 'Se necesita el túnel de iOS 17+',
    SERVICE_UNAVAILABLE: 'El servicio de ubicación no responde',
    DEVICE_NOT_FOUND: 'iPhone no conectado'
  }

  store.toast({
    kind: 'error',
    title: titles[err.code ?? ''] ?? fallbackTitle,
    message: err.message
  })
}

/** Teleport: mueve el dispositivo al punto de forma inmediata. */
export async function teleportTo(point: LatLng, label?: string): Promise<boolean> {
  const store = useStore.getState()
  store.setBusy(true)
  try {
    await window.geopilot.sim.teleport(point, label)
    store.setHistory(await window.geopilot.storage.history())
    store.toast({
      kind: 'success',
      title: 'Ubicación actualizada',
      message: label ?? `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`
    })
    return true
  } catch (error) {
    reportError(error, 'No se pudo cambiar la ubicación')
    return false
  } finally {
    store.setBusy(false)
  }
}

/** Calcula la polilínea de la ruta con los waypoints actuales. */
export async function computeRoute(): Promise<boolean> {
  const store = useStore.getState()
  const { waypoints, profile, snapToRoads } = store

  if (waypoints.length < 2) {
    store.toast({ kind: 'warn', title: 'Marca al menos dos puntos en el mapa' })
    return false
  }

  store.setBusy(true)
  try {
    const plan = await window.geopilot.route.build(waypoints, profile, snapToRoads)
    store.setPlan(plan)
    if (plan.source === 'straight' && snapToRoads) {
      store.toast({
        kind: 'warn',
        title: 'Ruta en línea recta',
        message: 'El servicio de rutas no encontró un trazado por calles para estos puntos.'
      })
    }
    return true
  } catch (error) {
    reportError(error, 'No se pudo calcular la ruta')
    return false
  } finally {
    store.setBusy(false)
  }
}

/** Calcula (si hace falta) y arranca el recorrido. */
export async function startRoute(mode: SimulationMode): Promise<void> {
  const store = useStore.getState()

  if (!store.plan) {
    const ok = await computeRoute()
    if (!ok) return
  }

  const plan = useStore.getState().plan
  if (!plan) return

  try {
    await window.geopilot.sim.startRoute(plan, useStore.getState().routeOptions(), mode)
  } catch (error) {
    reportError(error, 'No se pudo iniciar el recorrido')
  }
}

/**
 * Interruptor general. Al conectar se recupera el último punto simulado; al
 * desconectar el iPhone vuelve a su GPS real de inmediato.
 */
export async function toggleSession(): Promise<void> {
  const store = useStore.getState()
  if (store.sessionBusy) return

  const connecting = !store.sessionOpen
  store.setSessionBusy(true)
  try {
    if (connecting) {
      await window.geopilot.sim.connect()
      store.setSessionOpen(true)
      // Se avisa al conectar, no al mover: cuando el reloj ya ha saltado es
      // tarde para explicar por qué.
      if (!store.timezoneNoticeSeen) store.setShowTimezoneNotice(true)
      store.toast({
        kind: 'success',
        title: 'Ubicación simulada activa',
        message: 'El iPhone está usando la ubicación de GeoPilot.'
      })
    } else {
      await window.geopilot.sim.disconnect()
      store.setSessionOpen(false)
      store.toast({
        kind: 'info',
        title: 'Desconectado',
        message: 'El iPhone ha vuelto a su GPS real.'
      })
    }
  } catch (error) {
    reportError(error, connecting ? 'No se pudo conectar' : 'No se pudo desconectar')
    // Se resincroniza con la verdad del sidecar en vez de asumir el resultado.
    const status = await window.geopilot.sim.sessionStatus().catch(() => ({ open: false }))
    store.setSessionOpen(status.open)
  } finally {
    useStore.getState().setSessionBusy(false)
  }
}

export async function stopSimulation(reset = true): Promise<void> {
  try {
    await window.geopilot.sim.stop(reset)
    if (reset) {
      useStore.getState().toast({
        kind: 'info',
        title: 'Simulación detenida',
        message: 'El iPhone vuelve a usar su GPS real.'
      })
    }
  } catch (error) {
    reportError(error, 'No se pudo detener la simulación')
  }
}

export async function togglePause(): Promise<void> {
  const { sim } = useStore.getState()
  try {
    if (sim.paused) await window.geopilot.sim.resume()
    else await window.geopilot.sim.pause()
  } catch (error) {
    reportError(error, 'No se pudo pausar')
  }
}

export async function startJoystick(origin?: LatLng): Promise<void> {
  const store = useStore.getState()
  const start = origin ?? store.sim.current ?? store.waypoints[0] ?? store.center

  try {
    await window.geopilot.sim.startJoystick(start)
    store.toast({
      kind: 'info',
      title: 'Joystick activo',
      message: 'Usa WASD o las flechas. Shift para correr.'
    })
  } catch (error) {
    reportError(error, 'No se pudo activar el joystick')
  }
}

/** Aplica cambios de velocidad/humanización a una simulación ya en marcha. */
export async function syncOptions(): Promise<void> {
  const store = useStore.getState()
  if (!store.sim.active) return
  try {
    await window.geopilot.sim.updateOptions(store.routeOptions())
  } catch {
    // Cambiar un slider sin sesión activa no es un error que merezca aviso.
  }
}

export async function refreshFavorites(): Promise<void> {
  const store = useStore.getState()
  store.setFavorites(await window.geopilot.storage.favorites())
}

export async function refreshRoutes(): Promise<void> {
  const store = useStore.getState()
  store.setSavedRoutes(await window.geopilot.storage.routes())
}

export { reportError }
