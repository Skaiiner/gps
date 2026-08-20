# Drivers USB en Windows

En macOS y Linux, `usbmuxd` es un demonio libre. En Windows **no existe una alternativa legal
redistribuible**: el multiplexor USB para dispositivos iOS lo proporciona el driver de Apple, que no
se puede incluir en el instalador de una aplicación de terceros. Por eso GeoPilot detecta su
ausencia y guía al usuario a instalarlo.

## Qué instalar

Elige **una** de las dos opciones (no hacen falta las dos):

### Opción A — Apple Devices (recomendada en Windows 10/11)

1. Abre Microsoft Store y busca **«Apple Devices»**.
2. Instálala y ábrela al menos una vez.
3. Conecta el iPhone y acepta «Confiar en este ordenador».

### Opción B — iTunes desde apple.com

Descarga el instalador **desde apple.com**, no desde Microsoft Store:
<https://www.apple.com/itunes/download/win64>

La versión de la Store se ejecuta en un contenedor de aplicación y en algunas máquinas no registra
correctamente el servicio del sistema del que depende `usbmuxd`.

Durante la instalación se despliegan tres componentes relevantes:

- `Apple Mobile Device Support` — el driver USB propiamente dicho.
- `Apple Mobile Device Service` (AMDS) — el servicio de Windows que hace de `usbmuxd`.
- `Apple Application Support` — bibliotecas auxiliares.

## Comprobar que funciona

### 1. El servicio está en ejecución

Pulsa `Win + R`, escribe `services.msc` y busca **Apple Mobile Device Service**.
Su estado debe ser *En ejecución* y su tipo de inicio *Automático*.

Para reiniciarlo desde una consola con privilegios de administrador:

```powershell
net stop "Apple Mobile Device Service"
net start "Apple Mobile Device Service"
```

### 2. El dispositivo aparece en el Administrador de dispositivos

Con el iPhone conectado, en `devmgmt.msc` debe verse **Apple Mobile Device USB Device** dentro de
*Dispositivos portátiles* o *Controladoras de bus serie universal*.

Si aparece con un signo de exclamación amarillo: clic derecho → *Actualizar controlador* →
*Buscar controladores en el equipo* → seleccionar

```
C:\Program Files\Common Files\Apple\Mobile Device Support\Drivers
```

### 3. El sidecar ve el dispositivo

Desde la carpeta del proyecto:

```powershell
native\.venv\Scripts\python.exe -m pymobiledevice3 usbmux list
```

Debe devolver un JSON con el UDID del dispositivo. Si devuelve una lista vacía o un error de
conexión, el problema está en el driver, no en GeoPilot.

## Problemas frecuentes

| Síntoma | Solución |
|---|---|
| `ConnectionRefusedError` al listar dispositivos | AMDS está detenido. Reinícialo con los comandos de arriba. |
| El servicio desaparece tras actualizar Windows | Reinstala Apple Devices o iTunes; las actualizaciones acumulativas lo han desregistrado en alguna ocasión. |
| El iPhone se detecta pero no se empareja | Borra `C:\ProgramData\Apple\Lockdown`, desconecta y vuelve a conectar el cable. |
| Aparece y desaparece en bucle | Casi siempre es el cable o un hub USB. Prueba un cable original conectado directamente a la placa. |
| Windows 11 ARM | El driver de Apple sólo existe para x64; funciona bajo emulación, pero con desconexiones esporádicas. |

## Nota sobre el túnel de iOS 17+

En iOS 17 y superiores, el túnel RemoteXPC crea una interfaz de red virtual, lo que requiere
**privilegios de administrador**. GeoPilot lanza el demonio mediante `Start-Process -Verb RunAs`, de
modo que Windows muestra el diálogo de UAC. Si prefieres lanzarlo a mano, abre PowerShell **como
administrador** y ejecuta:

```powershell
native\.venv\Scripts\python.exe -m pymobiledevice3 remote tunneld
```

Deja esa ventana abierta mientras uses la aplicación.
