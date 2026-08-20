import type { JSX } from 'react'
import { useStore } from '../store/useStore'
import { IconAlert } from './Icons'

/**
 * Aviso único la primera vez que se abre el canal.
 *
 * GeoPilot sólo transmite latitud y longitud, pero iOS tiene un servicio del
 * sistema que deduce la zona horaria de la ubicación: al aparecer en otro
 * continente, el reloj del iPhone salta. Es la sorpresa número uno de este
 * tipo de herramientas y no se puede desactivar desde el ordenador, así que lo
 * único honesto es explicarlo antes de que ocurra.
 */
export default function TimezoneNotice(): JSX.Element | null {
  const visible = useStore((s) => s.showTimezoneNotice)

  if (!visible) return null

  const dismiss = (remember: boolean): void => {
    useStore.getState().setShowTimezoneNotice(false)
    if (remember) void window.geopilot.storage.updateSettings({ timezoneNoticeSeen: true })
  }

  return (
    <div className="overlay">
      <div className="overlay__card">
        <div className="overlay__icon overlay__icon--warn">
          <IconAlert />
        </div>
        <h2 className="overlay__title">Evita que cambie la hora del iPhone</h2>
        <p className="overlay__text">
          GeoPilot envía <b>únicamente latitud y longitud</b>. Pero iOS deduce la zona horaria a
          partir de la ubicación, así que al situarte en otro país el reloj del iPhone se ajustará
          solo. Desactiva ese vínculo y sólo cambiará la ubicación.
        </p>

        <div className="overlay__steps">
          <div className="overlay__step">
            <span className="overlay__step-num">1</span>
            <span>
              En el iPhone, abre <b>Ajustes › Privacidad y seguridad › Localización</b>.
            </span>
          </div>
          <div className="overlay__step">
            <span className="overlay__step-num">2</span>
            <span>
              Baja del todo y entra en <b>Servicios del sistema</b>.
            </span>
          </div>
          <div className="overlay__step">
            <span className="overlay__step-num">3</span>
            <span>
              Desactiva <b>Configurar zona horaria</b>.
            </span>
          </div>
        </div>

        <p className="overlay__text" style={{ fontSize: 12.5 }}>
          ¿No aparece esa opción? Alternativa equivalente: <b>Ajustes › General › Fecha y hora</b>,
          desactiva «Ajustar automáticamente» y elige tu zona a mano.
        </p>

        <div className="overlay__actions">
          <button className="btn btn--primary" onClick={() => dismiss(true)} type="button">
            Entendido, no volver a mostrar
          </button>
          <button className="btn" onClick={() => dismiss(false)} type="button">
            Recordármelo luego
          </button>
        </div>
      </div>
    </div>
  )
}
