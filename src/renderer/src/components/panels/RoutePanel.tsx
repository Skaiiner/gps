import { useEffect, type JSX } from 'react'
import type { MovementProfile } from '@shared/types'
import { PROFILE_SPEEDS } from '@shared/types'
import { formatDistance, formatDuration } from '@shared/geo'
import { useIsReady, useStore } from '../../store/useStore'
import { computeRoute, startRoute, stopSimulation, syncOptions, togglePause } from '../../lib/actions'
import { Empty, Segmented, SliderField, StatRow, Switch } from '../ui'
import { IconPause, IconPlay, IconStop, IconTrash, IconUpload } from '../Icons'

const PROFILE_OPTIONS: { value: MovementProfile; label: string }[] = [
  { value: 'walk', label: 'A pie' },
  { value: 'run', label: 'Corriendo' },
  { value: 'bike', label: 'Bici' },
  { value: 'car', label: 'Coche' }
]

export default function RoutePanel(): JSX.Element {
  const mode = useStore((s) => s.mode)
  const waypoints = useStore((s) => s.waypoints)
  const plan = useStore((s) => s.plan)
  const profile = useStore((s) => s.profile)
  const speedKmh = useStore((s) => s.speedKmh)
  const snapToRoads = useStore((s) => s.snapToRoads)
  const loop = useStore((s) => s.loop)
  const pingPong = useStore((s) => s.pingPong)
  const sim = useStore((s) => s.sim)
  const busy = useStore((s) => s.busy)
  const ready = useIsReady()

  const isTwoSpot = mode === 'two-spot'
  const running = sim.active && (sim.mode === 'two-spot' || sim.mode === 'multi-spot')

  // Los ajustes de velocidad se aplican en caliente, sin reiniciar la ruta.
  useEffect(() => {
    void syncOptions()
  }, [speedKmh, loop, pingPong])

  const etaText =
    plan && speedKmh > 0 ? formatDuration((plan.distanceMeters / (speedKmh * 1000)) * 3600) : '--:--'

  const importGpx = async (): Promise<void> => {
    const result = await window.geopilot.gpx.import()
    if (!result) return
    const store = useStore.getState()
    store.setWaypoints(result.waypoints.slice(0, 25))
    store.setPlan({
      waypoints: result.waypoints,
      polyline: result.points,
      distanceMeters: 0,
      source: 'straight'
    })
    // Se recalcula la distancia con el trazado real importado.
    void computeRoute()
    store.toast({ kind: 'success', title: `Importado ${result.fileName}` })
  }

  const exportGpx = async (): Promise<void> => {
    if (!plan) return
    const path = await window.geopilot.gpx.export('Ruta GeoPilot', plan.polyline, plan.waypoints)
    if (path) useStore.getState().toast({ kind: 'success', title: 'Ruta exportada', message: path })
  }

  const saveRoute = async (): Promise<void> => {
    if (waypoints.length < 2) return
    const name = `Ruta ${new Date().toLocaleDateString('es-ES')} ${new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`
    useStore.getState().setSavedRoutes(await window.geopilot.storage.saveRoute(name, waypoints))
    useStore.getState().toast({ kind: 'success', title: 'Ruta guardada en la biblioteca' })
  }

  return (
    <>
      <div className="panel__header">
        <h2 className="panel__title">{isTwoSpot ? 'Modo Salto (Two-Spot)' : 'Ruta multipunto'}</h2>
        <p className="panel__subtitle">
          {isTwoSpot
            ? 'Marca un origen y un destino. El iPhone recorrerá el trayecto a la velocidad elegida.'
            : 'Haz clic en el mapa para añadir tantas paradas como quieras; se unirán por calles reales.'}
        </p>
      </div>

      <div className="panel__body">
        <div className="field">
          <span className="field__label">
            Puntos ({waypoints.length}
            {isTwoSpot ? '/2' : ''})
            {waypoints.length > 0 && (
              <button
                className="icon-btn icon-btn--danger"
                title="Borrar todos"
                type="button"
                onClick={() => useStore.getState().clearWaypoints()}
              >
                <IconTrash />
              </button>
            )}
          </span>

          {waypoints.length === 0 ? (
            <Empty>
              Haz clic en el mapa para marcar {isTwoSpot ? 'el origen' : 'la primera parada'}.
            </Empty>
          ) : (
            <div className="list">
              {waypoints.map((point, index) => (
                <div key={`${index}-${point.lat}`} className="list-item">
                  <span className="list-item__index">{index + 1}</span>
                  <span className="list-item__main">
                    <span className="list-item__title">
                      {index === 0
                        ? 'Origen'
                        : index === waypoints.length - 1
                          ? 'Destino'
                          : `Parada ${index}`}
                    </span>
                    <span className="list-item__sub">
                      {point.lat.toFixed(5)}, {point.lng.toFixed(5)}
                    </span>
                  </span>
                  <button
                    className="icon-btn icon-btn--danger"
                    type="button"
                    onClick={() => useStore.getState().removeWaypoint(index)}
                    title="Quitar punto"
                  >
                    <IconTrash />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="divider" />

        <div className="field">
          <span className="field__label">Modo de desplazamiento</span>
          <Segmented
            value={profile === 'custom' ? 'walk' : profile}
            options={PROFILE_OPTIONS}
            onChange={(value) => useStore.getState().setProfile(value)}
          />
        </div>

        <SliderField
          label="Velocidad"
          value={speedKmh}
          display={`${speedKmh.toFixed(1)} km/h`}
          min={1}
          max={140}
          step={0.5}
          onChange={(value) => useStore.getState().setSpeed(value)}
        />
        <span style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: -8 }}>
          Referencia: peatón {PROFILE_SPEEDS.walk} · bici {PROFILE_SPEEDS.bike} · coche{' '}
          {PROFILE_SPEEDS.car} km/h
        </span>

        <Switch
          label="Seguir calles reales"
          hint="Traza el recorrido por la red viaria en lugar de en línea recta."
          checked={snapToRoads}
          onChange={(value) => useStore.getState().setSnapToRoads(value)}
        />
        <Switch
          label="Repetir en bucle"
          hint="Al llegar al final vuelve a empezar desde el origen."
          checked={loop}
          onChange={(value) => useStore.getState().setLoop(value)}
        />
        <Switch
          label="Ida y vuelta"
          hint="Al llegar al final rehace el camino en sentido inverso."
          checked={pingPong}
          onChange={(value) => useStore.getState().setPingPong(value)}
        />

        {plan && (
          <>
            <div className="divider" />
            <div>
              <StatRow label="Distancia" value={formatDistance(plan.distanceMeters)} />
              <StatRow label="Duración estimada" value={etaText} />
              <StatRow
                label="Trazado"
                value={plan.source === 'osrm' ? 'Calles reales' : 'Línea recta'}
              />
            </div>
          </>
        )}

        {running && (
          <>
            <div className="divider" />
            <div className="field">
              <span className="field__label">
                Progreso
                <span className="field__value">{Math.round(sim.progress * 100)}%</span>
              </span>
              <input
                className="slider"
                type="range"
                min={0}
                max={1}
                step={0.001}
                value={sim.progress}
                onChange={(e) => void window.geopilot.sim.seek(Number(e.target.value))}
              />
              <StatRow label="Restante" value={formatDistance(sim.distanceRemainingMeters)} />
              <StatRow label="Llegada en" value={formatDuration(sim.etaSeconds)} />
            </div>
          </>
        )}

        <div className="divider" />
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn btn--sm" onClick={importGpx} type="button" style={{ flex: 1 }}>
            <IconUpload />
            Importar GPX
          </button>
          <button
            className="btn btn--sm"
            onClick={exportGpx}
            type="button"
            disabled={!plan}
            style={{ flex: 1 }}
          >
            Exportar
          </button>
          <button
            className="btn btn--sm"
            onClick={saveRoute}
            type="button"
            disabled={waypoints.length < 2}
            style={{ flex: 1 }}
          >
            Guardar
          </button>
        </div>
      </div>

      <div className="panel__footer">
        {!running ? (
          <>
            <button
              className="btn btn--block"
              disabled={waypoints.length < 2 || busy}
              onClick={() => void computeRoute()}
              type="button"
            >
              {busy ? 'Calculando…' : 'Calcular ruta'}
            </button>
            <button
              className="btn btn--primary btn--block"
              disabled={waypoints.length < 2 || !ready || busy}
              onClick={() => void startRoute(mode)}
              type="button"
            >
              <IconPlay size={16} />
              Iniciar recorrido
            </button>
          </>
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn"
              style={{ flex: 1 }}
              onClick={() => void togglePause()}
              type="button"
            >
              {sim.paused ? <IconPlay size={15} /> : <IconPause size={15} />}
              {sim.paused ? 'Reanudar' : 'Pausar'}
            </button>
            <button
              className="btn btn--danger"
              style={{ flex: 1 }}
              onClick={() => void stopSimulation()}
              type="button"
            >
              <IconStop size={15} />
              Detener
            </button>
          </div>
        )}
      </div>
    </>
  )
}
