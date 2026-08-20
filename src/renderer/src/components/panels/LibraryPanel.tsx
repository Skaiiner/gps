import type { JSX } from 'react'
import { formatDistance } from '@shared/geo'
import { useIsReady, useStore } from '../../store/useStore'
import { teleportTo } from '../../lib/actions'
import { Empty } from '../ui'
import { IconMultiRoute, IconPin, IconTrash } from '../Icons'

export default function LibraryPanel(): JSX.Element {
  const favorites = useStore((s) => s.favorites)
  const savedRoutes = useStore((s) => s.savedRoutes)
  const ready = useIsReady()

  const goTo = (lat: number, lng: number): void => {
    const store = useStore.getState()
    store.setWaypoints([{ lat, lng }])
    store.setCenter({ lat, lng }, 16)
  }

  const loadRoute = (waypoints: { lat: number; lng: number }[]): void => {
    const store = useStore.getState()
    store.setMode(waypoints.length === 2 ? 'two-spot' : 'multi-spot')
    store.setWaypoints(waypoints)
    store.toast({ kind: 'info', title: 'Ruta cargada', message: 'Pulsa Calcular ruta para trazarla.' })
  }

  return (
    <>
      <div className="panel__header">
        <h2 className="panel__title">Biblioteca</h2>
        <p className="panel__subtitle">Ubicaciones y rutas guardadas en este equipo.</p>
      </div>

      <div className="panel__body">
        <div className="field">
          <span className="field__label">Favoritos ({favorites.length})</span>
          {favorites.length === 0 ? (
            <Empty>Guarda un destino con la estrella del panel Teleport.</Empty>
          ) : (
            <div className="list">
              {favorites.map((place) => (
                <div key={place.id} className="list-item">
                  <IconPin size={15} />
                  <button
                    className="list-item__main"
                    style={{ textAlign: 'left', background: 'none' }}
                    type="button"
                    onClick={() => goTo(place.lat, place.lng)}
                  >
                    <span className="list-item__title">{place.label}</span>
                    <span className="list-item__sub">
                      {place.address ?? `${place.lat.toFixed(4)}, ${place.lng.toFixed(4)}`}
                    </span>
                  </button>
                  <button
                    className="btn btn--sm"
                    type="button"
                    disabled={!ready}
                    onClick={() => void teleportTo({ lat: place.lat, lng: place.lng }, place.label)}
                  >
                    Ir
                  </button>
                  <button
                    className="icon-btn icon-btn--danger"
                    type="button"
                    title="Eliminar"
                    onClick={async () =>
                      useStore
                        .getState()
                        .setFavorites(await window.geopilot.storage.removeFavorite(place.id))
                    }
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
          <span className="field__label">Rutas guardadas ({savedRoutes.length})</span>
          {savedRoutes.length === 0 ? (
            <Empty>Traza una ruta y pulsa «Guardar» para reutilizarla.</Empty>
          ) : (
            <div className="list">
              {savedRoutes.map((route) => (
                <div key={route.id} className="list-item">
                  <IconMultiRoute size={15} />
                  <button
                    className="list-item__main"
                    style={{ textAlign: 'left', background: 'none' }}
                    type="button"
                    onClick={() => loadRoute(route.waypoints)}
                  >
                    <span className="list-item__title">{route.name}</span>
                    <span className="list-item__sub">
                      {route.waypoints.length} puntos · {formatDistance(route.distanceMeters)}
                    </span>
                  </button>
                  <button
                    className="icon-btn icon-btn--danger"
                    type="button"
                    title="Eliminar"
                    onClick={async () =>
                      useStore
                        .getState()
                        .setSavedRoutes(await window.geopilot.storage.removeRoute(route.id))
                    }
                  >
                    <IconTrash />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
