import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { app } from 'electron'

export interface ResolvedRuntime {
  /** Ejecutable a lanzar. */
  command: string
  /** Argumentos previos a los del sidecar. */
  args: string[]
  /** cwd del proceso hijo. */
  cwd: string
  kind: 'frozen' | 'venv' | 'system'
  /** Intérprete real, para que tunneld se lance con el mismo entorno. */
  interpreter: string | null
}

const isWindows = process.platform === 'win32'
const FROZEN_NAME = isWindows ? 'geopilot-bridge.exe' : 'geopilot-bridge'

function projectRoot(): string {
  // En dev, app.getAppPath() apunta a la raíz del proyecto.
  return app.isPackaged ? process.resourcesPath : app.getAppPath()
}

function venvPython(root: string): string {
  return isWindows
    ? join(root, 'native', '.venv', 'Scripts', 'python.exe')
    : join(root, 'native', '.venv', 'bin', 'python')
}

function pythonHasBridgeDeps(interpreter: string): boolean {
  try {
    execFileSync(interpreter, ['-c', 'import pymobiledevice3'], {
      stdio: 'ignore',
      timeout: 20_000
    })
    return true
  } catch {
    return false
  }
}

function candidateSystemPythons(): string[] {
  if (isWindows) return ['py', 'python', 'python3']
  return [
    '/opt/homebrew/bin/python3.12',
    '/opt/homebrew/bin/python3.11',
    '/opt/homebrew/bin/python3',
    '/usr/local/bin/python3',
    'python3'
  ]
}

/**
 * Localiza el runtime del sidecar.
 *
 * Prioridad: binario congelado (release) → venv del proyecto (dev) →
 * intérprete del sistema con pymobiledevice3 instalado.
 */
export function resolveRuntime(): ResolvedRuntime {
  const root = projectRoot()

  const override = process.env.GEOPILOT_PYTHON
  if (override && existsSync(override)) {
    return {
      command: override,
      args: ['-m', 'ubiq_bridge'],
      cwd: join(root, 'native'),
      kind: 'system',
      interpreter: override
    }
  }

  // 1. Binario PyInstaller empaquetado.
  const frozen = join(root, 'bridge', FROZEN_NAME)
  if (existsSync(frozen)) {
    return { command: frozen, args: [], cwd: join(root, 'bridge'), kind: 'frozen', interpreter: null }
  }

  // 2. Entorno virtual del repo (flujo de desarrollo).
  const venv = venvPython(root)
  if (existsSync(venv)) {
    return {
      command: venv,
      args: ['-m', 'ubiq_bridge'],
      cwd: join(root, 'native'),
      kind: 'venv',
      interpreter: venv
    }
  }

  // 3. Python del sistema. Se exige que tenga pymobiledevice3 para no lanzar
  //    un proceso condenado a fallar en el import.
  const sourceDir = app.isPackaged ? join(root, 'bridge-src') : join(root, 'native')
  for (const candidate of candidateSystemPythons()) {
    if (pythonHasBridgeDeps(candidate)) {
      return {
        command: candidate,
        args: ['-m', 'ubiq_bridge'],
        cwd: sourceDir,
        kind: 'system',
        interpreter: candidate
      }
    }
  }

  throw new Error(
    'PYTHON_MISSING: no se encontró un Python con pymobiledevice3 instalado. ' +
      'Ejecuta `npm run python:setup` (macOS/Linux) o `npm run python:setup:win` (Windows).'
  )
}
