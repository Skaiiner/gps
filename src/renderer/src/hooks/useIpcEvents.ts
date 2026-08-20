import { useEffect } from 'react'
import type { ConnectionState } from '@shared/types'
import { useStore } from '../store/useStore'

/**
 * Conecta los eventos push del proceso principal con el store.
 * Se monta una única vez, en App.
 */
export function useIpcEvents(): void {
  useEffect(() => {
    const api = window.geopilot

    const unsubscribers = [
      api.on.bridgeStatus((status) => {
        const store = useStore.getState()
        store.setBridge(status)

        if (!status.running && status.lastError) {
          store.setConnection('bridge-error', {
            code: 'PYTHON_MISSING',
            message: status.lastError
          })
        } else if (status.running && store.connection === 'bridge-error') {
          // El puente revivió: no dejar en pantalla un error ya resuelto.
          // `waiting` es neutro y lo sobreescribe la preparación del dispositivo.
          store.setConnection('waiting')
        }
      }),

      api.on.deviceList((devices) => {
        useStore.getState().setDevices(devices)
        if (devices.length === 0) useStore.getState().setConnection('waiting')
      }),

      api.on.deviceAttached((device) => {
        useStore.getState().toast({
          kind: 'success',
          title: `${device.name} conectado`,
          message: `iOS ${device.productVersion || '—'} · ${device.connectionType}`
        })
      }),

      api.on.deviceDetached(() => {
        const store = useStore.getState()
        store.setConnection('waiting')
        store.toast({
          kind: 'warn',
          title: 'iPhone desconectado',
          message: 'La simulación se detuvo. Vuelve a conectar el cable.'
        })
      }),

      api.on.deviceState(({ state, error }) => {
        useStore.getState().setConnection(state as ConnectionState, error ?? null)
      }),

      api.on.ddiProgress(({ message }) => {
        useStore.getState().setDdiMessage(message)
      }),

      api.on.simTick((sim) => {
        useStore.getState().setSim(sim)
      }),

      // El sidecar es la única fuente de verdad sobre si el canal está abierto:
      // también se cierra solo (desconexión del cable, caída del túnel), y el
      // botón debe reflejarlo sin que el usuario haya tocado nada.
      api.on.simSession(({ state }) => {
        useStore.getState().setSessionOpen(state === 'open')
      }),

      api.on.simEnded(({ reason, error }) => {
        const store = useStore.getState()
        if (reason === 'completed') {
          store.toast({ kind: 'success', title: 'Ruta completada' })
        } else if (reason === 'error') {
          const err = error as { message?: string } | undefined
          store.toast({
            kind: 'error',
            title: 'Se interrumpió la simulación',
            message: err?.message ?? 'El canal con el dispositivo se cerró.'
          })
        }
      }),

      api.on.log((line) => {
        useStore.getState().pushLog(line)
        if (line.level === 'error') {
          useStore.getState().toast({ kind: 'error', title: line.scope, message: line.message })
        }
      })
    ]

    // Estado inicial.
    void (async () => {
      const store = useStore.getState()
      try {
        store.setBridge(await api.bridge.status())
        const devices = await api.devices.refresh()
        store.setDevices(devices)
        if (devices.length === 0) store.setConnection('waiting')

        // Al recargar la ventana el canal puede seguir abierto en el sidecar.
        store.setSessionOpen((await api.sim.sessionStatus()).open)

        const [favorites, routes, history, settings] = await Promise.all([
          api.storage.favorites(),
          api.storage.routes(),
          api.storage.history(),
          api.storage.settings()
        ])
        store.setFavorites(favorites)
        store.setSavedRoutes(routes)
        store.setHistory(history)

        if (settings.lastCenter) {
          store.setCenter(
            settings.lastCenter as { lat: number; lng: number },
            settings.lastZoom as number
          )
        }
        if (settings.mapStyle) store.setMapStyle(settings.mapStyle as 'streets')
        store.setTimezoneNoticeSeen(Boolean(settings.timezoneNoticeSeen))
        store.setHumanize({
          enabled: Boolean(settings.humanizeEnabled),
          jitterMeters: Number(settings.jitterMeters ?? 3),
          speedVariance: Number(settings.speedVariance ?? 0.12),
          pausesEnabled: Boolean(settings.pausesEnabled)
        })
      } catch (error) {
        store.setConnection('bridge-error', {
          code: 'UNKNOWN',
          message: (error as Error).message
        })
      }
    })()

    return () => unsubscribers.forEach((off) => off())
  }, [])
}
