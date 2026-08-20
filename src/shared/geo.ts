/**
 * Geodesia mínima para interpolación de rutas.
 * Fórmulas esféricas (radio medio terrestre) — el error frente a WGS84
 * es < 0.5 % y es irrelevante a las escalas que manejamos.
 */
import type { LatLng } from './types'

export const EARTH_RADIUS_M = 6371008.8

const toRad = (d: number): number => (d * Math.PI) / 180
const toDeg = (r: number): number => (r * 180) / Math.PI

/** Distancia haversine en metros. */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Rumbo inicial de a → b, en grados [0, 360). */
export function bearing(a: LatLng, b: LatLng): number {
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const dLng = toRad(b.lng - a.lng)
  const y = Math.sin(dLng) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

/** Punto a `distance` metros de `origin` siguiendo `bearingDeg`. */
export function destinationPoint(origin: LatLng, bearingDeg: number, distance: number): LatLng {
  const d = distance / EARTH_RADIUS_M
  const brng = toRad(bearingDeg)
  const lat1 = toRad(origin.lat)
  const lng1 = toRad(origin.lng)

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng)
  )
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
    )

  return { lat: toDeg(lat2), lng: normalizeLng(toDeg(lng2)) }
}

/** Interpolación lineal entre dos puntos (t ∈ [0,1]). Suficiente a < 1 km por segmento. */
export function lerpPoint(a: LatLng, b: LatLng, t: number): LatLng {
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t }
}

export function normalizeLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180
}

export function clampLat(lat: number): number {
  return Math.max(-90, Math.min(90, lat))
}

export interface PolylineIndex {
  points: LatLng[]
  /** Distancia acumulada hasta cada punto. cum[0] = 0. */
  cumulative: number[]
  totalMeters: number
}

/** Pre-calcula distancias acumuladas para poder buscar por distancia en O(log n). */
export function indexPolyline(points: LatLng[]): PolylineIndex {
  const cumulative: number[] = [0]
  let total = 0
  for (let i = 1; i < points.length; i++) {
    total += distanceMeters(points[i - 1], points[i])
    cumulative.push(total)
  }
  return { points, cumulative, totalMeters: total }
}

export interface PointOnPath {
  position: LatLng
  heading: number
  /** Índice del segmento en el que cae. */
  segment: number
  /** true si `meters` superó la longitud total. */
  finished: boolean
}

/** Punto situado a `meters` del inicio de la polilínea. */
export function pointAtDistance(index: PolylineIndex, meters: number): PointOnPath {
  const { points, cumulative, totalMeters } = index

  if (points.length === 0) {
    return { position: { lat: 0, lng: 0 }, heading: 0, segment: 0, finished: true }
  }
  if (points.length === 1 || meters <= 0) {
    return { position: points[0], heading: 0, segment: 0, finished: meters >= totalMeters }
  }
  if (meters >= totalMeters) {
    const last = points.length - 1
    return {
      position: points[last],
      heading: bearing(points[last - 1], points[last]),
      segment: last - 1,
      finished: true
    }
  }

  // Búsqueda binaria del segmento que contiene `meters`.
  let lo = 0
  let hi = cumulative.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (cumulative[mid] <= meters) lo = mid
    else hi = mid
  }

  const segLen = cumulative[hi] - cumulative[lo]
  const t = segLen > 0 ? (meters - cumulative[lo]) / segLen : 0
  return {
    position: lerpPoint(points[lo], points[hi], t),
    heading: bearing(points[lo], points[hi]),
    segment: lo,
    finished: false
  }
}

/**
 * Ruido gaussiano (Box–Muller). Se usa para el jitter "humanizado":
 * un GPS real tiene error ~3–8 m con distribución aproximadamente normal,
 * no uniforme, así que un random() plano se detecta a simple vista.
 */
export function gaussian(mean = 0, stdDev = 1): number {
  let u = 0
  let v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return mean + stdDev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/** Aplica una desviación radial gaussiana de `stdMeters` alrededor del punto. */
export function jitter(point: LatLng, stdMeters: number): LatLng {
  if (stdMeters <= 0) return point
  const radius = Math.abs(gaussian(0, stdMeters))
  const angle = Math.random() * 360
  return destinationPoint(point, angle, radius)
}

export const kmhToMs = (kmh: number): number => (kmh * 1000) / 3600
export const msToKmh = (ms: number): number => (ms * 3600) / 1000

/** Densifica una polilínea para que ningún segmento supere `maxSegmentMeters`. */
export function densify(points: LatLng[], maxSegmentMeters = 25): LatLng[] {
  if (points.length < 2) return points
  const out: LatLng[] = [points[0]]
  for (let i = 1; i < points.length; i++) {
    const d = distanceMeters(points[i - 1], points[i])
    const steps = Math.ceil(d / maxSegmentMeters)
    for (let s = 1; s <= steps; s++) {
      out.push(lerpPoint(points[i - 1], points[i], s / steps))
    }
  }
  return out
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`
  return `${(meters / 1000).toFixed(2)} km`
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}
