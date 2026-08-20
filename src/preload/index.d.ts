import type { GeoPilotApi } from './index'

declare global {
  interface Window {
    geopilot: GeoPilotApi
  }
}

export {}
