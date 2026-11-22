# pMusic — Contexto para Antigravity Desktop (Windows Local)

Este archivo carga automáticamente todo el contexto del proyecto cuando abres **pMusic** en tu **Antigravity Desktop** local.

## 1. Resumen del Proyecto
* **Nombre:** `pMusic` (100% código propio en TypeScript, monorepo con `npm workspaces`).
* **Plataformas:**
  * **Windows PC:** Electron (`apps/desktop`) + Discord Rich Presence + servidor proxy local en `127.0.0.1` con soporte HTTP `206 Partial Content` Range y CORS para Web Audio API.
  * **Android Móvil:** Capacitor (`apps/mobile`) + `PMusicPlaybackService` (`FOREGROUND_SERVICE_MEDIA_PLAYBACK` + `PARTIAL_WAKE_LOCK`) + caché offline.
  * **UI Compartida:** React 19 + Tailwind CSS v4 + Framer Motion + Zustand (`apps/web`).
* **Estética y Diseño:**
  * Inspirado en **Liner** (*"Content is the colour"*, *"Glass, not boxes"*) y auditado bajo **Apple Human Interface Guidelines (`dickwu/apple-design-skill`)**.
  * Fondo negro profundo `#08080C` con resplandor ambiental reactivo a la portada actual, paneles silenciosos `#121219` con bordes `border-white/[0.07]`, botones principales en blanco puro sobre negro (`bg-white text-[#08080C]`), cabecera `EntityHero`, tarjetas `DAILY MIX · AUTOMIX` y filas de canciones de `64 px`.

## 2. Reglas de Diseño (`apple-design-skill`)
Para instalar la skill de diseño de Apple HIG en tu Antigravity local:
```powershell
npx skills add dickwu/apple-design-skill -a antigravity
```

## 3. Motores Principales
* **`@pmusic/providers` (`packages/providers`):**
  * `YouTubeMusicProvider` (`youtubei.js` con región España `gl=ES`, `hl=es`), `LrclibLyricsProvider` (letras sincronizadas LRC), `PlaylistImporter` (importador de playlists de Spotify y YouTube sin claves API) y `createPMusicApiHandler`.
* **`@pmusic/audio-engine` (`packages/audio-engine`):**
  * `DualDeckAudioEngine` (doble deck `Deck A` y `Deck B` en Web Audio API), `PcmTrackAnalyzer` (detector de BPM, energía RMS, intro, drop/estribillo y outro), `DjQueueReorderer` (ordenación armónica 2-opt), `DjCuePlanner` (**Sesión rápida 45–90 s** en los drops vs **Sesión completa**, con transiciones **EQ Swap 200 Hz**, **Filtro resonante HPF/LPF** y **Echo Out BPM**), Crossfade seguro (`0–12 s`) y Ecualizador de 5 bandas.
* **`@pmusic/recommendations` (`packages/recommendations`):**
  * Semillas configuradas para la escena urbana española (**Bad Bunny**, **La Pantera**, **Cruz Cafuné**, **Quevedo**, **Saiko**, **Morad**, **Dellafuente**, **Rels B**) y aprendizaje implícito estilo YouTube con decaimiento exponencial de 14 días.
* **`@pmusic/sync` (`packages/sync`) & `supabase/schema.sql`:**
  * Sincronización en tiempo real PC ↔ Móvil (`pMusic Connect`) mediante **Supabase Free Tier** (`https://zlaxnxkfwngmwqnqnqtu.supabase.co` ya preconfigurado en `usePMusicStore.ts`).

## 4. Comandos en Windows Local
```powershell
# Instalar dependencias
npm install

# Arrancar la interfaz en modo desarrollo con recarga en vivo
npm run dev -w @pmusic/web

# Ejecutar tests unitarios y verificación de tipos
npm run typecheck
npm run test

# Compilar el instalador .exe nativo directamente en tu Windows
npm run dist:win
```
