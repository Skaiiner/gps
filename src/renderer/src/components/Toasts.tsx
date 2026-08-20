import { useEffect, type JSX } from 'react'
import { useStore } from '../store/useStore'

const AUTO_DISMISS_MS = 5200

export default function Toasts(): JSX.Element {
  const toasts = useStore((s) => s.toasts)
  const dismiss = useStore((s) => s.dismissToast)

  useEffect(() => {
    if (toasts.length === 0) return
    const timers = toasts.map((toast) =>
      setTimeout(() => dismiss(toast.id), AUTO_DISMISS_MS)
    )
    return () => timers.forEach(clearTimeout)
  }, [toasts, dismiss])

  return (
    <div className="toasts">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast toast--${toast.kind}`}
          onClick={() => dismiss(toast.id)}
          role="status"
        >
          <div className="toast__title">{toast.title}</div>
          {toast.message && <div className="toast__message">{toast.message}</div>}
        </div>
      ))}
    </div>
  )
}
