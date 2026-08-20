import { useEffect, type JSX } from 'react'
import { useStore } from '../../store/useStore'
import { syncOptions } from '../../lib/actions'
import { Segmented, SliderField, StatRow, Switch } from '../ui'
import { IconRefresh } from '../Icons'

export default function SettingsPanel(): JSX.Element {
  const humanize = useStore((s) => s.humanize)
  const mapStyle = useStore((s) => s.mapStyle)
  const bridge = useStore((s) => s.bridge)
  const devices = useStore((s) => s.devices)
  const activeUdid = useStore((s) => s.activeUdid)

  const device = devices.find((d) => d.udid === activeUdid) ?? null

  // Los cambios se propagan al motor y se persisten en cuanto se sueltan.
  useEffect(() => {
    void syncOptions()
    void window.geopilot.storage.updateSettings({
      humanizeEnabled: humanize.enabled,
      jitterMeters: humanize.jitterMeters,
      speedVariance: humanize.speedVariance,
      pausesEnabled: humanize.pausesEnabled
    })
  }, [humanize])

  return (
    <>
      <div className="panel__header">
        <h2 className="panel__title">Ajustes</h2>
        <p className="panel__subtitle">Realismo del movimiento, mapa y diagnóstico.</p>
      </div>

      <div className="panel__body">
        <div className="field">
          <span className="field__label">Simulación realista</span>
          <Switch
            label="Humanizar el movimiento"
            hint="Añade el ruido y la irregularidad propios de un GPS real."
            checked={humanize.enabled}
            onChange={(enabled) => useStore.getState().setHumanize({ enabled })}
          />
        </div>

        <SliderField
          label="Deriva de posición"
          value={humanize.jitterMeters}
          display={`± ${humanize.jitterMeters.toFixed(1)} m`}
          min={0}
          max={15}
          step={0.5}
          disabled={!humanize.enabled}
          onChange={(jitterMeters) => useStore.getState().setHumanize({ jitterMeters })}
        />
        <span style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: -8, lineHeight: 1.5 }}>
          Un receptor GNSS de móvil tiene un error típico de 3 a 8 m en exteriores. Con 0 m las
          coordenadas quedan matemáticamente perfectas, algo que no ocurre en la realidad.
        </span>

        <SliderField
          label="Fluctuación de velocidad"
          value={Math.round(humanize.speedVariance * 100)}
          display={`± ${Math.round(humanize.speedVariance * 100)} %`}
          min={0}
          max={45}
          step={1}
          disabled={!humanize.enabled}
          onChange={(percent) => useStore.getState().setHumanize({ speedVariance: percent / 100 })}
        />

        <Switch
          label="Micro-pausas"
          hint="Detenciones cortas y aleatorias, como esperas en semáforos."
          checked={humanize.pausesEnabled}
          disabled={!humanize.enabled}
          onChange={(pausesEnabled) => useStore.getState().setHumanize({ pausesEnabled })}
        />

        <div className="divider" />

        <div className="field">
          <span className="field__label">Ajustes del iPhone</span>
          <p style={{ fontSize: 11.5, color: 'var(--text-faint)', lineHeight: 1.55, margin: 0 }}>
            GeoPilot sólo envía latitud y longitud, pero iOS deduce la zona horaria de la ubicación
            y cambiará el reloj al viajar a otro país.
          </p>
          <button
            className="btn btn--sm btn--block"
            type="button"
            onClick={() => useStore.getState().setShowTimezoneNotice(true)}
          >
            Cómo evitar que cambie la hora
          </button>
        </div>

        <div className="divider" />

        <div className="field">
          <span className="field__label">Estilo del mapa</span>
          <Segmented
            value={mapStyle}
            options={[
              { value: 'streets', label: 'Calles' },
              { value: 'dark', label: 'Oscuro' },
              { value: 'satellite', label: 'Satélite' }
            ]}
            onChange={(value) => {
              useStore.getState().setMapStyle(value)
              void window.geopilot.storage.updateSettings({ mapStyle: value })
            }}
          />
        </div>

        <div className="divider" />

        <div className="field">
          <span className="field__label">
            Diagnóstico
            <button
              className="icon-btn"
              title="Reiniciar el puente"
              type="button"
              onClick={async () => {
                await window.geopilot.bridge.restart()
                useStore.getState().toast({ kind: 'info', title: 'Puente reiniciado' })
              }}
            >
              <IconRefresh />
            </button>
          </span>
          <div>
            <StatRow label="Motor de dispositivos" value={bridge.running ? 'Activo' : 'Detenido'} />
            <StatRow label="pymobiledevice3" value={bridge.pymobiledevice3Version ?? '—'} />
            <StatRow label="Túnel iOS 17+" value={bridge.tunneldRunning ? 'Activo' : 'Inactivo'} />
            {device && (
              <>
                <StatRow label="Modelo" value={device.productType || '—'} />
                <StatRow label="iOS" value={device.productVersion || '—'} />
                <StatRow label="Imagen DDI" value={device.ddiMounted ? 'Montada' : 'No montada'} />
                <StatRow
                  label="Modo Desarrollador"
                  value={
                    device.developerModeEnabled === null
                      ? 'No aplica'
                      : device.developerModeEnabled
                        ? 'Activado'
                        : 'Desactivado'
                  }
                />
                <StatRow label="UDID" value={<code style={{ fontSize: 10 }}>{device.udid}</code>} />
              </>
            )}
          </div>
        </div>

        <div className="divider" />
        <p style={{ fontSize: 11, color: 'var(--text-faint)', lineHeight: 1.6, margin: 0 }}>
          Usa esta herramienta sólo con dispositivos de tu propiedad y para fines legítimos de
          desarrollo y pruebas. Falsear la ubicación puede infringir las condiciones de uso de
          aplicaciones de terceros.
        </p>
      </div>
    </>
  )
}
