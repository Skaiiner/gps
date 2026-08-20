import type { LatLng, MovementProfile, Place, RoutePlan } from '@shared/types'
import { distanceMeters, indexPolyline } from '@shared/geo'

/**
 * Geocodificación y cálculo de rutas por calles reales.
 *
 * Se usan los servicios públicos de OSM (Nominatim + OSRM) por defecto: no
 * requieren clave y permiten que la app funcione nada más instalarla. Ambos
 * son sustituibles por endpoints propios (Mapbox, Graphhopper, un OSRM
 * self-hosted) mediante variables de entorno, que es lo que conviene si la
 * app se distribuye a mucha gente: las instancias públicas tienen límites de
 * uso estrictos.
 */
const NOMINATIM = process.env.GEOPILOT_GEOCODER ?? 'https://nominatim.openstreetmap.org'
const OSRM = process.env.GEOPILOT_ROUTER ?? 'https://router.project-osrm.org'
const USER_AGENT = 'GeoPilot/1.0 (simulador de ubicacion de escritorio)'

const REQUEST_TIMEOUT_MS = 12_000

/** Nominatim exige un máximo de 1 req/s; se serializa con un mínimo de 1.1 s. */
let lastGeocodeAt = 0

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal
    })
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`)
    }
    return (await response.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

async function throttleGeocode(): Promise<void> {
  const wait = 1100 - (Date.now() - lastGeocodeAt)
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
  lastGeocodeAt = Date.now()
}

interface NominatimHit {
  place_id: number
  display_name: string
  name?: string
  lat: string
  lon: string
  type?: string
}

export async function searchPlaces(query: string, limit = 8): Promise<Place[]> {
  const trimmed = query.trim()
  if (!trimmed) return []

  // Atajo: coordenadas pegadas directamente ("41.3874, 2.1686").
  const coords = parseCoordinates(trimmed)
  if (coords) {
    return [
      {
        id: `coord:${coords.lat},${coords.lng}`,
        label: `${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}`,
        address: 'Coordenadas',
        lat: coords.lat,
        lng: coords.lng
      }
    ]
  }

  await throttleGeocode()
  const url = `${NOMINATIM}/search?q=${encodeURIComponent(trimmed)}&format=jsonv2&addressdetails=0&limit=${limit}`
  const hits = await fetchJson<NominatimHit[]>(url)

  return hits.map((hit) => ({
    id: String(hit.place_id),
    label: hit.name || hit.display_name.split(',')[0],
    address: hit.display_name,
    lat: Number(hit.lat),
    lng: Number(hit.lon)
  }))
}

export async function reverseGeocode(point: LatLng): Promise<Place | null> {
  await throttleGeocode()
  const url = `${NOMINATIM}/reverse?lat=${point.lat}&lon=${point.lng}&format=jsonv2`
  try {
    const hit = await fetchJson<NominatimHit>(url)
    if (!hit?.display_name) return null
    return {
      id: String(hit.place_id ?? `${point.lat},${point.lng}`),
      label: hit.name || hit.display_name.split(',')[0],
      address: hit.display_name,
      lat: point.lat,
      lng: point.lng
    }
  } catch {
    return null
  }
}

/** "41.3874, 2.1686" o "41.3874 2.1686" -> LatLng */
export function parseCoordinates(input: string): LatLng | null {
  const match = input
    .trim()
    .match(/^(-?\d{1,3}(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:[.,]\d+)?)$/)
  if (!match) return null
  const lat = Number(match[1].replace(',', '.'))
  const lng = Number(match[2].replace(',', '.'))
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return { lat, lng }
}

const OSRM_PROFILES: Record<MovementProfile, string> = {
  walk: 'foot',
  run: 'foot',
  bike: 'bike',
  car: 'driving',
  custom: 'foot'
}

interface OsrmResponse {
  code: string
  routes?: Array<{
    distance: number
    duration: number
    geometry: { coordinates: [number, number][] }
  }>
}

/**
 * Calcula la ruta que une los waypoints siguiendo calles reales.
 * Si el servicio falla o no hay ruta posible (p. ej. cruzar el mar a pie),
 * se degrada a línea recta en lugar de dejar al usuario sin nada.
 */
export async function buildRoute(
  waypoints: LatLng[],
  profile: MovementProfile = 'walk'
): Promise<RoutePlan> {
  if (waypoints.length < 2) {
    throw new Error('Se necesitan al menos dos puntos para trazar una ruta.')
  }

  const osrmProfile = OSRM_PROFILES[profile] ?? 'foot'
  const coords = waypoints.map((p) => `${p.lng},${p.lat}`).join(';')
  const url = `${OSRM}/route/v1/${osrmProfile}/${coords}?overview=full&geometries=geojson&steps=false`

  try {
    const data = await fetchJson<OsrmResponse>(url)
    const route = data.routes?.[0]
    if (data.code !== 'Ok' || !route || route.geometry.coordinates.length < 2) {
      return straightLinePlan(waypoints)
    }

    const polyline: LatLng[] = route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }))
    return {
      waypoints,
      polyline,
      distanceMeters: route.distance,
      source: 'osrm',
      profileUsed: osrmProfile
    }
  } catch {
    return straightLinePlan(waypoints)
  }
}

/** Ruta en línea recta entre waypoints (modo Two-Spot puro o fallback). */
export function straightLinePlan(waypoints: LatLng[]): RoutePlan {
  const index = indexPolyline(waypoints)
  return {
    waypoints,
    polyline: waypoints,
    distanceMeters: index.totalMeters,
    source: 'straight'
  }
}

export function measure(points: LatLng[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) total += distanceMeters(points[i - 1], points[i])
  return total
}
