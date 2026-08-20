import type { JSX, ReactNode } from 'react'

export function Switch({
  checked,
  onChange,
  label,
  hint,
  disabled
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  hint?: string
  disabled?: boolean
}): JSX.Element {
  return (
    <label className="switch" style={disabled ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}>
      <span className="switch__text">
        {label}
        {hint && <span className="switch__hint">{hint}</span>}
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ display: 'none' }}
      />
      <span className={`switch__track${checked ? ' switch__track--on' : ''}`}>
        <span className="switch__knob" />
      </span>
    </label>
  )
}

export function SliderField({
  label,
  value,
  display,
  min,
  max,
  step = 1,
  onChange,
  disabled
}: {
  label: string
  value: number
  display: string
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
  disabled?: boolean
}): JSX.Element {
  return (
    <div className="field">
      <span className="field__label">
        {label}
        <span className="field__value">{display}</span>
      </span>
      <input
        className="slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}): JSX.Element {
  return (
    <div className="segmented">
      {options.map((option) => (
        <button
          key={option.value}
          className={`segmented__item${option.value === value ? ' segmented__item--active' : ''}`}
          onClick={() => onChange(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function StatRow({ label, value }: { label: string; value: ReactNode }): JSX.Element {
  return (
    <div className="stat-row">
      <span className="stat-row__label">{label}</span>
      <span className="stat-row__value">{value}</span>
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }): JSX.Element {
  return <div className="empty">{children}</div>
}

export function PanelSection({
  title,
  action,
  children
}: {
  title: string
  action?: ReactNode
  children: ReactNode
}): JSX.Element {
  return (
    <div className="field">
      <span className="field__label">
        {title}
        {action}
      </span>
      {children}
    </div>
  )
}
