import { useEffect, useRef, useState, type JSX } from 'react'
import type { Place } from '@shared/types'
import { useStore } from '../store/useStore'
import { IconPin, IconSearch } from './Icons'

const DEBOUNCE_MS = 450

/**
 * Buscador de lugares (Nominatim) con debounce y cancelación por generación:
 * si el usuario sigue escribiendo, la respuesta de una consulta antigua no
 * debe sobreescribir los resultados de la actual.
 */
export default function SearchBar(): JSX.Element {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const results = useStore((s) => s.searchResults)
  const searching = useStore((s) => s.searching)
  const generation = useRef(0)
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 3) {
      useStore.getState().setSearchResults([])
      return
    }

    const current = ++generation.current
    const store = useStore.getState()
    store.setSearching(true)

    const timer = setTimeout(async () => {
      try {
        const places = await window.geopilot.route.search(trimmed)
        if (current !== generation.current) return
        useStore.getState().setSearchResults(places)
        setOpen(true)
      } catch {
        if (current === generation.current) useStore.getState().setSearchResults([])
      } finally {
        if (current === generation.current) useStore.getState().setSearching(false)
      }
    }, DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [query])

  // Cerrar al hacer clic fuera.
  useEffect(() => {
    const onClick = (event: MouseEvent): void => {
      if (container.current && !container.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const pick = (place: Place): void => {
    const store = useStore.getState()
    const point = { lat: place.lat, lng: place.lng }

    if (store.mode === 'teleport' || store.mode === 'joystick') {
      store.setWaypoints([point])
    } else {
      store.addWaypoint(point)
    }
    store.setCenter(point, 16)
    store.setFollow(false)
    setOpen(false)
    setQuery(place.label)
  }

  return (
    <div className="searchbar" ref={container}>
      <div className="searchbar__input-wrap">
        <span className="searchbar__icon">
          <IconSearch size={16} />
        </span>
        <input
          className="searchbar__input"
          placeholder="Buscar dirección, lugar o coordenadas…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
        />
      </div>

      {open && (results.length > 0 || searching) && (
        <div className="searchbar__results">
          {searching && results.length === 0 && <div className="empty">Buscando…</div>}
          {results.map((place) => (
            <button key={place.id} className="list-item" type="button" onClick={() => pick(place)}>
              <IconPin size={15} />
              <span className="list-item__main">
                <span className="list-item__title">{place.label}</span>
                <span className="list-item__sub">{place.address}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
