# GeoPilot

Aplicación de escritorio (macOS · Windows · Linux) para **simular la ubicación GPS de un iPhone
en tiempo real por cable USB**, sin jailbreak, usando el servicio de desarrollo
`com.apple.dt.simulatelocation` que Apple expone en sus propios dispositivos.

Equivalente funcional a AnyGo / iAnyGo / Dr.Fone Virtual Location, con teleport, rutas por calles
reales, joystick y simulación de movimiento realista.

> **Uso responsable.** Esta herramienta usa las mismas interfaces que Xcode para probar
> aplicaciones dependientes de la ubicación. Úsala únicamente con dispositivos de tu propiedad y
> con fines legítimos de desarrollo, control de calidad o privacidad. Falsear la ubicación puede
> infringir las condiciones de servicio de aplicaciones de terceros (juegos, redes sociales,
> banca, apps de transporte) y, en algunos contextos, la ley. Tú eres responsable del uso que le des.

---

## 1. Cómo funciona

```
┌──────────────────────────────────────────────────────────────────────────┐
│  RENDERER (React + TypeScript + Leaflet)                                  │
│  Mapa fullscreen · panel lateral flotante · joystick · buscador           │
└───────────────────────────────▲──────────────────────────────────────────┘
                                │ IPC con contextIsolation (preload)
┌───────────────────────────────▼──────────────────────────────────────────┐
│  MAIN (Electron / Node)                                                   │
│  · DeviceManager  — máquina de estados de conexión                        │
│  · LocationEngine — interpolación, velocidad, humanización (bucle 10 Hz)  │
│  · RouteService   — geocodificación (Nominatim) y ruteo (OSRM)            │
│  · StorageService — favoritos, historial, rutas, GPX                      │
└───────────────────────────────▲──────────────────────────────────────────┘
                                │ JSON-RPC por stdin/stdout (líneas)
┌───────────────────────────────▼──────────────────────────────────────────┐
│  SIDECAR (Python + pymobiledevice3)                                       │
│  · devices.py  — usbmuxd, lockdownd, confianza, Modo Desarrollador        │
│  · ddi.py      — montaje de DeveloperDiskImage / imagen personalizada     │
│  · tunnel.py   — túnel RemoteXPC/RSD para iOS 17+                         │
│  · location.py — socket persistente de simulación de ubicación            │
└───────────────────────────────▲──────────────────────────────────────────┘
                                │ usbmuxd (socket UNIX / named pipe)
                        ┌───────▼────────┐
                        │  iPhone (USB)  │
                        └────────────────┘
```

### El camino hasta la coordenada

1. **usbmuxd** multiplexa TCP sobre el cable USB. Está en macOS de serie; en Windows lo aporta el
   driver de Apple; en Linux es el paquete `usbmuxd`.
2. **lockdownd** es el servicio de control del dispositivo. Requiere emparejamiento
   («Confiar en este ordenador»).
3. La **imagen de disco de desarrollador (DDI)** debe estar montada; sin ella lockdownd no publica
   los servicios de instrumentación.
4. La coordenada se inyecta a nivel de sistema, así que **todas las apps del iPhone la ven**, no
   sólo una.

### Dos regímenes según la versión de iOS

| iOS | DDI | Transporte | Requiere |
|---|---|---|---|
| 12 – 15 | `DeveloperDiskImage.dmg` + `.signature` | Servicio lockdown `com.apple.dt.simulatelocation` | Emparejamiento |
| 16.x | Igual | Igual | + **Modo Desarrollador** activado |
| 17, 18+ | Imagen **personalizada**, firmada por Apple contra el ECID del dispositivo | Canal DTX de instruments sobre **RemoteServiceDiscovery** | + **túnel** con privilegios de administrador |

El detalle que marca la diferencia frente a implementaciones ingenuas: **el socket de simulación se
mantiene abierto** durante toda la sesión y se reenvían pares de coordenadas por él. Abrir y cerrar
el servicio en cada punto produce los saltos y el temblor característicos de las herramientas mal
hechas.

---

## 2. Requisitos del sistema

### Común

- **Node.js 18+** (recomendado 20 o 22).
- **Python 3.10 o superior.** No sirve el Python 3.9 que trae macOS de fábrica: la dependencia
  `cryptography` ya no publica ruedas para esa versión.
- Un **cable de datos USB** (algunos cables baratos sólo transmiten corriente).

### macOS

`usbmuxd` viene incluido en el sistema. Sólo hace falta un Python moderno:

```bash
brew install python@3.12
```

Para iOS 17+, el túnel RSD pide la contraseña de administrador la primera vez de cada sesión.

### Windows

`usbmuxd` lo aporta el driver **Apple Mobile Device Support**. Instala una de estas opciones:

- **Apple Devices** desde Microsoft Store (recomendado en Windows 11), o
- **iTunes** desde apple.com (no la versión de la Store, que a veces no registra el servicio).

Después, comprueba en `services.msc` que **Apple Mobile Device Service** está en ejecución.
Ver [docs/WINDOWS-DRIVERS.md](docs/WINDOWS-DRIVERS.md) para el diagnóstico completo.

Python: descárgalo de python.org marcando **«Add python.exe to PATH»**.

### Linux

```bash
sudo apt install usbmuxd libimobiledevice6 python3.12 python3.12-venv
sudo systemctl enable --now usbmuxd
```

---

## 3. Instalación y ejecución

```bash
# 1. Dependencias de Node
npm install

# 2. Entorno Python del sidecar (crea native/.venv e instala pymobiledevice3)
npm run python:setup          # macOS / Linux
npm run python:setup:win      # Windows (PowerShell)

# 3. Arrancar en desarrollo
npm run dev
```

El script de setup termina listando los dispositivos que `usbmuxd` ve, lo que confirma que la
mitad difícil de la instalación funciona antes de abrir la aplicación.

### Comprobación manual del enlace

```bash
native/.venv/bin/python -m pymobiledevice3 usbmux list
native/.venv/bin/python -m pymobiledevice3 lockdown info
```

### El túnel de iOS 17+ como servicio del sistema

Por defecto el túnel hay que levantarlo en cada sesión (la app lo pide con un
botón). Para que arranque solo con el Mac:

```bash
sudo bash scripts/install-tunneld.sh
```

Instala un `LaunchDaemon` que ejecuta el modo túnel del propio sidecar incluido
en `/Applications/GeoPilot.app`, así que sigue funcionando aunque borres esta
carpeta. Para quitarlo:

```bash
sudo bash scripts/install-tunneld.sh --uninstall
```

**Qué implica.** El servicio corre como root de forma permanente, porque crear
la interfaz de red virtual sobre USB requiere privilegios y no hay alternativa.
Sólo escucha en `127.0.0.1:49151`, nunca en la red. Si prefieres no tener un
demonio con privilegios siempre activo, no lo instales y usa el botón de la
app cuando lo necesites. Registro en `/var/log/geopilot-tunneld.log`.

### Empaquetado

```bash
npm run python:bundle   # congela el sidecar con PyInstaller (native/dist)
npm run dist:mac        # .dmg universal (arm64 + x64)
npm run dist:win        # instalador NSIS x64
```

`npm run python:bundle` es obligatorio antes de distribuir: sin él la app dependería de que el
usuario final tenga Python instalado.

---

## 4. Uso

Al conectar el iPhone, la app recorre sola la secuencia de preparación y muestra en pantalla
completa el paso exacto que falta (confiar, desbloquear, activar Modo Desarrollador, montar la
imagen, levantar el túnel). No hay códigos de error opacos.

| Modo | Qué hace |
|---|---|
| **Teleport** | Clic en el mapa (o coordenadas / búsqueda) y **Mover aquí**: salto instantáneo. |
| **Salto (Two-Spot)** | Origen y destino. Recorre el trayecto a la velocidad elegida. |
| **Ruta multipunto** | Tantas paradas como quieras, unidas por calles reales (OSRM). |
| **Joystick** | Movimiento libre 360°: arrastra el stick o usa `WASD` / flechas, `Shift` para correr. |

**Controles comunes:** perfiles de velocidad (peatón 5 · corriendo 10 · bici 15 · coche 60 km/h) o
slider libre hasta 140 km/h, bucle, ida y vuelta, pausa y barra de progreso arrastrable. La
velocidad se puede cambiar en caliente sin reiniciar la ruta.

**Biblioteca:** favoritos, historial de las últimas 60 ubicaciones e importación/exportación de
rutas en **GPX** (compatible con Strava, Garmin y similares).

### Simulación realista

En *Ajustes* se controla el realismo del movimiento:

- **Deriva de posición** — ruido gaussiano de ±0 a 15 m. Un receptor GNSS de móvil tiene un error
  típico de 3–8 m en exteriores; unas coordenadas matemáticamente perfectas no existen en la
  realidad. Se usa distribución normal, no uniforme, porque es como se comporta el error real.
- **Fluctuación de velocidad** — variación de hasta ±45 %. Mantener ±0,0 km/h durante kilómetros
  es la señal más evidente de que el movimiento no es humano.
- **Micro-pausas** — detenciones cortas aleatorias, como esperas en semáforos.

Al detener la simulación o cerrar la aplicación se envía `STOP` al dispositivo y el iPhone vuelve
a su GPS real. Si el proceso muriera sin hacerlo, el dispositivo se quedaría con la última
coordenada hasta reiniciarse.

---

## 5. Estructura del proyecto

```
.
├── electron.vite.config.ts       Config de build (main / preload / renderer)
├── electron-builder.yml          Empaquetado y firma
├── build/entitlements.mac.plist  Permisos de sandbox para el sidecar y USB
│
├── src/
│   ├── shared/
│   │   ├── types.ts              Contratos IPC compartidos
│   │   └── geo.ts                Geodesia: haversine, rumbo, interpolación, jitter
│   │
│   ├── main/
│   │   ├── index.ts              Ciclo de vida, ventana, cierre ordenado
│   │   ├── ipc.ts                Registro de canales y reenvío de eventos
│   │   ├── bridge/
│   │   │   ├── PythonBridge.ts   Cliente JSON-RPC + reinicio automático
│   │   │   └── pythonResolver.ts Localiza el runtime (congelado / venv / sistema)
│   │   └── services/
│   │       ├── DeviceManager.ts  Máquina de estados de conexión
│   │       ├── LocationEngine.ts Bucle de movimiento a 10 Hz
│   │       ├── RouteService.ts   Nominatim + OSRM
│   │       └── StorageService.ts Persistencia y GPX
│   │
│   ├── preload/index.ts          API expuesta con contextBridge
│   │
│   └── renderer/src/
│       ├── App.tsx
│       ├── store/useStore.ts     Estado global (zustand)
│       ├── hooks/                Eventos IPC, control por teclado
│       └── components/           Mapa, sidebar, paneles, joystick, overlays
│
├── native/
│   ├── requirements.txt
│   └── ubiq_bridge/
│       ├── __main__.py           Punto de entrada del sidecar
│       ├── rpc.py                Transporte JSON por líneas
│       ├── errors.py             Excepciones → códigos estables
│       ├── devices.py            usbmuxd, lockdown, confianza, Modo Desarrollador
│       ├── ddi.py                Montaje de la imagen de desarrollador
│       ├── tunnel.py             Túnel RSD para iOS 17+
│       ├── location.py           Sesión de simulación persistente
│       └── server.py             Ensamblado y métodos RPC
│
└── scripts/                      setup-python.{sh,ps1}, bundle-python.sh
```

---

## 6. Resolución de problemas

| Síntoma | Causa y solución |
|---|---|
| «No se pudo iniciar el puente USB» | Falta Python 3.10+ o `pymobiledevice3`. Ejecuta `npm run python:setup`. |
| El iPhone no aparece | Cable de sólo carga, o el servicio de Apple parado en Windows. Prueba `python -m pymobiledevice3 usbmux list`. |
| «Confía en este ordenador» en bucle | Reinicia el emparejamiento: en el iPhone, *Ajustes › General › Transferir o restablecer › Restablecer › Restablecer ubicación y privacidad*. |
| `InvalidService` al simular | La DDI no está montada, o en iOS 17+ falta el túnel. |
| El montaje de la DDI falla | Requiere Internet. En iOS 17+ hay que contactar con los servidores de firma de Apple. |
| El túnel no arranca | Lánzalo a mano: `sudo python3 -m pymobiledevice3 remote tunneld`. |
| La ubicación no vuelve a la real | Detén la simulación desde la app; si no, reinicia el iPhone. |
| La búsqueda de direcciones falla | Nominatim limita a 1 petición/segundo. Para uso intensivo, apunta `GEOPILOT_GEOCODER` a una instancia propia. |

### Variables de entorno

| Variable | Uso |
|---|---|
| `GEOPILOT_PYTHON` | Fuerza un intérprete concreto para el sidecar. |
| `GEOPILOT_GEOCODER` | Endpoint alternativo de Nominatim. |
| `GEOPILOT_ROUTER` | Endpoint alternativo de OSRM. |

Las instancias públicas de OSM tienen límites de uso estrictos. Si la aplicación se distribuye a
muchos usuarios, conviene alojar OSRM y Nominatim propios o usar Mapbox.

---

## 7. Autor y créditos

Desarrollado por **Skaiiner**. Publicado bajo licencia MIT (ver [LICENSE](LICENSE)).

### Construido sobre

[pymobiledevice3](https://github.com/doronz88/pymobiledevice3) (implementación en
Python de los protocolos de `libimobiledevice`), [Leaflet](https://leafletjs.com),
[OpenStreetMap](https://www.openstreetmap.org), [Nominatim](https://nominatim.org) y
[OSRM](https://project-osrm.org).
