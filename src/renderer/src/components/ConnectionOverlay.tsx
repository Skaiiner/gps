import { useState, type JSX, type ReactNode } from 'react'
import { useStore } from '../store/useStore'
import { IconAlert, IconPhone, IconShield, IconUsb } from './Icons'

interface Step {
  text: ReactNode
}

function Steps({ steps }: { steps: Step[] }): JSX.Element {
  return (
    <div className="overlay__steps">
      {steps.map((step, index) => (
        <div className="overlay__step" key={index}>
          <span className="overlay__step-num">{index + 1}</span>
          <span>{step.text}</span>
        </div>
      ))}
    </div>
  )
}

/**
 * Capa de onboarding «Plug & Play». Cada estado de conexión bloqueante tiene
 * su propia pantalla con los pasos exactos a seguir en el iPhone: es la
 * diferencia entre una herramienta usable y una que devuelve «error -1».
 */
export default function ConnectionOverlay(): JSX.Element | null {
  const connection = useStore((s) => s.connection)
  const error = useStore((s) => s.connectionError)
  const ddiMessage = useStore((s) => s.ddiMessage)
  const bridge = useStore((s) => s.bridge)
  const activeUdid = useStore((s) => s.activeUdid)
  const devices = useStore((s) => s.devices)
  const [working, setWorking] = useState(false)

  if (connection === 'ready' || connection === 'simulating') return null

  const device = devices.find((d) => d.udid === activeUdid) ?? null

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setWorking(true)
    try {
      await fn()
    } catch (err) {
      useStore.getState().toast({
        kind: 'error',
        title: 'No se pudo completar la acción',
        message: (err as Error).message
      })
    } finally {
      setWorking(false)
    }
  }

  const retry = (): Promise<unknown> =>
    activeUdid ? window.geopilot.devices.prepare(activeUdid) : window.geopilot.devices.refresh()

  // ------------------------------------------------------------------ vistas
  const views: Partial<Record<typeof connection, JSX.Element>> = {
    'bridge-starting': (
      <>
        <div className="spinner" />
        <h2 className="overlay__title">Conectando con el motor de dispositivos…</h2>
        <p className="overlay__text">
          Cargando el módulo de comunicación con dispositivos iOS.
        </p>
      </>
    ),

    'bridge-error': (
      <>
        <div className="overlay__icon overlay__icon--error">
          <IconAlert />
        </div>
        <h2 className="overlay__title">No se pudo iniciar el motor de dispositivos</h2>
        <p className="overlay__text">
          {error?.message ?? bridge.lastError ?? 'Falta el entorno de Python o pymobiledevice3.'}
        </p>
        <Steps
          steps={[
            { text: 'Instala Python 3.11 o superior en el sistema.' },
            {
              text: (
                <>
                  Ejecuta el instalador de dependencias del proyecto:
                  <code className="overlay__code">
                    npm run python:setup{'\n'}# En Windows: npm run python:setup:win
                  </code>
                </>
              )
            },
            { text: 'Vuelve a intentarlo con el botón de abajo.' }
          ]}
        />
        <div className="overlay__actions">
          <button
            className="btn btn--primary"
            disabled={working}
            onClick={() => void run(() => window.geopilot.bridge.restart())}
            type="button"
          >
            Reiniciar el puente
          </button>
        </div>
        {error?.detail && <div className="overlay__detail">{error.detail}</div>}
      </>
    ),

    waiting: (
      <>
        <div className="usb-animation">
          <div className="usb-animation__phone" style={{ color: 'var(--accent)' }}>
            <IconUsb size={62} />
          </div>
        </div>
        <h2 className="overlay__title">Conecta tu iPhone por cable</h2>
        <p className="overlay__text">
          Enchufa el dispositivo con un cable de datos USB. GeoPilot lo detectará automáticamente.
        </p>
        <Steps
          steps={[
            { text: 'Usa un cable de datos original (algunos cables sólo cargan).' },
            { text: 'Desbloquea la pantalla del iPhone.' },
            { text: 'Si aparece el aviso «¿Confiar en este ordenador?», pulsa Confiar.' }
          ]}
        />
        <div className="overlay__actions">
          <button
            className="btn"
            disabled={working}
            onClick={() => void run(() => window.geopilot.devices.refresh())}
            type="button"
          >
            Buscar de nuevo
          </button>
        </div>
      </>
    ),

    untrusted: (
      <>
        <div className="overlay__icon">
          <IconShield />
        </div>
        <h2 className="overlay__title">Confía en este ordenador</h2>
        <p className="overlay__text">
          {device?.name ?? 'El iPhone'} está conectado pero todavía no autoriza a este equipo a
          comunicarse con él.
        </p>
        <Steps
          steps={[
            { text: 'Desbloquea el iPhone con tu código.' },
            { text: 'Pulsa «Confiar» en el aviso que aparece en pantalla.' },
            { text: 'Vuelve a introducir el código si el sistema lo pide.' }
          ]}
        />
        <div className="overlay__actions">
          <button
            className="btn btn--primary"
            disabled={working || !activeUdid}
            onClick={() => void run(() => window.geopilot.devices.pair(activeUdid!))}
            type="button"
          >
            {working ? 'Esperando…' : 'Mostrar el aviso de confianza'}
          </button>
          <button className="btn" disabled={working} onClick={() => void run(retry)} type="button">
            Ya he confiado
          </button>
        </div>
      </>
    ),

    locked: (
      <>
        <div className="overlay__icon overlay__icon--warn">
          <IconPhone size={30} />
        </div>
        <h2 className="overlay__title">Desbloquea el iPhone</h2>
        <p className="overlay__text">
          El dispositivo está protegido con código. Introdúcelo para que el sistema autorice la
          conexión.
        </p>
        <div className="overlay__actions">
          <button
            className="btn btn--primary"
            disabled={working}
            onClick={() => void run(retry)}
            type="button"
          >
            Ya está desbloqueado
          </button>
        </div>
      </>
    ),

    'dev-mode-required': (
      <>
        <div className="overlay__icon overlay__icon--warn">
          <IconShield />
        </div>
        <h2 className="overlay__title">Activa el Modo Desarrollador</h2>
        <p className="overlay__text">
          Desde iOS 16, Apple exige activar el Modo Desarrollador para usar los servicios de
          instrumentación que permiten simular la ubicación. Sólo hay que hacerlo una vez.
        </p>
        <Steps
          steps={[
            {
              text: (
                <>
                  Pulsa <b>Preparar el iPhone</b>: el interruptor aparecerá en el dispositivo.
                </>
              )
            },
            {
              text: (
                <>
                  En el iPhone, ve a <b>Ajustes › Privacidad y seguridad › Modo de desarrollador</b>{' '}
                  y actívalo.
                </>
              )
            },
            { text: 'Acepta reiniciar el dispositivo y, tras el arranque, confirma con tu código.' },
            { text: 'Vuelve aquí: la detección se reanuda sola.' }
          ]}
        />
        <div className="overlay__actions">
          <button
            className="btn btn--primary"
            disabled={working || !activeUdid}
            onClick={() =>
              void run(async () => {
                await window.geopilot.devices.revealDeveloperMode(activeUdid!)
                await window.geopilot.devices.enableDeveloperMode(activeUdid!)
                useStore.getState().toast({
                  kind: 'info',
                  title: 'Continúa en el iPhone',
                  message: 'Activa el interruptor en Ajustes › Privacidad y seguridad.'
                })
              })
            }
            type="button"
          >
            {working ? 'Preparando…' : 'Preparar el iPhone'}
          </button>
          <button className="btn" disabled={working} onClick={() => void run(retry)} type="button">
            Ya lo he activado
          </button>
        </div>
      </>
    ),

    mounting: (
      <>
        <div className="spinner" />
        <h2 className="overlay__title">Preparando el dispositivo</h2>
        <p className="overlay__text">
          {ddiMessage ?? 'Montando la imagen de disco de desarrollador…'}
        </p>
        <p className="overlay__text" style={{ fontSize: 12.5 }}>
          La primera vez con cada versión de iOS hay que descargar la imagen (y, en iOS 17 o
          superior, obtener un permiso firmado por Apple). Puede tardar hasta un minuto.
        </p>
      </>
    ),

    'tunnel-required': (
      <>
        <div className="overlay__icon overlay__icon--warn">
          <IconUsb size={30} />
        </div>
        <h2 className="overlay__title">Activa el túnel para iOS 17+</h2>
        <p className="overlay__text">
          A partir de iOS 17 los servicios de desarrollo viajan por una interfaz de red virtual
          sobre el propio cable. Crearla requiere permisos de administrador, así que el sistema te
          pedirá tu contraseña.
        </p>
        <Steps
          steps={[
            { text: 'Mantén el iPhone conectado y desbloqueado.' },
            { text: 'Pulsa «Iniciar túnel» y autoriza cuando el sistema lo solicite.' },
            { text: 'El túnel queda activo hasta que reinicies el ordenador.' }
          ]}
        />
        <div className="overlay__actions">
          <button
            className="btn btn--primary"
            disabled={working}
            onClick={() => void run(() => window.geopilot.tunnel.start())}
            type="button"
          >
            {working ? 'Solicitando permisos…' : 'Iniciar túnel'}
          </button>
          <button className="btn" disabled={working} onClick={() => void run(retry)} type="button">
            Reintentar
          </button>
        </div>
        <details style={{ marginTop: 16, textAlign: 'left', fontSize: 12 }}>
          <summary style={{ cursor: 'pointer', color: 'var(--text-dim)' }}>
            Prefiero lanzarlo manualmente
          </summary>
          <code className="overlay__code">
            sudo python3 -m pymobiledevice3 remote tunneld
          </code>
        </details>
      </>
    )
  }

  const content = views[connection]
  if (!content) return null

  return (
    <div className="overlay">
      <div className="overlay__card">{content}</div>
    </div>
  )
}
