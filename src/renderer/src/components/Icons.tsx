import type { JSX, SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

/** Iconos inline (stroke 1.8, grid 24) para no arrastrar una librería entera. */
function Svg({ size = 20, children, ...rest }: IconProps & { children: JSX.Element }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {children}
    </svg>
  )
}

export const IconPin = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <g>
      <path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.6" />
    </g>
  </Svg>
)

export const IconRoute = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <g>
      <circle cx="6" cy="19" r="2.4" />
      <circle cx="18" cy="5" r="2.4" />
      <path d="M8.4 19h5.1a4 4 0 0 0 0-8h-3a4 4 0 0 1 0-8h5.1" />
    </g>
  </Svg>
)

export const IconMultiRoute = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <g>
      <circle cx="5" cy="6" r="2" />
      <circle cx="12" cy="17" r="2" />
      <circle cx="19" cy="8" r="2" />
      <path d="m6.6 7.4 4 8M13.6 15.7 17.4 9.6" />
    </g>
  </Svg>
)

export const IconJoystick = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <g>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="2.6" />
      <path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2" />
    </g>
  </Svg>
)

export const IconLibrary = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <g>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H8v16H5.5A1.5 1.5 0 0 1 4 18.5Z" />
      <path d="M11 4h2.6v16H11z" />
      <path d="m16.6 4.8 2.4.6a1.4 1.4 0 0 1 1 1.7l-3.2 12.3-3.4-.9" />
    </g>
  </Svg>
)

export const IconSettings = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <g>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .33 1.77l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.6 1.6 0 0 0-1.77-.33 1.6 1.6 0 0 0-1 1.47V21a2 2 0 1 1-4 0v-.11a1.6 1.6 0 0 0-1.05-1.47 1.6 1.6 0 0 0-1.77.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.6 1.6 0 0 0 4.6 15a1.6 1.6 0 0 0-1.47-1H3a2 2 0 1 1 0-4h.11a1.6 1.6 0 0 0 1.47-1.05 1.6 1.6 0 0 0-.33-1.77l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.6 1.6 0 0 0 9 4.6a1.6 1.6 0 0 0 1-1.47V3a2 2 0 1 1 4 0v.11a1.6 1.6 0 0 0 1 1.47 1.6 1.6 0 0 0 1.77-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.6 1.6 0 0 0-.33 1.77V9a1.6 1.6 0 0 0 1.47 1H21a2 2 0 1 1 0 4h-.11a1.6 1.6 0 0 0-1.47 1Z" />
    </g>
  </Svg>
)

export const IconSearch = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <g>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.6-3.6" />
    </g>
  </Svg>
)

export const IconPlay = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M7 4.8v14.4l12-7.2z" fill="currentColor" stroke="none" />
  </Svg>
)

export const IconPause = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <g fill="currentColor" stroke="none">
      <rect x="6.5" y="5" width="4" height="14" rx="1.2" />
      <rect x="13.5" y="5" width="4" height="14" rx="1.2" />
    </g>
  </Svg>
)

export const IconStop = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />
  </Svg>
)

export const IconTrash = (p: IconProps): JSX.Element => (
  <Svg {...p} size={p.size ?? 16}>
    <g>
      <path d="M4 7h16M9.5 7V5.4A1.4 1.4 0 0 1 10.9 4h2.2a1.4 1.4 0 0 1 1.4 1.4V7" />
      <path d="M6.5 7 7.4 19a1.4 1.4 0 0 0 1.4 1.3h6.4a1.4 1.4 0 0 0 1.4-1.3L17.5 7" />
    </g>
  </Svg>
)

export const IconStar = ({ filled, ...p }: IconProps & { filled?: boolean }): JSX.Element => (
  <Svg {...p} size={p.size ?? 16}>
    <path
      d="m12 4 2.5 5.2 5.5.8-4 3.9.9 5.6-4.9-2.7-4.9 2.7.9-5.6-4-3.9 5.5-.8z"
      fill={filled ? 'currentColor' : 'none'}
    />
  </Svg>
)

export const IconCrosshair = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <g>
      <circle cx="12" cy="12" r="7.5" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
    </g>
  </Svg>
)

export const IconLayers = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <g>
      <path d="m12 3 8.5 4.6L12 12.2 3.5 7.6z" />
      <path d="m4.4 12 7.6 4.1 7.6-4.1M4.4 16.3l7.6 4.1 7.6-4.1" />
    </g>
  </Svg>
)

export const IconUsb = (p: IconProps): JSX.Element => (
  <Svg {...p} size={p.size ?? 28}>
    <g>
      <circle cx="12" cy="20.5" r="1.6" />
      <path d="M12 18.9V4.5" />
      <path d="m9 7.5 3-3 3 3" />
      <path d="M12 12.5 8 15v2.4M12 10.2l4 2.4v2" />
      <rect x="6.6" y="17" width="2.8" height="2.8" rx="0.6" />
      <circle cx="16" cy="13.4" r="1.4" />
    </g>
  </Svg>
)

export const IconPhone = (p: IconProps): JSX.Element => (
  <Svg {...p} size={p.size ?? 40}>
    <g>
      <rect x="6.5" y="2.5" width="11" height="19" rx="2.6" />
      <path d="M10.4 5.2h3.2" />
      <circle cx="12" cy="18.4" r="0.9" fill="currentColor" />
    </g>
  </Svg>
)

export const IconShield = (p: IconProps): JSX.Element => (
  <Svg {...p} size={p.size ?? 28}>
    <g>
      <path d="M12 3 5 6v5.6c0 4.4 3 8.1 7 9.4 4-1.3 7-5 7-9.4V6z" />
      <path d="m9.2 12 2 2 3.6-3.8" />
    </g>
  </Svg>
)

export const IconDownload = (p: IconProps): JSX.Element => (
  <Svg {...p} size={p.size ?? 16}>
    <g>
      <path d="M12 3.5v11M8 11l4 4 4-4M4.5 19.5h15" />
    </g>
  </Svg>
)

export const IconUpload = (p: IconProps): JSX.Element => (
  <Svg {...p} size={p.size ?? 16}>
    <g>
      <path d="M12 15.5v-11M8 8l4-4 4 4M4.5 19.5h15" />
    </g>
  </Svg>
)

export const IconPlus = (p: IconProps): JSX.Element => (
  <Svg {...p} size={p.size ?? 16}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
)

export const IconRefresh = (p: IconProps): JSX.Element => (
  <Svg {...p} size={p.size ?? 16}>
    <g>
      <path d="M20 11.5a8 8 0 1 0-1.9 6.6" />
      <path d="M20 4.5v5h-5" />
    </g>
  </Svg>
)

export const IconAlert = (p: IconProps): JSX.Element => (
  <Svg {...p} size={p.size ?? 28}>
    <g>
      <path d="M12 3.5 21 19.5H3z" />
      <path d="M12 9.5v4.5M12 17h.01" />
    </g>
  </Svg>
)
