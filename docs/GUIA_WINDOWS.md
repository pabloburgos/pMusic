# Guía Paso a Paso: App de Escritorio para Windows PC (`.exe`)

La aplicación de escritorio de **pMusic** para Windows utiliza **Electron**, incluye un servidor proxy local en `127.0.0.1` con soporte de `Range (206 Partial Content)` para que el motor **Web Audio API (Modo Sesión DJ y Ecualizador de 5 bandas)** funcione sin restricciones CORS, atajos multimedia globales y **Discord Rich Presence**.

---

## Opción A — Descargar el instalador `.exe` gratis con GitHub Actions (Sin instalar nada)

El repositorio incluye el flujo automático [`.github/workflows/build-windows.yml`](../.github/workflows/build-windows.yml):

1. Sube este repositorio a tu cuenta de GitHub.
2. Entra en la pestaña **Actions → Build Windows Desktop (.exe)**.
3. Pulsa **Run workflow**.
4. Al terminar (~3 minutos), descarga el artefacto **`pMusic-Windows-Setup`** que contiene el instalador **`pMusic-Setup-0.1.0.exe`**.

---

## Opción B — Ejecutar o compilar el `.exe` localmente en tu PC Windows

### 1. Requisitos previos
* Instala [Node.js 22 LTS](https://nodejs.org/).

### 2. Ejecutar en modo desarrollo
```powershell
npm install
npm run dev -w @pmusic/web
```

### 3. Compilar el instalador `.exe` (NSIS)
```powershell
npm install
npm run dist:win
```
El instalador **`pMusic-Setup-0.1.0.exe`** se generará en la carpeta:
`apps/desktop/release/`

---

## Atajos de Teclado en Windows

| Tecla | Acción |
| :--- | :--- |
| `Espacio` | Reproducir / Pausar |
| `Flecha Derecha` / `Flecha Izquierda` | Avanzar / Retroceder 5 segundos |
| `Flecha Arriba` / `Flecha Abajo` | Subir / Bajar volumen |
| `M` | Silenciar / Activar sonido |
| `D` | Activar / Desactivar **Modo Sesión DJ (AutoMix)** |
| `L` | Abrir **Letras sincronizadas** |
| `Q` | Abrir **Cola de reproducción y panel DJ** |
| `/` | Ir directo al buscador |
| `Esc` | Cerrar panel o modal abierto |

---

## Discord Rich Presence

* En **Ajustes**, el interruptor **Discord Rich Presence (Windows PC)** viene activado por defecto.
* Si tienes la app de Discord abierta en tu ordenador, tu estado mostrará automáticamente la canción y el artista que estás escuchando en **pMusic**. Si Discord está cerrado, **pMusic** continúa funcionando en silencio sin errores.
