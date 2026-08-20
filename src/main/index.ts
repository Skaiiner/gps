import { join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { createContext, registerIpc, wireEvents, type AppContext } from './ipc'

let ctx: AppContext | null = null
let mainWindow: BrowserWindow | null = null
let shuttingDown = false

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    backgroundColor: '#0d1117',
    // Barra de título integrada: el mapa ocupa la ventana entera, como en las
    // herramientas comerciales.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // Los tiles del mapa y las APIs de geocodificación son HTTPS externos.
      webSecurity: true
    }
  })

  window.on('ready-to-show', () => window.show())

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

// Instancia única: dos procesos peleándose por el mismo socket de usbmuxd
// dejan el dispositivo en un estado impredecible.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  void app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.geopilot.app')

    app.on('browser-window-created', (_event, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    ctx = createContext()
    wireEvents(ctx)
    registerIpc(ctx)
    ctx.bridge.start()

    mainWindow = createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

/**
 * Cierre ordenado: antes de salir hay que enviar STOP al dispositivo. Si el
 * proceso muere sin hacerlo, el iPhone se queda con la última coordenada
 * inyectada hasta que se reinicie, que es la queja número uno de los usuarios
 * de este tipo de herramientas.
 */
app.on('before-quit', (event) => {
  if (shuttingDown || !ctx) return
  event.preventDefault()
  shuttingDown = true

  const { engine, bridge } = ctx
  engine.stop('stopped')

  const finish = (): void => {
    void bridge.stop().finally(() => app.exit(0))
  }

  if (bridge.running) {
    void bridge
      .call('location.stop', { reset: true })
      .catch(() => undefined)
      .finally(finish)
  } else {
    finish()
  }
})
