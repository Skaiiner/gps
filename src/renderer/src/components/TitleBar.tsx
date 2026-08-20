import type { JSX } from 'react'
import type { ConnectionState } from '@shared/types'
import { useIsReady, useStore } from '../store/useStore'
import { toggleSession } from '../lib/actions'
import { IconRefresh } from './Icons'

const STATE_LABEL: Record<ConnectionState, string> = {
  'bridge-starting': 'Iniciando…',
  'bridge-error': 'Error del puente',
  waiting: 'Esperando iPhone',
  untrusted: 'Sin confianza',
  locked: 'iPhone bloqueado',
  'dev-mode-required': 'Modo Desarrollador',
  'tunnel-required': 'Túnel requerido',
  mounting: 'Preparando…',
  ready: 'Listo',
  simulating: 'Simulando'
}

function dotClass(state: ConnectionState): string {
  if (state === 'ready' || state === 'simulating') return ' device-pill__dot--ready'
  if (state === 'mounting' || state === 'bridge-starting') return ' device-pill__dot--busy'
  if (state === 'bridge-error') return ' device-pill__dot--error'
  return ''
}

export default function TitleBar(): JSX.Element {
  const connection = useStore((s) => s.connection)
  const devices = useStore((s) => s.devices)
  const activeUdid = useStore((s) => s.activeUdid)
  const sim = useStore((s) => s.sim)
  const sessionOpen = useStore((s) => s.sessionOpen)
  const sessionBusy = useStore((s) => s.sessionBusy)
  const ready = useIsReady()

  const device = devices.find((d) => d.udid === activeUdid) ?? null
  const isMac = window.geopilot.platform === 'darwin'

  return (
    <header className={`titlebar${isMac ? ' titlebar--mac' : ''}`}>
      <div className="titlebar__brand">
        <span className="titlebar__logo">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z" />
            <circle cx="12" cy="10" r="2.4" />
          </svg>
        </span>
        GeoPilot
      </div>

      {sim.active && <span className="badge badge--accent">SIMULANDO</span>}

      <div className="titlebar__spacer" />

      <button
        className={`link-toggle${sessionOpen ? ' link-toggle--on' : ''}`}
        onClick={() => void toggleSession()}
        disabled={!ready || sessionBusy}
        type="button"
        title={
          sessionOpen
            ? 'Cerrar el canal: el iPhone vuelve a su GPS real'
            : 'Abrir el canal y restaurar la última ubicación simulada'
        }
      >
        <span className="link-toggle__dot" />
        {sessionBusy ? '…' : sessionOpen ? 'Desconectar' : 'Conectar'}
      </button>

      <div className="titlebar__actions">
        {devices.length > 1 && (
          <select
            className="input"
            style={{ width: 'auto', padding: '5px 8px', fontSize: 12 }}
            value={activeUdid ?? ''}
            onChange={(e) => void window.geopilot.devices.select(e.target.value)}
          >
            {devices.map((d) => (
              <option key={d.udid} value={d.udid}>
                {d.name} · iOS {d.productVersion}
              </option>
            ))}
          </select>
        )}

        <div className="device-pill">
          <span className={`device-pill__dot${dotClass(connection)}`} />
          <span>{device ? device.name : STATE_LABEL[connection]}</span>
          {device && (
            <span className="device-pill__meta">
              iOS {device.productVersion || '—'} · {STATE_LABEL[connection]}
            </span>
          )}
        </div>

        <button
          className="rail-btn"
          style={{ width: 32, height: 32 }}
          title="Volver a buscar dispositivos"
          type="button"
          onClick={() => void window.geopilot.devices.refresh()}
        >
          <IconRefresh size={15} />
        </button>
      </div>
    </header>
  )
}
