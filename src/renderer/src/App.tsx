import type { JSX } from 'react'
import { useIpcEvents } from './hooks/useIpcEvents'
import { useIsReady, useStore } from './store/useStore'
import TitleBar from './components/TitleBar'
import MapView from './components/MapView'
import Sidebar from './components/Sidebar'
import SearchBar from './components/SearchBar'
import StatusBar from './components/StatusBar'
import ConnectionOverlay from './components/ConnectionOverlay'
import TimezoneNotice from './components/TimezoneNotice'
import Toasts from './components/Toasts'
import { IconCrosshair, IconLayers } from './components/Icons'

const MODE_HINTS: Record<string, JSX.Element> = {
  teleport: <>Haz clic en el mapa para elegir el destino y pulsa <kbd>Mover aquí</kbd></>,
  'two-spot': <>Marca el origen y el destino con dos clics en el mapa</>,
  'multi-spot': <>Añade paradas con cada clic; arrastra los pines para ajustarlos</>,
  joystick: <>Usa <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> o arrastra el control · <kbd>Shift</kbd> para correr</>
}

export default function App(): JSX.Element {
  useIpcEvents()

  const mode = useStore((s) => s.mode)
  const mapStyle = useStore((s) => s.mapStyle)
  const follow = useStore((s) => s.followMarker)
  const sim = useStore((s) => s.sim)
  const ready = useIsReady()

  const cycleStyle = (): void => {
    const order = ['streets', 'dark', 'satellite'] as const
    const next = order[(order.indexOf(mapStyle) + 1) % order.length]
    useStore.getState().setMapStyle(next)
    void window.geopilot.storage.updateSettings({ mapStyle: next })
  }

  const recenter = (): void => {
    const store = useStore.getState()
    if (sim.current) store.setCenter(sim.current, 17)
    store.setFollow(true)
  }

  return (
    <div className="app">
      <TitleBar />

      <div className="app__body">
        <MapView />

        <Sidebar />
        <SearchBar />

        <div className="map-tools">
          <button
            className={`map-tool${follow ? ' map-tool--active' : ''}`}
            title="Centrar en el dispositivo"
            onClick={recenter}
            type="button"
          >
            <IconCrosshair size={18} />
          </button>
          <button className="map-tool" title="Cambiar estilo del mapa" onClick={cycleStyle} type="button">
            <IconLayers size={18} />
          </button>
        </div>

        {ready && !sim.active && MODE_HINTS[mode] && (
          <div className="map-hint">{MODE_HINTS[mode]}</div>
        )}

        <ConnectionOverlay />
        <TimezoneNotice />
        <Toasts />
      </div>

      <StatusBar />
    </div>
  )
}
