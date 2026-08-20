import type { JSX } from 'react'
import { formatDistance, formatDuration } from '@shared/geo'
import { useStore } from '../store/useStore'

export default function StatusBar(): JSX.Element {
  const sim = useStore((s) => s.sim)
  const follow = useStore((s) => s.followMarker)
  const waypoints = useStore((s) => s.waypoints)
  const plan = useStore((s) => s.plan)

  const copyCoords = async (): Promise<void> => {
    if (!sim.current) return
    await window.geopilot.system.copy(`${sim.current.lat.toFixed(6)}, ${sim.current.lng.toFixed(6)}`)
    useStore.getState().toast({ kind: 'info', title: 'Coordenadas copiadas' })
  }

  return (
    <footer className="statusbar">
      <div className="statusbar__item">
        <span>Ubicación simulada:</span>
        {sim.current ? (
          <span className="statusbar__value statusbar__coords" onClick={copyCoords} title="Copiar">
            {sim.current.lat.toFixed(6)}, {sim.current.lng.toFixed(6)}
          </span>
        ) : (
          <span className="statusbar__value">—</span>
        )}
      </div>

      {sim.active && (
        <>
          <div className="statusbar__item">
            <span>Velocidad:</span>
            <span className="statusbar__value">{sim.speedKmh.toFixed(1)} km/h</span>
          </div>
          <div className="statusbar__item">
            <span>Rumbo:</span>
            <span className="statusbar__value">{Math.round(sim.heading)}°</span>
          </div>
        </>
      )}

      {plan && (
        <div className="statusbar__item">
          <span>Ruta:</span>
          <span className="statusbar__value">
            {formatDistance(plan.distanceMeters)} · {waypoints.length} puntos
          </span>
        </div>
      )}

      {sim.active && sim.distanceRemainingMeters > 0 && (
        <div className="statusbar__item" style={{ minWidth: 180, gap: 10 }}>
          <div className="progress" style={{ flex: 1 }}>
            <div className="progress__fill" style={{ width: `${sim.progress * 100}%` }} />
          </div>
          <span className="statusbar__value">{formatDuration(sim.etaSeconds)}</span>
        </div>
      )}

      <div className="statusbar__spacer" />

      <button
        className="statusbar__item"
        style={{ color: follow ? 'var(--accent)' : 'var(--text-dim)' }}
        onClick={() => useStore.getState().setFollow(!follow)}
        type="button"
      >
        {follow ? 'Siguiendo al marcador' : 'Cámara libre'}
      </button>
    </footer>
  )
}
