import { useCallback, useEffect, useState, type JSX } from 'react'
import type { JoystickVector } from '@shared/types'
import { PROFILE_SPEEDS } from '@shared/types'
import { useIsReady, useStore } from '../../store/useStore'
import { startJoystick, stopSimulation, syncOptions } from '../../lib/actions'
import { useKeyboardControl } from '../../hooks/useKeyboardControl'
import { Segmented, SliderField, StatRow } from '../ui'
import Joystick from '../Joystick'
import { IconPlay, IconStop } from '../Icons'

const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO']

function cardinal(heading: number): string {
  return CARDINALS[Math.round(heading / 45) % 8]
}

export default function JoystickPanel(): JSX.Element {
  const sim = useStore((s) => s.sim)
  const speedKmh = useStore((s) => s.speedKmh)
  const profile = useStore((s) => s.profile)
  const ready = useIsReady()
  const [keysActive, setKeysActive] = useState<Set<string>>(new Set())

  const active = sim.active && sim.mode === 'joystick'

  const sendVector = useCallback((vector: JoystickVector) => {
    window.geopilot.sim.setJoystick(vector)
  }, [])

  // El teclado sólo se escucha con el joystick en marcha: si no, WASD
  // interferiría con el resto de la interfaz.
  useKeyboardControl({ enabled: active, onVector: sendVector })

  useEffect(() => {
    void syncOptions()
  }, [speedKmh])

  // Realce visual de las teclas pulsadas (sólo cosmético).
  useEffect(() => {
    if (!active) {
      setKeysActive(new Set())
      return
    }
    const down = (e: KeyboardEvent): void =>
      setKeysActive((prev) => new Set(prev).add(e.code))
    const up = (e: KeyboardEvent): void =>
      setKeysActive((prev) => {
        const next = new Set(prev)
        next.delete(e.code)
        return next
      })
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [active])

  const keyOn = (...codes: string[]): string =>
    codes.some((c) => keysActive.has(c)) ? ' keycap--active' : ''

  return (
    <>
      <div className="panel__header">
        <h2 className="panel__title">Joystick</h2>
        <p className="panel__subtitle">
          Movimiento libre en 360°. Arrastra el control o usa <b>WASD</b> / flechas; mantén{' '}
          <b>Shift</b> para ir a velocidad máxima.
        </p>
      </div>

      <div className="panel__body">
        <Joystick onChange={sendVector} disabled={!active} />

        <div className="keycaps">
          <div className={`keycap keycap--w${keyOn('KeyW', 'ArrowUp')}`}>W</div>
          <div className={`keycap${keyOn('KeyA', 'ArrowLeft')}`}>A</div>
          <div className={`keycap${keyOn('KeyS', 'ArrowDown')}`}>S</div>
          <div className={`keycap${keyOn('KeyD', 'ArrowRight')}`}>D</div>
        </div>

        <div className="divider" />

        <div className="field">
          <span className="field__label">Velocidad base</span>
          <Segmented
            value={profile === 'custom' ? 'walk' : profile}
            options={[
              { value: 'walk', label: 'A pie' },
              { value: 'run', label: 'Corriendo' },
              { value: 'bike', label: 'Bici' },
              { value: 'car', label: 'Coche' }
            ]}
            onChange={(value) => useStore.getState().setProfile(value)}
          />
        </div>

        <SliderField
          label="Velocidad máxima"
          value={speedKmh}
          display={`${speedKmh.toFixed(1)} km/h`}
          min={1}
          max={140}
          step={0.5}
          onChange={(value) => useStore.getState().setSpeed(value)}
        />
        <span style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: -8 }}>
          La inclinación del stick modula la velocidad entre 0 y este máximo (peatón ≈{' '}
          {PROFILE_SPEEDS.walk} km/h).
        </span>

        <div className="divider" />

        <div>
          <StatRow label="Rumbo" value={`${Math.round(sim.heading)}° ${cardinal(sim.heading)}`} />
          <StatRow label="Velocidad actual" value={`${sim.speedKmh.toFixed(1)} km/h`} />
          <StatRow
            label="Posición"
            value={
              sim.current
                ? `${sim.current.lat.toFixed(5)}, ${sim.current.lng.toFixed(5)}`
                : '—'
            }
          />
        </div>
      </div>

      <div className="panel__footer">
        {!active ? (
          <button
            className="btn btn--primary btn--block"
            disabled={!ready}
            onClick={() => void startJoystick()}
            type="button"
          >
            <IconPlay size={16} />
            Activar joystick
          </button>
        ) : (
          <button
            className="btn btn--danger btn--block"
            onClick={() => void stopSimulation()}
            type="button"
          >
            <IconStop size={15} />
            Detener
          </button>
        )}
      </div>
    </>
  )
}
