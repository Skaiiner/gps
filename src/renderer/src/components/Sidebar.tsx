import { useState, type JSX } from 'react'
import type { SimulationMode } from '@shared/types'
import { useStore } from '../store/useStore'
import TeleportPanel from './panels/TeleportPanel'
import RoutePanel from './panels/RoutePanel'
import JoystickPanel from './panels/JoystickPanel'
import LibraryPanel from './panels/LibraryPanel'
import SettingsPanel from './panels/SettingsPanel'
import {
  IconJoystick,
  IconLibrary,
  IconMultiRoute,
  IconPin,
  IconRoute,
  IconSettings
} from './Icons'

type View = SimulationMode | 'library' | 'settings'

const TOOLS: { view: View; label: string; icon: JSX.Element; isMode: boolean }[] = [
  { view: 'teleport', label: 'Teleport', icon: <IconPin />, isMode: true },
  { view: 'two-spot', label: 'Modo Salto (A → B)', icon: <IconRoute />, isMode: true },
  { view: 'multi-spot', label: 'Ruta multipunto', icon: <IconMultiRoute />, isMode: true },
  { view: 'joystick', label: 'Joystick', icon: <IconJoystick />, isMode: true }
]

const BOTTOM_TOOLS: typeof TOOLS = [
  { view: 'library', label: 'Biblioteca', icon: <IconLibrary />, isMode: false },
  { view: 'settings', label: 'Ajustes', icon: <IconSettings />, isMode: false }
]

export default function Sidebar(): JSX.Element {
  const mode = useStore((s) => s.mode)
  const sim = useStore((s) => s.sim)
  const setMode = useStore((s) => s.setMode)
  const [view, setView] = useState<View>('teleport')

  const select = (tool: (typeof TOOLS)[number]): void => {
    setView(tool.view)
    if (tool.isMode) setMode(tool.view as SimulationMode)
  }

  // Cambiar de modo con una simulación en marcha dejaría la UI describiendo
  // un estado que no se corresponde con lo que hace el dispositivo.
  const locked = sim.active && sim.mode !== 'teleport'

  const renderPanel = (): JSX.Element => {
    switch (view) {
      case 'teleport':
        return <TeleportPanel />
      case 'two-spot':
      case 'multi-spot':
        return <RoutePanel />
      case 'joystick':
        return <JoystickPanel />
      case 'library':
        return <LibraryPanel />
      case 'settings':
        return <SettingsPanel />
      default:
        return <TeleportPanel />
    }
  }

  const renderButton = (tool: (typeof TOOLS)[number]): JSX.Element => {
    const active = view === tool.view
    const disabled = locked && tool.isMode && tool.view !== sim.mode
    return (
      <button
        key={tool.view}
        className={`rail-btn${active ? ' rail-btn--active' : ''}`}
        onClick={() => select(tool)}
        disabled={disabled}
        type="button"
        aria-label={tool.label}
      >
        {tool.icon}
        <span className="rail-btn__tip">
          {tool.label}
          {disabled ? ' · detén la simulación' : ''}
        </span>
      </button>
    )
  }

  return (
    <aside className="sidebar">
      <nav className="sidebar__rail">
        {TOOLS.map(renderButton)}
        <div className="sidebar__rail-spacer" />
        {BOTTOM_TOOLS.map(renderButton)}
      </nav>

      <div className="sidebar__panel" key={view === 'two-spot' || view === 'multi-spot' ? mode : view}>
        {renderPanel()}
      </div>
    </aside>
  )
}
