import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { FavoriteRoute, HistoryEntry, LatLng, Place } from '@shared/types'
import { measure } from './RouteService'

interface Settings {
  humanizeEnabled: boolean
  jitterMeters: number
  speedVariance: number
  pausesEnabled: boolean
  lastCenter: LatLng
  lastZoom: number
  mapStyle: 'streets' | 'satellite' | 'dark'
  resetOnDisconnect: boolean
  /** El aviso sobre la zona horaria ya se mostró una vez. */
  timezoneNoticeSeen: boolean
}

const DEFAULT_SETTINGS: Settings = {
  humanizeEnabled: true,
  jitterMeters: 3,
  speedVariance: 0.12,
  pausesEnabled: false,
  lastCenter: { lat: 40.4168, lng: -3.7038 },
  lastZoom: 13,
  mapStyle: 'streets',
  resetOnDisconnect: true,
  timezoneNoticeSeen: false
}

const MAX_HISTORY = 60

/**
 * Persistencia simple en JSON dentro de userData. No hay nada aquí que
 * justifique una base de datos: son tres listas cortas que se leen al arrancar.
 * La escritura es atómica (fichero temporal + rename) para que un cierre
 * abrupto durante una ruta no deje el JSON truncado.
 */
export class StorageService {
  private dir = app.getPath('userData')
  private cache = new Map<string, unknown>()

  private path(name: string): string {
    return join(this.dir, `${name}.json`)
  }

  private async read<T>(name: string, fallback: T): Promise<T> {
    if (this.cache.has(name)) return this.cache.get(name) as T
    const file = this.path(name)
    if (!existsSync(file)) {
      this.cache.set(name, fallback)
      return fallback
    }
    try {
      const parsed = JSON.parse(await readFile(file, 'utf-8')) as T
      this.cache.set(name, parsed)
      return parsed
    } catch {
      return fallback
    }
  }

  private async write<T>(name: string, value: T): Promise<void> {
    this.cache.set(name, value)
    await mkdir(this.dir, { recursive: true })
    const target = this.path(name)
    const temp = `${target}.tmp`
    await writeFile(temp, JSON.stringify(value, null, 2), 'utf-8')
    const { rename } = await import('node:fs/promises')
    await rename(temp, target)
  }

  // ------------------------------------------------------------- favoritos
  async favorites(): Promise<Place[]> {
    return this.read<Place[]>('favorites', [])
  }

  async addFavorite(place: Place): Promise<Place[]> {
    const list = await this.favorites()
    const id = place.id || `fav-${Date.now()}`
    const next = [{ ...place, id }, ...list.filter((p) => p.id !== id)]
    await this.write('favorites', next)
    return next
  }

  async removeFavorite(id: string): Promise<Place[]> {
    const next = (await this.favorites()).filter((p) => p.id !== id)
    await this.write('favorites', next)
    return next
  }

  // ---------------------------------------------------------------- rutas
  async routes(): Promise<FavoriteRoute[]> {
    return this.read<FavoriteRoute[]>('routes', [])
  }

  async saveRoute(name: string, waypoints: LatLng[]): Promise<FavoriteRoute[]> {
    const list = await this.routes()
    const route: FavoriteRoute = {
      id: `route-${Date.now()}`,
      name,
      waypoints,
      createdAt: Date.now(),
      distanceMeters: measure(waypoints)
    }
    const next = [route, ...list]
    await this.write('routes', next)
    return next
  }

  async removeRoute(id: string): Promise<FavoriteRoute[]> {
    const next = (await this.routes()).filter((r) => r.id !== id)
    await this.write('routes', next)
    return next
  }

  // -------------------------------------------------------------- historial
  async history(): Promise<HistoryEntry[]> {
    return this.read<HistoryEntry[]>('history', [])
  }

  async pushHistory(entry: Omit<HistoryEntry, 'id' | 'usedAt'>): Promise<HistoryEntry[]> {
    const list = await this.history()
    // Se deduplica por proximidad: reusar el mismo sitio no debe llenar la lista.
    const filtered = list.filter(
      (h) => Math.abs(h.lat - entry.lat) > 1e-5 || Math.abs(h.lng - entry.lng) > 1e-5
    )
    const next = [
      { ...entry, id: `h-${Date.now()}`, usedAt: Date.now() },
      ...filtered
    ].slice(0, MAX_HISTORY)
    await this.write('history', next)
    return next
  }

  async clearHistory(): Promise<HistoryEntry[]> {
    await this.write('history', [])
    return []
  }

  // -------------------------------------------------------------- ajustes
  async settings(): Promise<Settings> {
    return { ...DEFAULT_SETTINGS, ...(await this.read<Partial<Settings>>('settings', {})) }
  }

  async updateSettings(partial: Partial<Settings>): Promise<Settings> {
    const next = { ...(await this.settings()), ...partial }
    await this.write('settings', next)
    return next
  }
}

// ---------------------------------------------------------------------------
// GPX

/** Serializa una ruta como track GPX 1.1. */
export function toGpx(name: string, points: LatLng[], waypoints: LatLng[] = []): string {
  const escape = (s: string): string =>
    s.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`)

  const wpts = waypoints
    .map((p, i) => `  <wpt lat="${p.lat}" lon="${p.lng}"><name>P${i + 1}</name></wpt>`)
    .join('\n')

  const trkpts = points.map((p) => `      <trkpt lat="${p.lat}" lon="${p.lng}" />`).join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="GeoPilot" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${escape(name)}</name>
    <time>${new Date().toISOString()}</time>
  </metadata>
${wpts}
  <trk>
    <name>${escape(name)}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>
`
}

export interface ParsedGpx {
  name: string
  /** Puntos del track (o de la ruta, si no hay track). */
  points: LatLng[]
  /** <wpt> sueltos, útiles como waypoints editables. */
  waypoints: LatLng[]
}

/**
 * Parser deliberadamente tolerante: sólo interesan los atributos lat/lon.
 * Añadir una dependencia XML completa para esto no compensa, y los GPX que
 * exportan Strava, Garmin o las apps rivales encajan sin problema.
 */
export function parseGpx(xml: string): ParsedGpx {
  const collect = (tag: string): LatLng[] => {
    // Se capturan los atributos del elemento y después se extraen lat/lon por
    // separado: el esquema GPX no fija el orden y hay exportadores que emiten
    // lon primero.
    const regex = new RegExp(`<${tag}\\b([^>]*)>?`, 'gi')
    const out: LatLng[] = []
    let match: RegExpExecArray | null
    while ((match = regex.exec(xml)) !== null) {
      const attrs = match[1]
      const lat = attrs.match(/\blat\s*=\s*"(-?[\d.]+)"/i)
      const lon = attrs.match(/\blon\s*=\s*"(-?[\d.]+)"/i)
      if (lat && lon) out.push({ lat: Number(lat[1]), lng: Number(lon[1]) })
    }
    return out
  }

  const trkpts = collect('trkpt')
  const rtepts = collect('rtept')
  const wpts = collect('wpt')

  const nameMatch = xml.match(/<name>([^<]*)<\/name>/i)
  const points = trkpts.length > 1 ? trkpts : rtepts.length > 1 ? rtepts : wpts

  if (points.length < 1) {
    throw new Error('El archivo GPX no contiene puntos reconocibles.')
  }

  return {
    name: nameMatch?.[1]?.trim() || 'Ruta importada',
    points,
    waypoints: wpts.length > 1 ? wpts : points.length > 2 ? [points[0], points[points.length - 1]] : points
  }
}
