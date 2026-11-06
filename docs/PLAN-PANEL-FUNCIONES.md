# Plan de implementación — `/panel` con todas las funciones de DEACERO Play, sobre la base de Play Lite

Estado: **propuesta para aprobar** · 2026-11-05 · base: Play Lite `5121226` (rama `main`) · nivel del cambio: **COMPLETO**
(módulo nuevo, cuentas y datos personales).

No contiene IPs, nombres de equipos ni claves (el repo es público).

---

## 1. Qué se pide y cómo se interpreta

> «Implementar las mismas vistas y las mismas funcionalidades en el **panel**, sobre la base que ya se tiene, con funciones
> **locales**, y mantener todas las interfaces.»

| Término | Interpretación (confirmar en §10) |
|---|---|
| **Panel** | La vista `/panel` de Play Lite: hoy es el panel de `/remote` con la música sonando en el navegador de quien lo abre, sin clave y con racha propia. |
| **Mismas vistas y funciones** | Todo lo que hoy tiene DEACERO Play (el proyecto grande): Radio con IA, **Bienestar**, Hecho para ti, Descubrir artistas, Podcasts, Naturaleza, Búsqueda, **Favoritos** (Me gusta, playlists, historial), **login**, letras/karaoke, visualizador, efectos, temas, jingles/locutor y el **panel de administración** (horarios, mensajes de bienestar, kiosco, diagnóstico). |
| **Sobre la base que ya se tiene** | Play Lite: Node ≥ 18 **sin dependencias de npm**, `yt-dlp`, archivos JSON en disco, sin base de datos, pruebas `node:test`. No se vuelve al SQL Server ni a Express. |
| **Funciones locales** | Que funcionen con lo que hay en el equipo: sin SQL Server, sin Gemini, sin SMTP, sin CDN. Lo externo queda **opcional y apagado por defecto** (§7, Fase 7). |
| **Mantener todo** | `/`, `/kiosco`, `/remote`, el comando `play`, `MENU.cmd`, los scripts de la Pi y el `/panel` actual **no cambian de comportamiento** mientras se construye lo nuevo. |

---

## 2. Principios (el filtro para cada decisión)

1. **Cero dependencias nuevas.** Contraseñas con `crypto.scrypt`, cookies firmadas con HMAC, multipart no se usa (el avatar va como cuerpo binario).
2. **El navegador solo habla con este servidor.** Lo que hoy el navegador pide directo a internet (Radio Browser, iTunes, Deezer, Audius) pasa por el servidor o se apaga.
3. **Sin regresión.** Ninguna fase toca el comportamiento de `/`, `/kiosco`, `/remote` ni `play`. Las 191 pruebas actuales deben seguir en verde en cada fase.
4. **El anónimo sigue funcionando.** Quien abre `/panel` sin cuenta oye música, usa Bienestar, Descubrir, Naturaleza y letras como hoy. La cuenta **añade** favoritos, historial y recomendaciones personales; nunca bloquea escuchar.
5. **Datos personales fuera del repo.** `users.json` y los datos por usuario nunca se versionan (ver Fase 0).
6. **Pi 4B primero.** Lo pesado (visualizador, efectos) nace apagado y se carga bajo demanda.

---

## 3. Inventario: función → cómo queda en local

| Función (proyecto grande) | Cómo funciona allá | Versión local en Lite | Externo |
|---|---|---|---|
| **Login / registro / perfil** | SQL Server + bcryptjs + express-session + correo | `src/users.js`: `users.json` + `scrypt` + sesión en cookie firmada (hash del token en `sessions.json`). Recuperación: **la restablece el administrador** (sin correo). | Ninguno |
| **Favoritos** (Me gusta / No me gusta) | tabla `track_reactions` | `DATA_DIR/users/<id>.json` → `reactions`. Todo es YouTube en Lite, así que **ya no hay pistas que no se puedan marcar**. | Ninguno |
| **Playlists** | tablas `playlists`, `playlist_tracks` | mismo archivo por usuario → `playlists` | Ninguno |
| **Historial de reproducción** | `play_history` | mismo archivo → `history` (tope 500). *No confundir con el historial de búsquedas de equipos que ya existe.* | Ninguno |
| **Perfil de gusto** | `GROUP BY` en SQL | se calcula en memoria desde `reactions` | Ninguno |
| **Bienestar (Viaje ISO)** | Gemini inventa 5 fases y canciones | **Planificador local** `src/bienestar.js`: usa `mood`/`energy` de los 479 géneros y una curva de energía (§6.4) | Ninguno |
| **Géneros recomendados por hora** | Gemini | Reglas locales: franja del día × `mood` × lo escuchado recientemente | Ninguno |
| **Hecho para ti** | Gemini + charts iTunes + gustos | Reglas locales: gusto del usuario + vecinos de género + semilla de artistas | Opcional (charts) |
| **Artistas trending / Descubrir artistas** | Gemini + pool de 400 artistas | **Semilla local** `data/seed/artistas.json` (se parte de `samples-pool.json` del proyecto grande) con 70/30 preferidos/otros | Ninguno |
| **Podcasts recomendados** | Gemini | Lista curada local `data/seed/podcasts.json` filtrada por franja | Ninguno |
| **Playlist con IA** | Gemini con el gusto del usuario | Generador local por palabras clave → géneros/ánimos + gusto (§6.3) | Ninguno |
| **Búsqueda, letras, carátulas** | `yt-dlp`, lrclib | Ya existen en Lite | lrclib/lyrics.ovh (como hoy) |
| **Karaoke a pantalla completa** | vista propia | Se porta (usa `/api/lyrics`, ya existente) | Ninguno |
| **Naturaleza** | Web Audio (sintetizado) | Se copia tal cual (100 % cliente) | Ninguno |
| **Efectos de audio, ecualizador** | Web Audio | Se copia; el audio ya es del mismo origen | Ninguno |
| **Visualizador (8 modos) y 6 temas** | canvas / CSS | Se copian; visualizador **apagado por defecto** en Pi (`?vis=0` ya existe) | Ninguno |
| **Jingles y locutor (TTS)** | VoiceRSS / ElevenLabs / Google | Lite ya tiene jingle + `speechSynthesis`; se añade **respaldo con clips pregrabados** (ROADMAP #8–9). Motores en línea: opcionales | Opcional |
| **Mensajes de bienestar programados** | el navegador mide la hora | El **servidor** dispara el anuncio por SSE usando la hora ya corregida (`timesync`) | Ninguno |
| **Programación semanal del kiosco + "generar con IA"** | Gemini | Generador local con la misma curva ISO sobre la jornada laboral (§6.5) | Ninguno |
| **Panel admin** (ajustes, subidas, logs) | contraseña `ADMIN_PASS` | Se protege con la **clave `REMOTE_TOKEN` que ya existe**; no se crea otro secreto | Ninguno |
| **Diagnóstico de red** (`logs.html`) | `netlog` | Registro circular de errores de `yt-dlp`/lrclib/proxy + vista | Ninguno |
| **Audius / Jamendo / Radio Browser / YouTube Data API** | el navegador llama directo | **Opcional** vía servidor con caché (Fase 7); apagado por defecto | Sí |
| **Cliente secundario** (`client.html`) | BroadcastChannel | Lo cubre `/remote`; no se porta | — |

---

## 4. Mapa de interfaces

**Se mantienen intactas:**

| Ruta | Qué es |
|---|---|
| `/` | Reproductor normal |
| `/kiosco` | Vista kiosco solo-lectura (hora, canción, siguiente) |
| `/remote` | Control remoto (Música, Podcasts, Equipos) |
| `play` (CLI) | Control por terminal |
| `/panel` | Panel actual (hasta el cambio de §7, Fase 8) |

**Nuevas, dentro del panel** (`/panel/completo` durante el desarrollo; ver §10-D1):

| Vista | Origen en el proyecto grande | Quién la ve |
|---|---|---|
| **Radio** (géneros + "recomendado ahora") | pestaña Radio → IA | Todos |
| **Bienestar** (+ vista rápida) | `moodradio.js` | Todos |
| **Hecho para ti** | `forYou.js` | Con cuenta (sin cuenta: invitación) |
| **Descubrir** (feed de artistas) | `samples.js` | Todos |
| **Podcasts** | `aipodcast.js` + Podcasts de Lite | Todos |
| **Naturaleza** | `nature.js` | Todos |
| **Buscar** (artista destacado, top tracks, volver a escuchar) | `search-view.js` | Todos |
| **Biblioteca**: Mis Me Gusta, Playlists, Historial | `playlists-ui.js` | Con cuenta |
| **Perfil / entrar / registrarse / cambiar contraseña** | `userui.js` | Todos |
| **Reproductor** (barra con 👍 👎 ➕, letras, karaoke, visualizador, FX, temas) | `player.js`, `lyrics.js`, `karaoke.js`… | Todos |
| **Administración**: Equipos, Usuarios, Ajustes, Horarios, Anuncios, Diagnóstico | `kiosk-admin.js`, `scheduler.js`, `logs.html` | Con la clave de administrador |
| **Control** (el panel de hoy) | `remote.html` | Todos (se conserva como una pestaña) |

La barra móvil queda como en el original: Inicio · Bienestar · Descubrir · Biblioteca.

---

## 5. Arquitectura

### 5.1 Reutilizar lo que ya funciona

- **Motor de audio:** el `iframe` oculto (`app.js?view=local`, con su API `__player`) sigue siendo quien suena. Ya sabe probar la pista, reintentar y precargar dos. El panel nuevo le manda órdenes igual que hoy.
- **Radio por sesión** (`src/radio.js`): ya hay un estado por oyente (`sid`). Se **extiende** con modos: `aleatorio` (hoy), `viaje` (Bienestar) y la lista que el cliente ya conoce (Me gusta, playlist) que se reproduce directo por `/api/play/ID` sin pasar por el radio.

### 5.2 Nombres de API (decisión: no copiar las URLs del proyecto grande)

En el proyecto grande la API es `/api/reactions`, `/api/history`, `/api/playlists`, `/api/genres`…, pero **en Lite ya existen con otro significado**:

| URL | En Lite hoy |
|---|---|
| `/api/history` | Historial de **búsquedas de equipos** (`play history`), con clave |
| `/api/genres` | `[{id,label,emoji,color,featured}]` (en el grande: `{genres:[…]}` con más campos) |
| `/api/podcasts` | Podcasts **guardados** |
| `/api/search` | Búsqueda de **géneros** |

Copiar los contratos rompería `play`, `/remote` o `/panel`. Por eso lo nuevo va en **espacios propios** y el front se adapta con un único archivo (`public/panel/js/api.js`):

| Espacio | Contenido |
|---|---|
| `/api/auth/*` | `register`, `login`, `logout`, `me`, `change-password`, `profile`, `avatar` (no existía; sin choque) |
| `/api/me/*` | `reactions`, `playlists`, `history`, `taste`, `prefs` (datos de **mi** cuenta) |
| `/api/ia/*` | `ahora`, `para-ti`, `artistas`, `podcasts`, `playlist`, `descubrir` |
| `/api/bienestar/*` | `viaje` (planificar / detener) |
| `/api/admin/*` | `usuarios`, `ajustes`, `horarios`, `anuncios`, `subidas`, `diagnostico` |

### 5.3 Política de permisos declarativa

Hoy `isListenerRequest` es una lista a mano y el servidor responde 405 a todo lo que no sea GET/POST de tres rutas. Con ~40 rutas nuevas eso es una fuente de agujeros. Se cambia por **una tabla**:

| Nivel | Quién | Ejemplos |
|---|---|---|
| `publico` | cualquiera (con `sid` donde aplique) | `/api/ia/ahora`, `/api/bienestar/viaje`, `/api/genres`, `/api/play/*` |
| `usuario` | sesión de cuenta válida | `/api/me/*`, `/api/auth/profile` |
| `admin` | clave `REMOTE_TOKEN` | `/api/admin/*`, `/api/cmd`, `/api/clients` |
| `pantalla` | clave o loopback | `/api/events`, `/api/state` |

**Prueba de cobertura:** una prueba recorre todas las rutas registradas y falla si alguna no tiene nivel. Los límites de cuerpo pasan a ser **por ruta** (4 KB hoy; el avatar necesita ~2 MB).

### 5.4 Almacenamiento (sin base de datos)

```
data/                       (versionado)
  genres.json               ← se enriquece con desc/mood/energy (Fase 0)
  seed/artistas.json  seed/podcasts.json  seed/frases.json

DATA_DIR/                   (NO versionado; fuera del repo en producción)
  users.json                cuentas: id, correo, nombre, hash, estado
  sessions.json             hash del token → {id de usuario, vence}
  users/<id>.json           reactions, playlists, history, prefs
  avatars/<id>.<ext>
  audio/                    anuncios y jingles subidos
  horarios.json  ajustes.json  anuncios.json
  podcasts.json  history.json     (ya existen)
```

- Escritura **atómica** con `src/jsonfile.js` (ya existe) y **cola por archivo** para que dos peticiones no se pisen.
- Un archivo por usuario: se lee y escribe pequeño, y borrar o exportar una cuenta es borrar o copiar un archivo.
- Topes: 2 000 reacciones, 500 de historial, 50 playlists × 500 pistas por usuario.
- Un solo proceso: no hace falta bloqueo entre procesos.

### 5.5 Del lado del navegador

- Sin compilación. Módulos ES nativos (`<script type="module">`) y **carga bajo demanda** por vista (`import()`); lo inicial debe quedar **< 250 KB comprimido**. (El proyecto grande carga 754 KB de JS de golpe.)
- Iconos: sprite SVG (como `remote.html`), **no** Font Awesome.
- **Emojis:** la Pi no trae fuente de emoji; Lite usa Twemoji en SVG. Bienestar necesita 18 emojis de ánimo + los del personalizador y hoy **faltan 16 de los que comprobé** (😰 😟 😤 😢 😨 😠 😴 😐 🥱 🧊 😶 😌 🎯 😊 🚀 🥰). Se añaden como SVG (CC-BY 4.0, ya cubierto por `assets/emoji/LICENSE.txt`).
- Marca: negro + naranja `#F59B23`. Los 6 temas del proyecto grande son opcionales y conservan el naranja como acento por defecto.

---

## 6. Diseño de las piezas clave

### 6.1 Login simple (local)

> **Actualización:** la decisión final es **entrar solo con número de nómina, sin contraseña** (D5/D6). Quedan sin efecto lo de `scrypt`, contraseña temporal, cambio de contraseña, `DOMINIO_PERMITIDO` y el CLI de restablecer. Lo que sí rige: cookie `pl_user` con solo el hash en `sessions.json`, CSRF por `Origin` + `application/json`, límite de intentos por IP, cuenta creada al primer acceso, exportar mis datos, y administrador por `REMOTE_TOKEN`. **Las cuentas no se pueden borrar** (decisión del 2026-11-06): no hay ruta ni botón; solo el administrador puede desactivarlas. Implementado en `src/users.js`, `src/sessions.js`, `src/authroutes.js`.

- **Datos:** correo (minúsculas), contraseña, **nombre opcional** (si no se da, se toma de la parte local del correo). Esto respeta la decisión previa de *no pedir nombre en la web*.
- **Contraseñas:** `scrypt` (sal de 16 bytes, parámetros guardados en el hash para poder subirlos después), comparación con `timingSafeEqual`, mínimo **8 caracteres**. Se mide el costo en la Pi y se limita a 1–2 hashes simultáneos.
- **Sesión:** cookie `pl_user` (`HttpOnly`, `SameSite=Lax`, 7 días, `Secure` solo si `COOKIE_SECURE=true`). El servidor guarda solo el **hash** del token, así sobrevive reinicios y robar `sessions.json` no sirve. Se regenera el token al entrar.
- **CSRF:** `SameSite=Lax` + exigir `content-type: application/json` + verificar que `Origin` coincide con `Host` en peticiones que cambian datos.
- **Fuerza bruta:** límite en memoria por IP y por correo (5 intentos / 15 min), mensaje genérico y comparación simulada cuando el correo no existe.
- **Dominio permitido (opcional):** `DOMINIO_PERMITIDO=deacero.com` limita el registro. Por defecto, abierto en la red local.
- **Recuperación sin correo:** el administrador la restablece (`play user reset <correo>` o en Administración → Usuarios). Genera una contraseña temporal `XXXX-XXXX-XXXX` que vence en 60 min y **obliga a cambiarla** al entrar (mismo flujo que el original). Enviar correo exigiría un cliente SMTP a mano: queda fuera de la v1.
- **Roles:** `usuario` y la clave de administrador (`REMOTE_TOKEN`). No se crea un segundo secreto de administración.
- **Cuenta:** ver/editar perfil, cambiar contraseña, subir/quitar avatar (PNG/JPG/WebP ≤ 2 MB, se comprueba el contenido y no solo la extensión), **exportar mis datos** y **borrar mi cuenta**.
- **CLI:** `play user list | reset | disable | delete | export`.

### 6.2 Favoritos

- 👍/👎 en la barra del reproductor, ➕ para playlists, igual que hoy. El mismo botón pulsado dos veces quita la reacción; la UI es optimista y revierte si falla.
- **Mis Me Gusta** con contador y «Reproducir todo»; **Playlists** (crear, renombrar, quitar pistas, públicas/privadas); **Historial** (cada pista que suena con cuenta iniciada se registra).
- **Sin cuenta:** los Me gusta se guardan en el navegador (`localStorage`) y **se fusionan con la cuenta la primera vez que se inicia sesión**. Así «favoritos» funciona para todos y la cuenta solo los sincroniza.
- **Perfil de gusto** (géneros y artistas con más Me gusta / No me gusta): alimenta Hecho para ti, Descubrir y la playlist local.
- **«No me gusta» de verdad:** el género o artista con muchos No me gusta se evita en la rotación de **esa sesión** (hoy solo afectaba a Descubrir).

### 6.3 IA local (sin Gemini)

Módulos puros en `src/ia/`, **sin red y deterministas con una semilla** (por eso se pueden probar):

| Módulo | Entrada | Salida |
|---|---|---|
| `ahora` | hora, día, últimos géneros | 6 géneros con razón breve (tabla franja → `mood`, sin repetir lo reciente) |
| `para-ti` | perfil de gusto, historial, hora | 12 artistas/géneros: 8 afines (mismo `mood`/`energy` que lo que gusta) + 4 nuevos; un «ángulo» rotativo; sin repetir lo mostrado en la sesión |
| `artistas` | género, excluidos | tarjetas desde la semilla local |
| `podcasts` | franja | episodios de la lista curada |
| `playlist` | texto libre + gusto | palabras clave → ánimos/géneros/épocas/artistas → lista de consultas que el motor resuelve con `yt-dlp` al reproducir |
| `descubrir` | vistos, preferir, evitar | 12 artistas (70 % preferidos), sin repetir |

**Honestidad sobre la calidad:** sin un modelo, lo «nuevo» sale de listas curadas, no de conocimiento general. La semilla de artistas (≥ 400) y de podcasts se debe **revisar y ampliar** (Fase 3). Si se quiere novedad real, está el adaptador Gemini **opcional** de la Fase 7.

### 6.4 Bienestar local (Viaje ISO)

Mismo principio (empezar donde está la persona y subir gradualmente), calculado sin IA:

1. **Estado → energía de partida.** Los 18 ánimos (Estresado, Ansioso, Agotado, Contento…) tienen una energía inicial, con una tabla de palabras clave para el texto libre.
2. **Destino → energía final.** Relajarme 0.30 · Concentrarme 0.55 · Con energía 0.90 · Buen ánimo 0.75 · Dormir 0.10 · Fluir 0.65. Sin destino, se sube hacia ~0.65.
3. **Curva.** Cinco energías entre partida y destino, dadas por la intensidad (las mismas curvas del original: suave `0.12→0.50`, media `0.18→0.90`, intensa `0.35→0.98`), ajustadas para que **parta de la energía real del ánimo**.
4. **Géneros por fase.** De los 479, los de `energy` cercana a la de la fase (±0.12, ampliando si hace falta), filtrados por **estilo** (lista de géneros por estilo) e **idioma**, ponderados por el gusto del usuario, **sin repetir género entre fases vecinas**. Cada fase queda con 3–4 géneros candidatos.
5. **Duración** → temas por fase: corta 2, media 3, larga 5 (igual que el original).
6. **Textos** (análisis del ánimo, nombre de fase, frase final) salen de bancos de frases en `data/seed/frases.json`, con variantes para que no se vea siempre lo mismo.
7. **Reproducción.** `POST /api/bienestar/viaje` guarda el plan en la **sesión del oyente**; `/api/next?sid=` devuelve el siguiente tema con `viaje: {fase, tema, porFase, continuando}`. Reusa pools, sondeo de pista y anti-repetición del radio, y añade la **firma normalizada de título** (que «X (En vivo)» y «X (Remaster)» no cuenten como canciones distintas).
8. **Continuación.** Al acabar la fase 5 la música **sigue** en la energía alcanzada (no se corta). El pool se reabastece rotando géneros de esa energía; si no hay material nuevo se repite antes que callar.
9. **Favorito de Bienestar.** Se guarda en el navegador y, con cuenta, también en `prefs.bienestar` (así sigue a la persona entre equipos).
10. **Vista rápida** («¿Cómo te sientes ahora?») bajo Radio y pestaña móvil Bienestar, como hoy.

**Riesgo medido (no supuesto):** la biblioteca tiene muy pocos géneros de energía baja: **44 con `energy` < 0.4** (de 479; 42 `calm` y 9 `winddown`), frente a 392 con `energy` ≥ 0.6. Un viaje «Estresado → Dormir» con estilo «Cumbia» puede quedarse sin candidatos en las fases 1–2. Regla de relajación, en orden: ampliar tolerancia de energía → quitar idioma → quitar estilo → avisar en la tarjeta («no hay suficiente música tranquila de ese estilo; usamos géneros afines»). La prueba de la Fase 4 recorre **18 ánimos × 6 destinos × 3 intensidades × 11 estilos** y exige un plan válido en todos.

### 6.5 Administración local

- **Acceso:** la clave `REMOTE_TOKEN` (ya existe). Todo `/api/admin/*` y la pestaña Administración.
- **Horarios:** `src/horario.js` (función pura `bloqueActivo(ahora, horario)`). El radio **principal** (pantallas) puede seguir un horario: género o `mood` por franja y días, y silencio fuera de horario (ROADMAP P2). Modo **Musicoterapia 24/7**: la curva ISO según la hora y la jornada configurable (por defecto 7–19 h), el mismo cálculo que ya usa `kiosco.html` en el proyecto grande.
- **«Generar semana»:** generador local de la curva (inicio calma→foco, media mañana foco, comida ánimo, bajón de la tarde energía, cierre bajar), máx. 8 bloques, al menos un género latino de día. Deja el resultado **editable** antes de guardarlo.
- **Anuncios:** mensajes de bienestar y jingles programados. Se suben `.mp3` (≤ 5 MB, se comprueba el encabezado), se programan por días/horas/intervalo, y el **servidor** los dispara por SSE a las pantallas con la hora corregida; la pantalla baja la música (ducking) mientras suena. Un solo reloj, el del servidor.
- **Ajustes:** filtro de contenido explícito. `yt-dlp` no tiene el `safeSearch` de la API oficial, así que se filtra por **lista de palabras en el título** (limitación honesta: no es infalible).
- **Usuarios:** listar, desactivar, restablecer contraseña, borrar.
- **Diagnóstico:** anillo de eventos (errores de `yt-dlp`, proxy, lrclib, sondeos fallidos) con resumen por servicio; reutiliza la vista de `logs.html`.

---

## 7. Fases

> **Estado de implementación (2026-11-06)** — pruebas: 424 en verde (191 originales + 233 nuevas), sin dependencias de npm. Dos auditorías de seguridad (cuentas; panel/IA/viaje) y una de accesibilidad hechas y corregidas.
>
> | Fase | Estado |
> |---|---|
> | 0 Fundaciones | **Hecha** (18 emojis Twemoji añadidos) salvo: `data/seed/frases.json` (los textos de Bienestar están en `src/bienestar.js`) y el guion de humo con navegador. Tabla de permisos (`src/policy.js`), `.gitignore`, géneros con `mood/energy/desc`, semillas de artistas (410) y podcasts. |
> | 1 Cuenta | **Hecha** (solo nómina, sin contraseña). Revisión de seguridad hecha y corregida. |
> | 2 Favoritos | **Hecha** (`/api/me/*`, filtro real de No me gusta por sesión, vista Favoritos, 👍 👎 ➕, cola «Reproducir todo»). |
> | 3 IA | **Backend hecho**: Gemini (clave `GEMINI_KEY`, solo por cabecera) con respaldo local automático; caché, límite de ritmo, cortacircuitos. Vistas «Para ti» hechas. |
> | 4 Bienestar | **Backend hecho**: planificador local (matriz 18×6×3×11 validada), modo `viaje` del radio con continuación y firma de título, `/api/bienestar/*`, vista Bienestar con fases y continuación. |
> | 5 Experiencia de escucha | **Hecha**: Buscar, Letra/Karaoke, Naturaleza sintetizada, visualizador decorativo (8 modos), 6 temas AA, atajos (apagables), barra móvil. Sin EQ/crossfade sobre la música (exigiría tocar el `<audio>` del motor). |
> | 6 Administración | **Hecha**: horario (rotación / bloques / musicoterapia 24/7, generar semana), anuncios mp3 por SSE, filtro explícito, usuarios, diagnóstico. |
> | 7 Fuentes opcionales | Gemini integrado; Audius/Radio Browser/Jamendo **no se hicieron** (prescindibles, D8). |
> | 8 Cierre | **Hecha** salvo medición en la Pi con 3/5/10 oyentes y la ACL de la instalación de Windows como administrador (propuesta M2 de la 3.ª auditoría, sin probar). `/panel` = panel completo (`PANEL_PRINCIPAL=simple` revierte), el de siempre en `/panel/simple`; `scripts/humo.js`, `scripts/respaldo.js`, README como única documentación. Auditorías: seguridad 3 y accesibilidad 2, corregidas. |
>
> **Estado final (2026-11-06):** 513 pruebas en verde; humo con navegador en orden. Este plan queda **archivado**: la documentación vigente es el README.


Esfuerzo en **días-persona** (estimación; ±30 %). Cada fase se entrega **detrás de una bandera** y con las pruebas anteriores en verde.

| Fase | Entrega | Días | Depende de |
|---|---|---|---|
| **0** Fundaciones | Red de seguridad, política de permisos, datos y géneros enriquecidos, esqueleto del panel nuevo | 2–3 | — |
| **1** Cuenta local | Login simple, perfil, avatar, recuperación por administrador | 3–4 | 0 |
| **2** Favoritos | Me gusta, playlists, historial, perfil de gusto, fusión de favoritos locales | 3–4 | 1 |
| **3** IA local | Motor de recomendaciones + Radio / Hecho para ti / Descubrir / Podcasts | 4–6 | 0 (2 mejora la personalización) |
| **4** Bienestar | Planificador local, modo `viaje` del radio, vista completa y rápida | 4–5 | 0, 3 (reusa tablas) |
| **5** Experiencia de escucha | Buscar, letras, karaoke, Naturaleza, FX, visualizador, temas, atajos | 6–8 | 0 |
| **6** Administración | Horarios, Musicoterapia 24/7, anuncios, usuarios, ajustes, diagnóstico | 5–7 | 1 |
| **7** Fuentes opcionales | Audius, Radio Browser, Jamendo, charts, adaptador Gemini (todo apagado) | 3–5 | 3 |
| **8** Cierre | Seguridad, accesibilidad, rendimiento en Pi, despliegue, README, cambio de `/panel` | 3–4 | todas |

**Total: ≈ 33–46 días-persona.** Las fases 3, 5 y 6 pueden ir en paralelo si hay dos personas; 1→2 y 3→4 son secuencia.

### Fase 0 — Fundaciones (sin cambio visible)

1. **Línea base:** las 191 pruebas en verde; guion de humo (navegador sin ventana) que abre `/`, `/kiosco`, `/remote` y `/panel` y comprueba que suenan/cargan. Es la **red de seguridad de «mantener todo»** y corre en cada fase.
2. **Política de permisos** (§5.3) + prueba de cobertura de rutas + límites de cuerpo por ruta + métodos PUT/PATCH/DELETE.
3. **Datos:** definir `DATA_DIR` y completar `.gitignore` **antes de escribir un solo dato personal** (hoy ignora solo `data/podcasts.json` y `data/history.json`, y `DATA_DIR` por defecto es `./data`, dentro del repo): `data/*` salvo `genres.json` y `data/seed/`.
4. **Géneros:** script que copia `desc`, `mood` y `energy` del `genres.json` del proyecto grande (los 479 ids **coinciden**) + prueba de que no falta ninguno y de que `mood ∈ {calm, focus, uplift, energy, winddown}` y `energy ∈ [0,1]`. `/api/genres` sigue devolviendo los mismos campos que hoy (más los nuevos, sin quitar ninguno).
5. **Semillas:** `data/seed/artistas.json` desde `samples-pool.json` (revisado, sin datos internos), `podcasts.json`, `frases.json`.
6. **Esqueleto del panel nuevo** en `/panel/completo` (bandera `PANEL_V2`), con la navegación, los tokens de diseño y `api.js`; el motor sigue siendo el iframe actual.
7. **Emojis Twemoji** faltantes (§5.5).

*Aceptación:* el guion de humo y las 191 pruebas pasan; `/panel` es **idéntico** al de hoy; `git status` no muestra ningún dato de usuario aunque se creen cuentas de prueba.

### Fase 1 — Cuenta local

`src/users.js`, `src/session.js`, `src/ratelimit.js`, rutas `/api/auth/*`, modal de entrar/registrarse/cambiar contraseña/perfil, CLI `play user`.

*Aceptación:* registro → sesión → recargar sigue dentro → reiniciar el servidor sigue dentro → salir; contraseña incorrecta y correo inexistente dan **el mismo** mensaje y tiempo parecido; 6.º intento seguido se bloquea; la contraseña temporal obliga a cambiarla; ningún hash ni token aparece en respuestas ni en el log; `sessions.json` no contiene tokens en claro.
*Revisión:* **@security** (obligatoria: cuentas y datos personales).

### Fase 2 — Favoritos

`src/library.js`, rutas `/api/me/*`, botones 👍 👎 ➕, Mis Me Gusta, Playlists, Historial, fusión desde `localStorage`.

*Aceptación:* un usuario **no puede leer ni modificar** los datos de otro (prueba con dos cuentas); alternar un Me gusta deja el estado correcto aunque se pulse rápido; los topes se respetan; borrar la cuenta borra su archivo; «Reproducir todo» suena en orden por el motor.

### Fase 3 — IA local

`src/ia/*` con semilla fija en las pruebas; rutas `/api/ia/*`; vistas Radio («recomendado ahora»), Hecho para ti, Descubrir, Podcasts; ampliar y revisar las semillas.

*Aceptación:* con la misma semilla, la misma respuesta; sin repeticiones dentro de una sesión hasta agotar el pool; con 0, 3 y 30 Me gusta la salida es válida; **ninguna** función de esta fase hace una petición de red (prueba que bloquea `fetch`).

### Fase 4 — Bienestar

`src/bienestar.js`, extensión del radio (`viaje`), UI portada de `moodradio.js` (18 ánimos, personalizador, fases, continuación, tarjeta final, vista rápida, favorito).

*Aceptación:* la matriz de §6.4 (18 × 6 × 3 × 11) produce planes válidos (5 fases, energía no decreciente salvo curva suave, géneros distintos entre fases vecinas, `tracksPerPhase` por duración); dos oyentes con viajes distintos **no se afectan** ni afectan a `/` ni `/kiosco`; la continuación no deja silencio; detener el viaje devuelve la racha aleatoria de esa sesión.

### Fase 5 — Experiencia de escucha

Buscar a pantalla completa, letras y Karaoke (a pantalla completa, auto-desplazamiento si la letra no trae tiempos), Naturaleza, efectos, visualizador (8 modos), 6 temas, atajos de teclado, barra móvil.

*Aceptación:* en la Pi con visualizador y efectos apagados, el panel no tropieza (CPU y memoria medidas contra la línea base de hoy); cada módulo pesado se carga solo al abrir su vista.

### Fase 6 — Administración

`src/horario.js`, anuncios (subida, programación, disparo por SSE), usuarios, ajustes, diagnóstico; generador local de semana.

*Aceptación:* sin la clave, **ninguna** ruta `/api/admin/*` responde datos; un horario cambia el género de las pantallas a la hora indicada (con reloj simulado en la prueba) **sin afectar** a los oyentes del panel; un anuncio programado suena una sola vez por franja y baja la música.

### Fase 7 — Fuentes opcionales (todas apagadas por defecto)

`FUENTES=audius,radiobrowser,jamendo,charts` y `IA_MODO=local|gemini|auto` (por defecto `local`). Todo pasa por el servidor, con caché y un cortacircuitos como el de `yt-dlp`. **Gemini:** la clave solo en `.env` (nunca en el repo ni en la URL: cabecera `x-goog-api-key`), con límite de peticiones, y si falla se cae **en silencio** al motor local.

*Aceptación:* con todo apagado no hay ninguna conexión saliente aparte de `yt-dlp` y lrclib; con una fuente caída el panel sigue funcionando.

### Fase 8 — Cierre

@security (auditoría completa), @accessibility-designer (contraste, foco, ARIA, objetivos táctiles, teclado), medición en Pi con 3, 5 y 10 oyentes, scripts de instalación (la Pi y Windows **conservan** `DATA_DIR` al actualizar), copia y restauración de datos, README (el único lugar de documentación), y el **cambio de `/panel`**: el panel completo pasa a `/panel` y el de hoy queda en `/panel/simple` (sin romper marcadores ni el kiosco).

---

## 8. Calidad (puertas por fase, protocolo del equipo)

- **Pruebas primero:** cada comportamiento nuevo tiene una prueba que **falla sin el cambio**. Sin dependencias: `node --test`.
- **Compuertas:** pruebas completas en verde + guion de humo de las 4 rutas existentes + revisión de la lista «qué no cambia» (§9). Reporte de compuertas al cerrar cada fase.
- **Reglas anti-trampa:** no saltar ni borrar pruebas, no bajar umbrales, no silenciar comprobaciones.
- **Agentes por fase:** @security (1, 2, 6, 8), @tester (0, antes y después de tocar `radio.js`), @accessibility-designer (5, 8), @observability (diagnóstico, 6), @docs (8).
- **Documentación en un solo lugar:** el README de Lite. Este plan se archiva al terminar.

---

## 9. Qué NO cambia (guardia de regresión)

1. `/`, `/kiosco`, `/remote` y `play` se comportan igual; `MENU.cmd` y los scripts de la Pi no se tocan hasta la Fase 8.
2. Los contratos actuales de `/api/genres`, `/api/podcasts`, `/api/search`, `/api/history`, `/api/cmd`, `/api/state`, `/api/events`, `/api/next`, `/api/play/*`, `/api/thumb/*`, `/api/lyrics`, `/api/time`, `/api/health` y `/api/clients`.
3. La excepción de `/panel` sin clave (solo oír) y `PANEL_PUBLICO=0` siguen funcionando.
4. El radio principal (pantallas) y las sesiones por `sid` (`radio.js`).
5. Sin dependencias de npm; Node ≥ 18; instalación sin `sudo`/administrador.
6. El proyecto grande **no se toca** (sigue donde está).

---

## 10. Riesgos

| Riesgo | Efecto | Mitigación |
|---|---|---|
| **Datos personales en un repo público** | Filtrar correos y hashes | `.gitignore` en la Fase 0 **antes** de crear cuentas; datos fuera del repo en producción; prueba que falla si un archivo de datos aparece en `git ls-files` |
| **HTTP en red local** | La cookie y la contraseña viajan sin cifrar en la LAN | Aceptar y documentar; `Secure` si hay TLS; sin reutilizar contraseñas del dominio (avisarlo en el registro) |
| **`scrypt` en la Pi** | Entrar tarda o bloquea el servidor | Medir; parámetros ajustados; máx. 1–2 hashes simultáneos |
| **Muy pocos géneros de energía baja** (44 de 479) | Bienestar «para calmar» con estilo restringido sin candidatos | Regla de relajación y prueba de matriz (§6.4); ampliar etiquetas de géneros calmos |
| **IA local menos «inteligente»** | Recomendaciones más repetitivas | Semillas grandes y revisadas; «ángulos» rotativos; Gemini opcional (Fase 7) |
| **Pi con SPA grande + varios oyentes** | Tirones, calor | Carga por vista, visualizador apagado, tope de sesiones, medir con 3/5/10 oyentes; la Pi no es para decenas de oyentes (ya lo dice el ROADMAP) |
| **Enlace de la Pi con YouTube inestable** (hallazgo previo, ver ROADMAP §4) | Más oyentes = más fallos visibles | Fuera del alcance de este plan; la prueba de sondeo y los reintentos ya existen |
| **`yt-dlp` incumple los términos de YouTube** | Decisión ya asumida | Sin cambios; documentar que más oyentes amplían la exposición |
| **Archivos JSON y concurrencia** | Pérdida de datos si dos escrituras se pisan | Cola por archivo + escritura atómica; un solo proceso |
| **Filtro explícito por título** | No es infalible | Documentar la limitación; lista editable |
| **Alcance** (≈ 33–46 días) | Se alarga | Fases con bandera y entregables útiles por separado; la 7 es prescindible |

---

## 11. Decisiones abiertas

| # | Decisión | Recomendación |
|---|---|---|
| **D1** | ¿Cómo se llega al panel nuevo? | **Decidido:** `/panel/completo` (bandera `PANEL_V2`); en la Fase 8 pasa a `/panel` y el de hoy queda en `/panel/simple`. |
| **D2** | ¿La cuenta es opcional? | **Decidido:** opcional. |
| **D3** | ¿Quién administra? | La clave `REMOTE_TOKEN` existente (sin decisión nueva; se mantiene). |
| **D4** | ¿Qué es «IA» aquí? | **Decidido:** sin Gemini. Reglas locales por ahora. **Pendiente de aclarar:** se mencionó «el modelo que tenemos de paga»: ¿cuál es y cómo se accede (clave de API, endpoint interno)? Define el adaptador de la Fase 7. |
| **D5** | Recuperación de contraseña | **No aplica:** se entra solo con nómina, sin contraseña. |
| **D6** | Quién puede entrar | **Decidido:** solo por número de nómina. Riesgo inherente: quien conozca una nómina entra como esa persona. Mitigación: lista opcional `DATA_DIR/nominas-permitidas.txt` (si existe, solo esas entran) y que la cuenta solo guarde gustos de música. |
| **D7** | Oyentes simultáneos | **Decidido:** 5. Sirve un PC normal; la Pi 4B es justa si los cinco reproducen a la vez (a medir en la Fase 8). |
| **D8** | Fuentes externas (Audius, Radio Browser, Jamendo, charts) | Dejar la Fase 7 al final y prescindible; el valor de «local» se pierde si se encienden. |
| **D9** | Mensajes y jingles programados en `/panel` | Solo en pantallas (kiosco) en la v1; el oyente del panel no los recibe. |
| **D10** | Se retoman los **No me gusta** como filtro real (§6.2) | Sí, es barato una vez que hay perfil de gusto. |
