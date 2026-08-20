import { useCallback, useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from 'react'
import type { JoystickVector } from '@shared/types'

const RADIUS = 62 // recorrido máximo del knob, en px

/**
 * Joystick analógico de 360°. La magnitud es proporcional a la distancia al
 * centro, de modo que el mismo control sirve para caminar despacio o correr
 * sin tocar el slider de velocidad.
 */
export default function Joystick({
  onChange,
  disabled
}: {
  onChange: (vector: JoystickVector) => void
  disabled?: boolean
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)

  const update = useCallback(
    (clientX: number, clientY: number) => {
      const element = ref.current
      if (!element) return

      const rect = element.getBoundingClientRect()
      const dx = clientX - (rect.left + rect.width / 2)
      const dy = clientY - (rect.top + rect.height / 2)

      const distance = Math.hypot(dx, dy)
      const scale = distance > RADIUS ? RADIUS / distance : 1
      const x = dx * scale
      const y = dy * scale

      setOffset({ x, y })

      // El eje Y de pantalla crece hacia abajo; el rumbo se mide hacia el norte.
      const heading = (((Math.atan2(x, -y) * 180) / Math.PI) + 360) % 360
      onChange({ heading, magnitude: Math.min(1, distance / RADIUS) })
    },
    [onChange]
  )

  const handleDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (disabled) return
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
    update(event.clientX, event.clientY)
  }

  const handleMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!dragging) return
    update(event.clientX, event.clientY)
  }

  const handleUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!dragging) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    setDragging(false)
    setOffset({ x: 0, y: 0 })
    // Magnitud 0 detiene el avance pero conserva el último rumbo.
    onChange({ heading: 0, magnitude: 0 })
  }

  return (
    <div
      className="joystick"
      ref={ref}
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerCancel={handleUp}
      style={disabled ? { opacity: 0.4, pointerEvents: 'none' } : undefined}
    >
      <div className="joystick__ring" />
      <span className="joystick__compass joystick__compass--n">N</span>
      <span className="joystick__compass joystick__compass--e">E</span>
      <span className="joystick__compass joystick__compass--s">S</span>
      <span className="joystick__compass joystick__compass--w">O</span>
      <div
        className={`joystick__knob${dragging ? ' joystick__knob--dragging' : ''}`}
        style={{ transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))` }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.85)" strokeWidth="2" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </div>
    </div>
  )
}
