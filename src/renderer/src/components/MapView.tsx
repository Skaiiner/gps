import { useCallback, useEffect, useMemo, useRef, type JSX } from 'react'
import { MapContainer, Marker, Polyline, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import type { LatLng } from '@shared/types'
import { useStore } from '../store/useStore'

const TILE_LAYERS = {
  streets: {
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    maxZoom: 20
  },
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    maxZoom: 20
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri',
    maxZoom: 19
  }
} as const

/** Punto azul del dispositivo con cono de rumbo, al estilo de Mapas de iOS. */
function deviceIcon(heading: number, moving: boolean): L.DivIcon {
  return L.divIcon({
    className: '',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    html: `
      <div class="device-marker">
        <div class="device-marker__pulse"></div>
        ${moving ? `<div class="device-marker__heading" style="transform: rotate(${heading}deg)"></div>` : ''}
        <div class="device-marker__dot"></div>
      </div>`
  })
}

function waypointIcon(index: number, total: number): L.DivIcon {
  const modifier =
    index === 0 ? ' waypoint-marker--start' : index === total - 1 ? ' waypoint-marker--end' : ''
  return L.divIcon({
    className: '',
    iconSize: [24, 24],
    iconAnchor: [12, 24],
    html: `<div class="waypoint-marker${modifier}"><span>${index + 1}</span></div>`
  })
}

/** Traduce clics del mapa a la acción del modo activo. */
function MapInteractions(): null {
  const mode = useStore((s) => s.mode)
  const addWaypoint = useStore((s) => s.addWaypoint)
  const setWaypoints = useStore((s) => s.setWaypoints)

  useMapEvents({
    click(event) {
      const point: LatLng = { lat: event.latlng.lat, lng: event.latlng.lng }
      if (mode === 'teleport' || mode === 'joystick') {
        // Un único destino: el clic reemplaza el pin anterior.
        setWaypoints([point])
      } else {
        addWaypoint(point)
      }
    }
  })

  return null
}

/**
 * Sigue al marcador sin pelearse con el usuario: si arrastra el mapa a mano,
 * se desactiva el seguimiento automático hasta que lo vuelva a pedir.
 */
function CameraController(): null {
  const map = useMap()
  const follow = useStore((s) => s.followMarker)
  const current = useStore((s) => s.sim.current)
  const setFollow = useStore((s) => s.setFollow)
  const programmatic = useRef(false)

  useEffect(() => {
    if (!follow || !current) return
    programmatic.current = true
    map.panTo([current.lat, current.lng], { animate: true, duration: 0.35 })
    const timer = setTimeout(() => {
      programmatic.current = false
    }, 450)
    return () => clearTimeout(timer)
  }, [follow, current?.lat, current?.lng, map])

  useMapEvents({
    dragstart() {
      if (!programmatic.current && follow) setFollow(false)
    },
    moveend() {
      const center = map.getCenter()
      void window.geopilot.storage.updateSettings({
        lastCenter: { lat: center.lat, lng: center.lng },
        lastZoom: map.getZoom()
      })
    }
  })

  return null
}

/** Encuadra la ruta completa cada vez que se recalcula el plan. */
function FitPlan(): null {
  const map = useMap()
  const plan = useStore((s) => s.plan)
  const signature = plan ? `${plan.polyline.length}:${Math.round(plan.distanceMeters)}` : null
  const lastSignature = useRef<string | null>(null)

  useEffect(() => {
    if (!plan || plan.polyline.length < 2 || signature === lastSignature.current) return
    lastSignature.current = signature
    const bounds = L.latLngBounds(plan.polyline.map((p) => [p.lat, p.lng] as [number, number]))
    map.fitBounds(bounds, { padding: [180, 120], maxZoom: 17 })
  }, [signature, map, plan])

  return null
}

export default function MapView(): JSX.Element {
  const center = useStore((s) => s.center)
  const zoom = useStore((s) => s.zoom)
  const mapStyle = useStore((s) => s.mapStyle)
  const waypoints = useStore((s) => s.waypoints)
  const plan = useStore((s) => s.plan)
  const sim = useStore((s) => s.sim)
  const mode = useStore((s) => s.mode)
  const updateWaypoint = useStore((s) => s.updateWaypoint)

  const tiles = TILE_LAYERS[mapStyle]

  const handlers = useMemo(
    () =>
      waypoints.map((_, index) => ({
        dragend(event: L.DragEndEvent) {
          const { lat, lng } = (event.target as L.Marker).getLatLng()
          updateWaypoint(index, { lat, lng })
        }
      })),
    [waypoints, updateWaypoint]
  )

  const polylinePositions = useMemo(
    () => (plan ? plan.polyline.map((p) => [p.lat, p.lng] as [number, number]) : []),
    [plan]
  )

  // Traza discontinua entre waypoints mientras no hay ruta calculada, para que
  // el usuario vea el orden de los puntos antes de pulsar «Calcular».
  const draftPositions = useMemo(
    () => (!plan && waypoints.length > 1 ? waypoints.map((p) => [p.lat, p.lng] as [number, number]) : []),
    [plan, waypoints]
  )

  const showDeviceMarker = sim.current !== null
  const moving = sim.active && sim.speedKmh > 0.3

  const renderWaypoints = useCallback(
    () =>
      waypoints.map((point, index) => (
        <Marker
          key={`wp-${index}-${point.lat.toFixed(6)}-${point.lng.toFixed(6)}`}
          position={[point.lat, point.lng]}
          icon={waypointIcon(index, waypoints.length)}
          draggable
          eventHandlers={handlers[index]}
        />
      )),
    [waypoints, handlers]
  )

  return (
    <div className="map">
      <MapContainer
        center={[center.lat, center.lng]}
        zoom={zoom}
        zoomControl
        attributionControl
        preferCanvas
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer url={tiles.url} attribution={tiles.attribution} maxZoom={tiles.maxZoom} />

        <MapInteractions />
        <CameraController />
        <FitPlan />

        {draftPositions.length > 0 && (
          <Polyline
            positions={draftPositions}
            pathOptions={{ color: '#8b949e', weight: 2, dashArray: '6 8', opacity: 0.75 }}
          />
        )}

        {polylinePositions.length > 0 && (
          <>
            <Polyline
              positions={polylinePositions}
              pathOptions={{ color: '#0d1117', weight: 8, opacity: 0.5 }}
            />
            <Polyline
              positions={polylinePositions}
              pathOptions={{ color: '#2f81f7', weight: 4, opacity: 0.95 }}
            />
          </>
        )}

        {mode !== 'joystick' && renderWaypoints()}

        {showDeviceMarker && (
          <Marker
            position={[sim.current!.lat, sim.current!.lng]}
            icon={deviceIcon(sim.heading, moving)}
            zIndexOffset={1000}
            interactive={false}
          />
        )}
      </MapContainer>
    </div>
  )
}
