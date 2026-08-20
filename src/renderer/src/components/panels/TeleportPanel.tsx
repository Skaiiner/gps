import { useState, type JSX } from 'react'
import type { LatLng } from '@shared/types'
import { useIsReady, useStore } from '../../store/useStore'
import { teleportTo } from '../../lib/actions'
import { refreshFavorites } from '../../lib/actions'
import { Empty, StatRow } from '../ui'
import { IconCrosshair, IconPin, IconStar, IconTrash } from '../Icons'

export default function TeleportPanel(): JSX.Element {
  const waypoints = useStore((s) => s.waypoints)
  const history = useStore((s) => s.history)
  const favorites = useStore((s) => s.favorites)
  const busy = useStore((s) => s.busy)
  const setWaypoints = useStore((s) => s.setWaypoints)
  const setCenter = useStore((s) => s.setCenter)
  const ready = useIsReady()

  const target = waypoints[0] ?? null
  const [manual, setManual] = useState('')

  const applyManual = (): void => {
    const match = manual.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/)
    if (!match) {
      useStore.getState().toast({
        kind: 'warn',
        title: 'Formato no válido',
        message: 'Introduce las coordenadas como «41.3874, 2.1686».'
      })
      return
    }
    const point: LatLng = { lat: Number(match[1]), lng: Number(match[2]) }
    if (Math.abs(point.lat) > 90 || Math.abs(point.lng) > 180) {
      useStore.getState().toast({ kind: 'warn', title: 'Coordenadas fuera de rango' })
      return
    }
    setWaypoints([point])
    setCenter(point, 16)
  }

  const saveFavorite = async (): Promise<void> => {
    if (!target) return
    const place = await window.geopilot.route.reverse(target).catch(() => null)
    await window.geopilot.storage.addFavorite({
      id: `fav-${Date.now()}`,
      label: place?.label ?? `${target.lat.toFixed(5)}, ${target.lng.toFixed(5)}`,
      address: place?.address,
      lat: target.lat,
      lng: target.lng
    })
    await refreshFavorites()
    useStore.getState().toast({ kind: 'success', title: 'Guardado en favoritos' })
  }

  const isFavorite =
    target !== null &&
    favorites.some(
      (f) => Math.abs(f.lat - target.lat) < 1e-6 && Math.abs(f.lng - target.lng) < 1e-6
    )

  return (
    <>
      <div className="panel__header">
        <h2 className="panel__title">Teleport</h2>
        <p className="panel__subtitle">
          Haz clic en el mapa o escribe unas coordenadas y pulsa Mover para cambiar la ubicación del
          iPhone al instante.
        </p>
      </div>

      <div className="panel__body">
        <div className="field">
          <span className="field__label">Coordenadas</span>
          <input
            className="input"
            placeholder="41.3874, 2.1686"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && applyManual()}
          />
          <button className="btn btn--sm" onClick={applyManual} type="button">
            <IconCrosshair size={14} />
            Situar en el mapa
          </button>
        </div>

        <div className="divider" />

        <div className="field">
          <span className="field__label">
            Destino
            {target && (
              <button
                className="icon-btn"
                onClick={saveFavorite}
                title="Guardar en favoritos"
                type="button"
              >
                <IconStar filled={isFavorite} />
              </button>
            )}
          </span>
          {target ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <StatRow label="Latitud" value={target.lat.toFixed(6)} />
              <StatRow label="Longitud" value={target.lng.toFixed(6)} />
            </div>
          ) : (
            <Empty>Ningún punto seleccionado.
              <br />
              Haz clic en cualquier lugar del mapa.
            </Empty>
          )}
        </div>

        {history.length > 0 && (
          <>
            <div className="divider" />
            <div className="field">
              <span className="field__label">
                Recientes
                <button
                  className="icon-btn"
                  title="Vaciar historial"
                  type="button"
                  onClick={async () => useStore.getState().setHistory(await window.geopilot.storage.clearHistory())}
                >
                  <IconTrash />
                </button>
              </span>
              <div className="list">
                {history.slice(0, 8).map((entry) => (
                  <button
                    key={entry.id}
                    className="list-item"
                    type="button"
                    onClick={() => {
                      const point = { lat: entry.lat, lng: entry.lng }
                      setWaypoints([point])
                      setCenter(point, 16)
                    }}
                  >
                    <IconPin size={15} />
                    <span className="list-item__main">
                      <span className="list-item__title">{entry.label}</span>
                      <span className="list-item__sub">
                        {entry.lat.toFixed(4)}, {entry.lng.toFixed(4)}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="panel__footer">
        <button
          className="btn btn--primary btn--block"
          disabled={!target || !ready || busy}
          onClick={() => target && void teleportTo(target)}
          type="button"
        >
          <IconCrosshair size={16} />
          {busy ? 'Moviendo…' : 'Mover aquí'}
        </button>
        {!ready && (
          <span style={{ fontSize: 11.5, color: 'var(--text-faint)', textAlign: 'center' }}>
            Conecta y prepara un iPhone para habilitar el movimiento.
          </span>
        )}
      </div>
    </>
  )
}
