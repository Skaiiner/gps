import { useEffect, useRef } from 'react'
import type { JoystickVector } from '@shared/types'

const KEY_TO_AXIS: Record<string, [number, number]> = {
  // [x, y] con y positivo hacia el norte
  KeyW: [0, 1],
  ArrowUp: [0, 1],
  KeyS: [0, -1],
  ArrowDown: [0, -1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0]
}

interface Options {
  enabled: boolean
  onVector: (vector: JoystickVector) => void
  /** Shift = correr (magnitud completa); sin Shift, avance moderado. */
  walkMagnitude?: number
}

/**
 * Control por teclado con soporte de diagonales.
 *
 * Se acumulan los ejes de todas las teclas pulsadas en lugar de reaccionar a
 * la última: así W+D produce un rumbo real de 45° en vez de alternar entre
 * norte y este, que es como se comporta la mayoría de implementaciones
 * ingenuas y se nota inmediatamente en el mapa.
 */
export function useKeyboardControl({ enabled, onVector, walkMagnitude = 0.55 }: Options): void {
  const pressed = useRef(new Set<string>())
  const shift = useRef(false)
  const lastEmitted = useRef<JoystickVector>({ heading: 0, magnitude: 0 })

  useEffect(() => {
    if (!enabled) {
      pressed.current.clear()
      if (lastEmitted.current.magnitude !== 0) {
        lastEmitted.current = { heading: lastEmitted.current.heading, magnitude: 0 }
        onVector(lastEmitted.current)
      }
      return
    }

    const emit = (): void => {
      let x = 0
      let y = 0
      for (const code of pressed.current) {
        const axis = KEY_TO_AXIS[code]
        if (axis) {
          x += axis[0]
          y += axis[1]
        }
      }

      if (x === 0 && y === 0) {
        if (lastEmitted.current.magnitude !== 0) {
          lastEmitted.current = { ...lastEmitted.current, magnitude: 0 }
          onVector(lastEmitted.current)
        }
        return
      }

      // atan2(x, y): 0° = norte, sentido horario, que es el convenio de rumbo.
      const heading = (((Math.atan2(x, y) * 180) / Math.PI) + 360) % 360
      const magnitude = shift.current ? 1 : walkMagnitude
      lastEmitted.current = { heading, magnitude }
      onVector(lastEmitted.current)
    }

    const isTypingTarget = (target: EventTarget | null): boolean => {
      const el = target as HTMLElement | null
      return !!el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (isTypingTarget(event.target)) return
      if (event.key === 'Shift') {
        shift.current = true
        emit()
        return
      }
      if (!KEY_TO_AXIS[event.code]) return
      event.preventDefault()
      if (!pressed.current.has(event.code)) {
        pressed.current.add(event.code)
        emit()
      }
    }

    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.key === 'Shift') {
        shift.current = false
        emit()
        return
      }
      if (!KEY_TO_AXIS[event.code]) return
      pressed.current.delete(event.code)
      emit()
    }

    // Si la ventana pierde el foco con una tecla pulsada, el iPhone seguiría
    // caminando indefinidamente.
    const onBlur = (): void => {
      pressed.current.clear()
      shift.current = false
      emit()
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      pressed.current.clear()
    }
  }, [enabled, onVector, walkMagnitude])
}
