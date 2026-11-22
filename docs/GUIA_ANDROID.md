# Guía Paso a Paso: App Móvil para Android (`.apk`)

La app móvil de **pMusic** para Android está construida con **Capacitor 8** e incluye el servicio nativo en Java `PMusicPlaybackService` (`FOREGROUND_SERVICE_MEDIA_PLAYBACK` + `PARTIAL_WAKE_LOCK`) para reproducción continua con pantalla apagada, el proxy local `PMusicStreamProxy` (`127.0.0.1`) y almacenamiento de descargas offline.

---

## 1. Generar el archivo `.apk`

### Opción A — Compilación directa con un comando
```bash
npm run build:apk
```
El archivo instalable se genera automáticamente en:
`apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`

### Opción B — Con GitHub Actions en la nube (Gratis)
1. En tu repositorio de GitHub, entra en **Actions → Build Android Mobile (.apk)**.
2. Pulsa **Run workflow**.
3. Descarga el artefacto **`pMusic-Android-APK`** con el archivo `.apk` listo para instalar en tu teléfono.

---

## 2. Instalar el `.apk` en tu móvil Android

1. Pasa el archivo `app-debug.apk` a tu móvil (por cable USB, Google Drive, Telegram o sincronización local).
2. Ábrelo desde el gestor de archivos de tu Android.
3. Si es la primera vez que instalas un `.apk` fuera de Google Play, Android mostrará el aviso **"Instalar aplicaciones desconocidas"**:
   * Pulsa **Ajustes → Permitir desde esta fuente** y vuelve atrás.
4. Pulsa **Instalar** y abre **pMusic**.

---

## 3. Consejos para Reproducción en Segundo Plano y Ahorro de Datos

* **Batería sin restricciones (Xiaomi / Samsung / OPPO / Realme):**
  Para que el sistema operativo del fabricante no corte el **Modo Sesión DJ** cuando lleves mucho tiempo con la pantalla bloqueada, mantén pulsado el icono de **pMusic → Información de la aplicación → Batería → Sin restricciones**.
* **Caché Offline (Escuchar sin datos):**
  Pulsa el botón de descarga (icono de flecha hacia abajo) en tus canciones favoritas de Bad Bunny, La Pantera o Cruz Cafuné mientras estés en Wi-Fi. Se guardarán en la memoria interna de la app y podrás verlas o gestionarlas en **Biblioteca → Descargas** y en **Ajustes → Caché offline**.
* **Modo ahorro gráfico:**
  Si quieres ahorrar aún más batería en sesiones largas, activa **Modo ahorro gráfico** en **Ajustes** para cambiar el desenfoque Liquid Glass por superficies OLED negras puras (`#06060A` / `#18181E`).
