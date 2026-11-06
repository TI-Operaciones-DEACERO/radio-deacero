# DEACERO Play Lite

Reproductor local de música aleatoria. Cada 4–6 canciones salta a un género al azar
(479 géneros; el azar usa los 79 destacados). Un género que pides a mano también dura una racha de 4–6 canciones y luego vuelve la rotación sola: nada se queda fijo horas. Controles grandes para pantalla táctil,
modo solo audio / video, letra sincronizada, visualizador, **podcasts** y **control remoto** (comando `play` y web `/remote`).
El **panel completo** (`/panel`) suma Bienestar, recomendaciones con IA, favoritos con cuenta (solo número de nómina), búsqueda,
letras/karaoke, sonidos de naturaleza, temas y **administración** de las pantallas (horario, anuncios, filtro, usuarios, diagnóstico).
Sin base de datos, **sin dependencias de npm**: solo Node ≥ 18 y `yt-dlp`.

## Uso en tu PC

```bash
pip install -U yt-dlp      # o el binario de yt-dlp en el PATH
npm start                  # http://localhost:8000
npm test                   # ~500 pruebas, sin red
node scripts/humo.js       # humo: arranca el servidor real con datos temporales y revisa todas las páginas (--navegador: también en Edge/Chromium sin ventana)
```

| Variable | Defecto | Para qué |
|---|---|---|
| `PORT` | `8000` | Puerto (en Linux no puede ser < 1024 sin root) |
| `HOST` | `127.0.0.1` | `0.0.0.0` para controlarlo desde otro equipo **de tu red** |
| `DATA_DIR` | `./data` | Datos (ver *Cuentas y datos*). **En producción, fuera de la carpeta de la app** |
| `REMOTE_TOKEN` | — | Clave para quien no sea la propia máquina (header `x-token` o `?t=`). **Defínela si `HOST=0.0.0.0`**. Sin ella, la administración solo se abre desde la propia máquina |
| `PANEL_PUBLICO` | `1` | `0` obliga a usar clave también en `/panel` (por defecto `/panel` no la pide; ver la sección de seguridad) |
| `PANEL_PRINCIPAL` | `completo` | `simple` deja `/panel` como el panel de siempre (el completo sigue en `/panel/completo`) |
| `PANEL_V2` | `1` | `0` apaga el panel completo |
| `GEMINI_KEY` | — | Clave de Gemini (IA de pago). Sin ella, o si falla o se agota la cuota, responde el **motor local** sin avisar al oyente. Solo en `.env` o el entorno, nunca en el repo |
| `GEMINI_MODEL` | `gemini-3.7-flash` | Modelo de Gemini |
| `HOSTS_PERMITIDOS` | — | Nombres extra (separados por coma) con los que se puede entrar a cuenta/administración (anti DNS rebinding) |
| `COOKIE_SECURE` | — | `true` si se sirve por HTTPS |
| `YTDLP_BIN` | autodetectado | Ruta de yt-dlp si no está en el PATH |
| `YTDLP_EXTRA` | — | Opciones extra, p. ej. `--cookies /ruta/cookies.txt` |

Las variables pueden ir en un archivo `.env` junto a `server.js`. En `DATA_DIR/.env` (sobrevive a las actualizaciones) **solo** se aceptan `GEMINI_KEY`, `GEMINI_MODEL`,
`REMOTE_TOKEN`, `HOSTS_PERMITIDOS`, `PANEL_V2`, `PANEL_PRINCIPAL`, `PANEL_PUBLICO` y `COOKIE_SECURE`; lo demás se ignora con un aviso al arrancar
(esa carpeta la pueden escribir otros usuarios del equipo). Lo que ya esté en el entorno manda.

`?vis=0` en la URL apaga el visualizador (por si la Pi va justa).
`?mode=audio` (por defecto) o `?mode=video` fija el modo de arranque (en la vista `/kiosco` el defecto es video). El kiosco de la Pi usa `http://localhost:8000/?mode=audio` (solo música): Chromium se
cierra a la fuerza y no siempre guarda el último modo elegido, así que el parámetro asegura cómo arranca tras cada reinicio.

## Vistas

| Dirección | Vista |
|---|---|
| `/` | Reproductor normal: carátula o video a un lado, controles al otro. |
| `/panel` | **Panel completo** (ver abajo). Su pestaña *Radio* es el panel de siempre. Con `PANEL_PRINCIPAL=simple`, `/panel` vuelve a ser el de siempre. `/panel/completo` funciona igual (marcadores). |
| `/panel/simple` | **El panel de `/remote`, pero la música suena en ESTE navegador y no pide clave** (búsqueda, géneros, podcasts, pausa, volumen…). No es una pantalla ni un control remoto: no recibe las órdenes de nadie, no manda las suyas a las demás pantallas y no pisa su estado. **Lleva su propia racha** (el navegador manda un id de sesión; el servidor guarda aparte el género, las canciones que le quedan y las últimas que sonaron; caduca a las 2 h sin uso y hay tope de 100 sesiones), así que elegir género o buscar aquí NO cambia lo que suena en `/` ni en `/kiosco`. Solo audio (sin video ni letra). Los navegadores no dejan sonar sin un toque: la primera vez aparece «Toca para empezar a escuchar». Sin clave se ocultan «Guardar podcast», quitar podcasts y la pestaña *Equipos*. |
| `/kiosco` | **Vista kiosco, solo para ver**: el video de fondo a pantalla completa, difuminado (se distingue el video, sin detalle), y al frente la **hora en grande** (12 h con AM/PM, segundos y fecha), la canción y la que sigue. No tiene botones, barra de progreso, volumen, género ni dirección de control, y el teclado no hace nada: todo se maneja desde `/remote` (o `play`). Con `?mode=audio` el fondo es la carátula difuminada en vez del video. |

El desenfoque no usa `filter: blur` (a 1080p hace tropezar a una Raspberry Pi): el video se dibuja en un mosaico de 96×54 px y el navegador lo escala a pantalla
completa. (Con 32×18 px se veían solo manchas; con 96×54 se reconoce la imagen.) La medición de una Pi 4B (30 fps, ~19 % de CPU) fue con 32×18 y no se repitió con 96×54.

**La hora está corregida:** una Pi sin reloj de hardware (y con NTP bloqueado) se atrasa —la de pruebas iba **7 días** atrasada—, y un reloj enorme en pantalla lo
delataría. El servidor calcula el desfase con la cabecera `Date` de las respuestas HTTPS de YouTube/Google (`src/timesync.js`, cada 10 min) y la vista kiosco
muestra la hora real (`GET /api/time`). No cambia el reloj del sistema (eso pide root); si no logra sincronizar, la vista usa el reloj local.

Para que la Pi arranque en la vista kiosco: `~/DEACEROPLAY-lite/deploy/install-autostart.sh "http://localhost:8000/kiosco"` y reiniciar el kiosco.

## Panel completo (`/panel`)

Pestañas: **Radio** (el panel de siempre, con el motor de audio: nunca se quita, al cambiar de pestaña la música sigue), **Bienestar**, **Para ti**,
**Favoritos**, **Buscar**, **Naturaleza** y **Administración** (solo aparece con acceso). Cada módulo pesado se descarga al abrir su vista.

- **Cuenta (opcional):** se entra solo con el **número de nómina** (4–10 dígitos), sin contraseña; sin cuenta todo suena igual. La cuenta guarda Me gusta / No me gusta,
  playlists, historial, tema y gustos. **Las cuentas no se pueden borrar desde la app** (se pueden descargar los datos propios); el administrador las desactiva.
  Si existe `DATA_DIR/nominas-permitidas.txt` (una nómina por línea) solo esas entran; si no, entra cualquiera (el arranque lo avisa).
- **No me gusta** de verdad: los géneros que alguien rechaza dejan de salir en *su* rotación (no en la de los demás).
- **Para ti / IA:** recomendado ahora, hecho para ti, descubrir, artistas, podcasts y playlists. Usa **Gemini** si hay `GEMINI_KEY` (límite de 30/min y 1500/día,
  cortacircuitos) y si no, o si falla, un motor **local** con semillas (`data/seed/`). El oyente no nota la diferencia salvo en la variedad.
- **Bienestar (Viaje ISO):** eliges cómo estás (18 ánimos), a dónde quieres llegar (6), estilo, idioma, duración e intensidad; el plan va por 5 fases
  de energía y al terminar **continúa** sin silencio. El viaje es de esa sesión: no cambia lo que suena en las pantallas ni a otros oyentes.
- **Buscar:** lista de resultados; ▶ toca una vez y luego sigue la radio.
- **Letra y Karaoke** a pantalla completa (sincronizada si lrclib la tiene; si no, desplazamiento proporcional estimado).
- **Naturaleza:** lluvia, olas, viento, bosque, ruido rosa y marrón **sintetizados** en el navegador (sin archivos ni red), mezclables, con suavizado, espacio y temporizador.
- **Visualizador** (8 modos): animación **decorativa** (no analiza el audio: hacerlo exigiría tocar el `<audio>` del motor). Arranca quieto en equipos lentos y con «reducir movimiento».
- **6 temas** (oscuro, claro, alto contraste, brasa, océano, bosque), todos AA; con cuenta se recuerdan en otros equipos.
- **Atajos:** espacio, `N` siguiente, `L` letra, `K` karaoke, `/` buscar, `1`–`9` pestañas, `?` ayuda (se pueden apagar en la ayuda).
- No hay ecualizador ni crossfade sobre la música, por la misma razón que el visualizador.

## Administración (pestaña o `/api/admin/*`)

Con `REMOTE_TOKEN` hace falta la clave (`?t=CLAVE` una vez, o pegarla en *Apariencia*); sin `REMOTE_TOKEN`, **solo desde la propia máquina**.
Todo afecta a las **pantallas** (`/` y `/kiosco`), nunca a quien escucha en el panel.

- **Horario:** *rotación* (como siempre), *horario* (bloques por días y franja con sus géneros; fuera de los bloques, rotación normal) o *musicoterapia 24/7*
  (el ánimo sale de la hora dentro de la jornada, por defecto 7–19 h: calma → foco → ánimo a la comida → foco → energía por la tarde → bajar). **Generar semana** propone
  hasta 8 bloques de lunes a viernes (con un género latino al mediodía) para editarlos antes de guardar. Un género pedido a mano desde `/remote` se respeta su racha.
- **Anuncios:** `.mp3` de hasta 5 MB (se comprueba el encabezado, no la extensión), por días, franja e intervalo (o una vez al día). El **servidor** es el único reloj:
  los manda por SSE y la pantalla baja la música mientras suena. Suena una vez por franja y solo en sus primeros 5 min (tras un reinicio no suena a deshora). *Probar* lo lanza ya.
- **Ajustes:** filtro de contenido explícito (apagado por defecto). Descarta títulos con *explicit, sin censura, uncensored, nsfw, +18…* y las palabras que agregues.
  **No es infalible:** `yt-dlp` no tiene el *safeSearch* de la API oficial.
- **Usuarios:** lista, activar / desactivar (desactivar cierra sus sesiones).
- **Diagnóstico:** errores y avisos recientes por servicio (yt-dlp, Gemini, radio, servidor) y estado del sistema. En memoria, sin claves.

## Cuentas y datos (`DATA_DIR`)

| Archivo | Qué |
|---|---|
| `users.json`, `sessions.json`, `users/<id>.json` | cuentas, sesiones (solo el hash del token) y la biblioteca de cada cuenta |
| `nominas-permitidas.txt` | lista opcional de nóminas que pueden entrar |
| `horario.json`, `ajustes.json`, `anuncios.json`, `anuncios/*.mp3` | administración |
| `podcasts.json`, `history.json` | podcasts guardados e historial de búsquedas |
| `.env` | claves (`GEMINI_KEY`…) que sobreviven a las actualizaciones |

Nada de esto se versiona (`.gitignore`). **Respaldo:** `node scripts/respaldo.js respaldar [destino]` (copia con fecha) y, con el servidor detenido,
`node scripts/respaldo.js restaurar <carpeta>` (lo que había se aparta, no se borra). Los respaldos tienen datos personales.

## Controles en pantalla

| Tecla | Acción | | Tecla | Acción |
|---|---|---|---|---|
| Espacio | Pausa / play | | `V` | Audio / video |
| `←` / `P` | Anterior | | `L` | Letra |
| `→` / `N` | Siguiente | | `G` | Elegir género |
| `↑` `↓` | Volumen | | `R` | Otro género al azar |
| `M` | Silenciar | | `I` | Ver la dirección de control (o tocar el logo) |
| | | | `Esc` | Cerrar paneles |

Todo se hace también tocando. El selector de géneros tiene buscador.

## Control remoto

**Por terminal / SSH** — comando `play` (en la Pi: `ssh admin@IP play next`):

```
play status                  qué suena        play genre jazz       pedir un género (id o texto)
play next | prev             siguiente/ant.   play genres [texto]   listar / buscar géneros
play toggle | pause | resume pausa/play       play search bad bunny tocar UNA vez una canción/artista
play podcast radio ambulante tocar un episodio     play podcasts         podcasts guardados
play find [192.168.1.0/24]    buscar la Pi si cambió de IP
play clients                 qué equipos hay conectados (pantallas y controles)
play history [n]             últimas búsquedas: quién buscó qué y cuándo
play history clear --yes     borrar el historial
play random                  otro género      play vol 70 | +5 | -5 volumen
play mode video | audio      video/audio      play mute | lyrics    silenciar / letra
```

Desde otro equipo, sin SSH: `play -u http://IP:8000 -t CLAVE next` (o `PLAY_URL` / `PLAY_TOKEN`). Es un solo archivo Python
(`deploy/play`, solo biblioteca estándar); funciona también en Windows.

**Por web** — `http://IP-DE-LA-PI:8000/remote` en el celular o la PC: anterior/pausa/siguiente, volumen, video, letra y dos pestañas:
**Música** (tocar una canción/artista una vez y **elegir género** de la lista completa, con filtro en vivo), **Podcasts** (guardar tus podcasts, ver
episodios y tocarlos) y **Equipos** (quién está conectado). El título
de lo que suena se muestra completo. La primera vez pide la clave (o ábrelo con `?t=CLAVE`, se guarda en el navegador).

**Equipos conectados** (pestaña *Equipos* o `play clients`): lista las **pantallas** que reproducen (conexión abierta) y los **controles** que han consultado
o mandado órdenes en los últimos 10 min, con nombre del equipo (DNS de la red; si no lo conoce, solo la IP), IP, tipo de dispositivo (celular, PC, terminal…),
si están **activos** (visto hace < 10 s) y su **última orden**. La pestaña se actualiza sola. Solo se ve quién usa el control, no quién abre la página sin usarlo.

**Quién es cada quien:** un navegador no entrega el usuario de Windows (y, al entrar por IP, ni siquiera manda la sesión de Windows al servidor), así que
**la web no pide ni muestra nombres de persona**: de cada equipo se ve el nombre del equipo (DNS de la red) y su IP. Por **terminal**, `play` manda solo el usuario con
el que iniciaste sesión (se cambia con `PLAY_USER`) y aparece en `play clients` y `play history`. Es un dato declarado por el propio programa, no una autenticación.

**Historial de búsquedas — solo por comandos:** `play history [n]` muestra las últimas búsquedas (canciones/artistas, podcasts buscados, episodios tocados y géneros
elegidos) con quién, desde qué equipo y cuándo; `play history clear --yes` lo borra (de **todos** los equipos). La web no tiene pantalla de historial, pero sus
búsquedas también quedan registradas. Se guardan las últimas 200 en `history.json` (junto a los podcasts). La hora es la del equipo que buscó, porque el reloj de la Pi está mal.

**Pauta única:** una canción buscada o un episodio de podcast suena **una vez** y la lista sigue como estaba (Jazz → [Dua Lipa] → Jazz): no cambia
el género, la racha ni la cola de canciones que ya estaban pedidas. Si pulsas *siguiente* durante la pauta, vuelves a la lista donde iba.

**Cómo funciona:** la música suena en el navegador de la pantalla; el servidor reenvía las órdenes a esa página por
Server-Sent Events (`/api/events`) y guarda lo que la pantalla reporta (`/api/state`). Si no hay ninguna pantalla abierta,
las órdenes responden `409 NO_PLAYER`.

**Varias pantallas:** hoy una orden llega a **todas** las pantallas abiertas y cada una pide sus propias canciones al
servidor (el estado del radio —género y recientes— es uno solo). Está pensado para **una** pantalla.

| API | |
|---|---|
| `POST /api/cmd` | `{cmd: toggle/play/pause/next/prev/random/mute/lyrics}` · `{cmd:'genre',id}` · `{cmd:'volume',set/delta}` · `{cmd:'mode',mode}` · `{cmd:'search',q}` |
| | `{cmd:'track',kind:'podcast'\|'search',track:{id,title,channel,duration}}` toca un episodio/canción concreta (pauta única) |
| `GET /api/state` | qué suena, pausa, volumen, modo, pantallas conectadas |
| `GET/POST /api/podcasts`, `DELETE /api/podcasts/:id` | podcasts guardados (`{name, q}`) |
| `GET /api/podcast/search?q=` | episodios (5 min – 4 h) |
| `GET /api/health` | estado y **direcciones IP** del servidor |
| `GET /api/time` | hora real corregida (`now`), desfase y si está sincronizada |
| `GET /api/clients` | pantallas y controles conectados, y quién eres tú |
| `GET /api/history?limit=`, `DELETE /api/history` | historial de búsquedas |
| cabeceras `x-user` (usuario, codificado) y `x-client-time` (hora real) | las manda `play` (la web solo manda la hora); el servidor las usa para Equipos e historial |
| `GET /api/search?q=` | géneros que coinciden |
| `GET /api/events` | flujo SSE de órdenes (lo usa la pantalla); también `{cmd:'anuncio',id,nombre}` |
| `GET /api/buscar?q=&sid=` · `GET /api/lyrics?…&sid=` | búsqueda con lista y letras para el oyente del panel (con su id de sesión) |
| `/api/auth/login\|logout\|me\|profile\|export` | cuenta por nómina (cookie `pl_user`, HttpOnly, 7 días) |
| `/api/me/reactions\|playlists\|history\|taste\|prefs` | biblioteca de MI cuenta |
| `/api/ia/ahora\|para-ti\|descubrir\|artistas\|podcasts\|playlist` | recomendaciones (Gemini o local) |
| `GET /api/bienestar/opciones`, `POST\|DELETE /api/bienestar/viaje?sid=` | Bienestar |
| `/api/admin/estado\|horario\|horario/generar\|horario/ahora\|anuncios\|ajustes\|diagnostico\|usuarios` | administración (clave) |
| `GET /api/anuncio/:id` | audio de un anuncio (lo pide la pantalla) |

Qué ruta existe y quién puede usarla está en **una sola tabla**, `src/policy.js` (nivel `publico`, `oyente`, `usuario` o `clave`, métodos y tope de cuerpo);
lo que no está ahí responde 405/404. Las escrituras exigen que `Origin` coincida con `Host` y cuerpo JSON. Hay límites de ritmo en entrar, `/api/next`,
búsquedas, letras, IA y escrituras de la biblioteca.

Con `REMOTE_TOKEN` definido, todo `/api/*` (salvo `/api/health`) exige la clave a los clientes remotos; la propia Pi (loopback) no. **Excepción para `/panel`** (solo `GET`): `/api/genres`, `/api/play/*`, `/api/thumb/*`, `/api/podcast/search`, `/api/podcasts` (leer) y `/api/next` **únicamente con `?sid=` válido** (8–40 caracteres `A-Za-z0-9_-`). Siguen exigiendo clave todo lo que manda órdenes a pantallas (`/api/cmd`, `/api/events`, `/api/state`), lo que muestra equipos (`/api/clients`, `/api/history`), guardar o quitar podcasts y `/api/next` sin `sid` (la racha de las pantallas). Riesgo asumido: cualquiera que alcance el puerto puede oír música por el servidor (gasta su ancho de banda y yt-dlp). `PANEL_PUBLICO=0` cierra esa excepción.

## Raspberry Pi (instalación sin `sudo`)

La Pi no alcanza GitHub ni PyPI y `sudo` pide contraseña, así que todo vive en el home del usuario:

| Qué | Dónde |
|---|---|
| Node 22 | `~/.local/lib/node` (enlace `~/.local/bin/node`) |
| yt-dlp (copiado desde el PC, Python puro) | `~/.local/lib/ytdlp` + wrapper `~/.local/bin/yt-dlp` |
| App | `~/DEACEROPLAY-lite` |
| Servicio (usuario) | `~/.config/systemd/user/play-lite.service` (copia de `deploy/play-lite.user.service`) — `systemctl --user status\|restart play-lite` |
| Configuración y clave de red | `~/.config/play-lite.env` (`HOST`, `REMOTE_TOKEN`, `DATA_DIR`) |
| Podcasts e historial | `~/.local/share/play-lite/podcasts.json` y `history.json` |
| Pantalla completa al encender | `~/.config/autostart/play-lite-kiosk.desktop` → `deploy/start-kiosk.sh` |
| Comando `play` | `~/.local/bin/play` (y `~/.bashrc` añade `~/.local/bin` al PATH, también en SSH) |

`loginctl enable-linger` está activo: el servidor arranca aunque nadie inicie sesión.

### Si cambia la IP de la Pi

Si la Pi usa **Wi-Fi/Ethernet con DHCP**, la IP puede cambiar (sobre todo con concesiones cortas). Formas de encontrarla:

1. **`play find`** desde tu PC (escanea la red en ~5 s y muestra la IP, el enlace de control web y el comando SSH). Si no sabe dónde buscar, indícale la red: `play find 192.168.1.0/24`.
2. **En la pantalla de la Pi:** al arrancar se muestra 25 s "Control remoto: http://IP:8000/remote"; después, tocando el logo o con la tecla `I`.
3. **`play status`** (por SSH o desde la web) muestra el enlace de control.

La solución definitiva es una **reserva DHCP** en el router (pide a quien administre la red que ligue la IP a la MAC de la Pi: `ip -o link`), o una IP estática con `nmcli`. El nombre `<host>.local` (mDNS) solo funciona si la red deja pasar multicast.

**Actualizar la app** (desde el PC, en la carpeta del proyecto):
```bash
tar --exclude=.git --exclude=test --exclude=docs --exclude=./.env --exclude=./respaldos --exclude=./data/users --exclude=./data/anuncios $(for f in users sessions horario ajustes anuncios podcasts history; do printf -- '--exclude=./data/%s.json ' $f; done) --exclude=./data/nominas-permitidas.txt -cf - . | ssh admin@IP 'tar -xmf - -C ~/DEACEROPLAY-lite' && ssh admin@IP 'systemctl --user restart play-lite'
```
(Los datos de la Pi viven en `~/.local/share/play-lite` y no se tocan; la clave de Gemini va en `~/.config/play-lite.env` como `GEMINI_KEY=…`.)
**Actualizar yt-dlp** (la Pi no puede bajarlo; si las pistas dejan de sonar suele ser esto). En el PC: `pip install -U yt-dlp`, y
```bash
cd "$(python -c 'import yt_dlp,os;print(os.path.dirname(os.path.dirname(yt_dlp.__file__)))')"
tar --exclude=__pycache__ -cf - yt_dlp | ssh admin@IP 'rm -rf ~/.local/lib/ytdlp/yt_dlp && tar -xf - -C ~/.local/lib/ytdlp' && ssh admin@IP 'yt-dlp --version'
```
**Detener / quitar:** `~/DEACEROPLAY-lite/deploy/stop-kiosk.sh` · `rm ~/.config/autostart/play-lite-kiosk.desktop` · `systemctl --user disable --now play-lite`.
`deploy/start-kiosk.sh` acepta `KIOSK_EXTRA_FLAGS` (p. ej. `--remote-debugging-port=9222` para depurar).

Si la pantalla se apaga sola: `sudo raspi-config` → Display Options → Screen Blanking → No.
El reloj de esta Pi iba ~3 h atrasado (NTP bloqueado); la app lo tolera (si una URL caduca antes de tiempo, reintenta).

## Instalar en un PC con Windows

Sirve igual que la Raspberry Pi: un PC con monitor (o solo servidor) que arranca solo al iniciar sesión. **Los pasos, uno por uno, están en [`LEEME.txt`](LEEME.txt)**
(se abre con el Bloc de notas). En corto:

1. Bajar el zip de GitHub (*Code → Download ZIP*), copiarlo a `C:\` y descomprimirlo (queda `C:\radio-deacero-main`, que no se borra).
2. Doble clic en **`MENU.cmd`** y elegir una opción:

| Opción | Hace |
|---|---|
| 1 | Instalar o actualizar **para todos los usuarios** (`C:\ProgramData\RadioDeacero`; pide administrador; abre el puerto 8000 en el firewall) |
| 2 | Instalar o actualizar **solo para el usuario actual** (`%LOCALAPPDATA%\RadioDeacero`; sin administrador) |
| 3 | Iniciar (servidor + pantalla completa, sin esperar a reiniciar) |
| 4 | Detener (cerrar el navegador no basta: `run-kiosk.ps1` lo reabre a los 3 s) |
| 5 | Estado: si corre, direcciones de control y clave |
| 6 | Desinstalar |

Actualizar = bajar el zip nuevo, extraerlo encima y repetir la opción 1 o 2 (conserva clave, vista, podcasts e historial).

Cómo está hecho (detalles para quien lo mantenga):
- `MENU.cmd` solo llama a los programas de `deploy\windows\`: `install.ps1`, `iniciar.ps1`, `detener.ps1`, `estado.ps1`, `uninstall.ps1`; `run-server.ps1` y `run-kiosk.ps1` son los que arrancan solos
  (accesos en la carpeta *Inicio* del usuario, o la común si se instaló para todos; el servidor se relanza solo si se cae y la pantalla se reabre si se cierra). Los textos de los `.ps1` van sin acentos
  a propósito: PowerShell 5.1 lee mal los `.ps1` sin BOM.
- `install.ps1` acepta `-View kiosco|normal`, `-Mode video|audio`, `-NoKiosk`, `-LocalOnly`, `-Port`, `-Token`, `-InstallDir`, `-NoAutostart`, `-NoStart`. Usa el Node (≥ 18) y el `yt-dlp` que haya o descarga
  copias portátiles (nodejs.org y GitHub; si GitHub está bloqueado, `python -m pip install -U yt-dlp`).
- Instalado como administrador **no arranca** la app desde esa ventana (correría con permisos de administrador y los demás usuarios no podrían pararla): el menú la arranca después con el usuario normal.
- Node se **copia**, no se mueve, a la carpeta de instalación: mover conserva los permisos de la carpeta temporal de quien instala y el resto de usuarios no podría ejecutarlo tras reiniciar. Instalar como administrador repara los permisos de una instalación anterior.
- Los PID de `run-server`/`run-kiosk` se guardan en `<carpeta>\logs\*.pid` (único lugar donde cualquier usuario puede escribir): así se paran sin consultar procesos (a un usuario sin administrador Windows le niega `Get-CimInstance`).
- Para que arranque «en cuanto se prende» el PC debe iniciar sesión solo (inicio de sesión automático, lo configura TI): sin sesión no hay pantalla. La hora de la vista `/kiosco` es la del PC.
- El comando `play` (control por terminal) necesita Python; la web `/remote` funciona sin nada más.

## Cómo funciona

```
Navegador ──► /api/next     el "bot" (src/radio.js) elige género y canción (o una búsqueda)
          ──► /api/play/ID  el servidor resuelve con yt-dlp y pasa el audio (o el video) por proxy
          ──► /api/thumb/ID carátula · /api/lyrics letra (lrclib → lyrics.ovh)
```

- El navegador **solo habla con este servidor**: no necesita llegar a `googlevideo.com`.
- El video llega **sin audio** (360p H.264) y se sincroniza con el audio en el navegador, porque YouTube ya no
  sirve archivos combinados y juntarlos exigiría ffmpeg.
- Géneros que solo existen como mezclas de horas (café, ambient, estudio) reproducen una mezcla y luego cambian.
- Si una pista falla se reintenta una vez y luego salta a la siguiente; tras 5 fallos seguidos espera 30 s.
- Los iconos de género son SVG de [Twemoji](https://github.com/jdecked/twemoji) (CC-BY 4.0, ver `public/assets/emoji/LICENSE.txt`):
  la Pi no trae fuente de emoji y no se puede instalar sin `sudo`.

## Estructura

```
server.js            arranque           src/radio.js    elige género/canción/búsqueda
src/server.js        HTTP + estáticos   src/ytdlp.js    búsqueda y URLs (caché por `expire`)
src/stream.js        proxy con Range    src/control.js  órdenes remotas (SSE) y estado
src/clients.js       equipos conectados  src/podcasts.js podcasts guardados
src/timesync.js      hora real (HTTPS)
src/history.js       historial           src/jsonfile.js JSON en disco (atómico)
src/lyrics.js        letras             src/thumb.js    carátulas
src/policy.js        tabla de rutas/permisos     src/http.js  cuerpo, cookies, origen, Host
src/users.js, sessions.js, authroutes.js   cuenta por nómina       src/library.js, meroutes.js  favoritos
src/gemini.js, ia/, iaroutes.js            IA (Gemini + local)     src/bienestar.js, bienestarroutes.js  Viaje ISO
src/horario.js, anuncios.js, ajustes.js, diagnostico.js, adminroutes.js   administración     src/env.js  lector de .env
public/              interfaz (HTML + CSS + JS, sin build): index.html (pantalla), remote.html (control y panel simple), panel-completo.html + js/panel/
scripts/             humo.js (prueba de humo), respaldo.js (copia/restauración de DATA_DIR), enriquecer-generos.js
data/seed/           artistas y podcasts semilla del motor local de IA
deploy/              play (CLI), start/stop-kiosk.sh, install-autostart.sh, play-lite.user.service (Raspberry Pi)
MENU.cmd, LEEME.txt   menú y pasos para Windows
deploy/windows/      install, iniciar, detener, estado, uninstall (.ps1) y run-server/run-kiosk (PC con Windows)
data/genres.json     479 géneros        test/           node:test
```

## Límites conocidos

- Usa `yt-dlp`, que **incumple los términos de servicio de YouTube**; es una decisión de uso personal.
- Se rompe de vez en cuando cuando YouTube cambia algo: actualizar `yt-dlp` suele arreglarlo.
- Cada búsqueda tarda ~4–6 s y resolver una pista ~5 s en la Pi; el cliente precarga 2 pistas. Cambiar a un género nuevo
  puede tardar unos segundos y la pantalla muestra "Buscando música…".
- El radio de las **pantallas** es uno solo (género, historial reciente en el servidor); cada oyente del panel lleva su propia racha (hasta 100 sesiones).
  Pensado para ~5 oyentes a la vez: cada uno es un flujo de audio por el servidor. **No se ha medido** en la Pi con 3, 5 o 10 oyentes.
- Sin `GEMINI_KEY` (o con la cuota agotada) las recomendaciones salen de listas locales: más repetitivas que con Gemini.
- Los episodios de podcast salen de la búsqueda normal de YouTube con "podcast" añadido (5 min – 4 h); no se puede garantizar el orden por fecha
  (`yt-dlp` ya no soporta `ytsearchdate`). Un episodio puede durar horas: *siguiente* lo salta.
- Si la red bloquea NTP, la hora de la Pi puede ir atrasada (no tiene reloj de hardware).
