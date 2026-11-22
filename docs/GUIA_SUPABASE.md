# Guía Paso a Paso: Base de Datos y Sincronización Gratuita (Supabase)

**pMusic** funciona desde el primer segundo en modo local sin pedirte cuenta. Cuando quieras interconectar tu **móvil Android** y tu **PC Windows** por internet de manera **100% gratuita (\$0/mes)**, sigue estos pasos con **Supabase Free Tier**.

---

## 1. Crear tu proyecto gratuito en Supabase

1. Entra en [https://supabase.com](https://supabase.com) e inicia sesión (puedes entrar con tu cuenta de GitHub sin tarjeta de crédito).
2. Pulsa **New Project**.
3. Elige un nombre (por ejemplo, `pmusic-sync`), genera una contraseña para la base de datos y selecciona la región más cercana a España (por ejemplo, **Frankfurt `eu-central-1`** o **Ireland `eu-west-1`**).
4. Espera ~1 minuto a que el proyecto termine de crearse.

---

## 2. Crear las tablas y activar Realtime (SQL Editor)

1. En el menú lateral izquierdo de Supabase, entra en **SQL Editor** y pulsa **New query**.
2. Abre el archivo [`supabase/schema.sql`](../supabase/schema.sql) de este proyecto, copia todo su contenido y pégalo en el editor SQL de Supabase.
3. Pulsa **Run** (o `Ctrl + Enter`).
   * Esto creará de forma automática e idempotente las 6 tablas (`playlists`, `playlist_tracks`, `liked_tracks`, `play_history`, `artist_affinity`, `device_sessions`), activará **Row Level Security (RLS)** para que solo tu usuario pueda leer/escribir sus datos, configurará `REPLICA IDENTITY FULL` y añadirá las tablas a la publicación `supabase_realtime`.
4. *(Opcional)* Si quieres precargar en SQL la función de semillas de artistas urbanos españoles (Bad Bunny, La Pantera, Cruz Cafuné, etc.), pega y ejecuta también [`supabase/seed_optional.sql`](../supabase/seed_optional.sql).

---

## 3. Configurar Autenticación por Email

1. En el menú lateral de Supabase, ve a **Authentication → Providers → Email**.
2. Para uso personal inmediato sin tener que confirmar enlace por correo, puedes desactivar la opción **Confirm email** y pulsar **Save**.

---

## 4. Copiar tus claves gratuitas a pMusic

En la interfaz actual de Supabase:

1. **Para la URL del proyecto (`Project URL` o `Project ID`):**
   * Tu URL siempre tiene el formato: `https://<TU_PROJECT_ID>.supabase.co` (también puedes verla en **Project Settings → Data API**).
   * En **pMusic** puedes pegar directamente el **Project ID** a secas (ej. `abcdefghijklmnopqrst`) o la URL completa `https://abcdefghijklmnopqrst.supabase.co` — la app lo convierte sola.
2. **Para la API Key (`Publishable` vs `Secret`):**
   * Entra en **Project Settings → API Keys**.
   * **Usa SIEMPRE la `Publishable key`** (`sb_publishable_...`) o, si miras la pestaña *Legacy API Keys*, la que dice **`anon` `public`** (`eyJ...`).
   * **NUNCA uses la `Secret key`** (esa es privada de administrador y no debe ir en apps de móvil/escritorio).
3. Puedes conectarlas de dos formas:
   * **Desde dentro de la app (`Ajustes`):** abre **pMusic** en tu PC y en tu móvil, pulsa **Ajustes**, pega tu `Project ID` (o `Project URL`) y tu `Publishable key`, pulsa **Guardar conexión** e inicia sesión con el mismo correo y contraseña en ambos dispositivos.
   * **Mediante archivo `.env` antes de compilar:** copia `.env.example` a `.env` y rellena:
     ```env
     VITE_SUPABASE_URL=https://tu-project-id.supabase.co
     VITE_SUPABASE_ANON_KEY=sb_publishable_tu_clave
     ```

---

## 5. Cómo usar `pMusic Connect` entre Móvil y Ordenador

* Una vez iniciada la misma cuenta en Android y Windows, pulsa el botón **Dispositivos** en el reproductor.
* Verás ambos dispositivos en línea en tiempo real:
  * **Control remoto:** pausa, pasa a la siguiente canción o ajusta el estado desde el móvil mientras suena en el PC (o viceversa).
  * **Transferencia en el segundo exacto:** pulsa **Transferir aquí** para pasar la canción actual, la cola y el estado del **Modo Sesión DJ** de un dispositivo a otro sin perder el compás.

---

## Nota importante sobre la pausa de 7 días del Plan Gratuito

* El plan gratuito de Supabase incluye **500 MB de PostgreSQL** y **WebSockets en tiempo real** sin coste.
* La única condición del plan gratuito es que Supabase **pausa el proyecto si pasa 7 días seguidos sin recibir ninguna actividad**.
* Mientras uses **pMusic** al menos una vez por semana, el proyecto permanecerá siempre activo. Y si alguna vez se pausa tras unas vacaciones, **pMusic** seguirá funcionando en modo local sin errores y podrás reactivar la nube con 1 clic en **Restore project** desde el panel de Supabase.
