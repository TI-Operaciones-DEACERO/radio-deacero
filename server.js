'use strict';
/* Arranque: DEACERO Play Lite. Variables opcionales: PORT (8000), HOST (127.0.0.1), REMOTE_TOKEN, DATA_DIR, YTDLP_BIN, YTDLP_EXTRA,
 * PANEL_V2=0 (apaga el panel completo), PANEL_PRINCIPAL=simple (/panel vuelve a ser el de siempre), COOKIE_SECURE=true (cookie solo por HTTPS),
 * GEMINI_KEY / GEMINI_MODEL (IA; sin clave, motor local), HOSTS_PERMITIDOS, PANEL_PUBLICO=0. Las claves pueden ir en .env o en DATA_DIR/.env. */
const path = require('node:path');
const { loadEnv, ENV_DATOS } = require('./src/env');
/* Configuración y claves: el entorno manda; lo que falte se toma de .env (git lo ignora). Se carga ANTES de leer process.env. */
const envCargado = loadEnv(path.join(__dirname, '.env'));
/* También DATA_DIR/.env: en las instalaciones la carpeta de la app se REEMPLAZA al actualizar y la de datos se conserva.
 * Solo claves y opciones del panel (ENV_DATOS): esa carpeta la pueden escribir otros usuarios del equipo y no debe decidir qué se ejecuta. */
const envDatos = loadEnv(path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), '.env'), process.env, { permitidas: ENV_DATOS });
const { createServer } = require('./src/server');
const { createYtdlp } = require('./src/ytdlp');
const { createRadio } = require('./src/radio');
const { createProxy } = require('./src/stream');
const { createThumbs } = require('./src/thumb');
const { createLyrics } = require('./src/lyrics');
const { createControl } = require('./src/control');
const { createPodcasts, episodeQuery } = require('./src/podcasts');
const { createClients } = require('./src/clients');
const { createHistory } = require('./src/history');
const { createTimeSync } = require('./src/timesync');
const { createUsers } = require('./src/users');
const { createSessions } = require('./src/sessions');
const { createLibrary } = require('./src/library');
const { createGemini } = require('./src/gemini');
const { createIa } = require('./src/ia');
const { createPrograma } = require('./src/horario');
const { createAnuncios } = require('./src/anuncios');
const { createAjustes } = require('./src/ajustes');
const { createDiagnostico } = require('./src/diagnostico');
const { createCalentador } = require('./src/calentador');
const { createPopularidad } = require('./src/popularidad');
const { createMuestras } = require('./src/muestras');
const genres = require('./data/genres.json');

const PORT = Number(process.env.PORT) || 8000;
const HOST = process.env.HOST || '127.0.0.1'; /* 0.0.0.0 para controlarlo desde otro equipo de la red */
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data'); /* aquí se guardan podcasts, historial y cuentas (nada de esto se versiona) */
const TOKEN = process.env.REMOTE_TOKEN || ''; /* clave para quien NO sea la propia Pi (header x-token o ?t=) */

const extraArgs = (process.env.YTDLP_EXTRA || '').split(/\s+/).filter(Boolean); /* p. ej. "--cookies /ruta/cookies.txt" */
const ytdlp = createYtdlp({ extraArgs, ...(process.env.YTDLP_BIN ? { cmd: { cmd: process.env.YTDLP_BIN, extra: [] } } : {}) });
const proxy = createProxy({ resolve: (id, mode) => ytdlp.resolve(id, mode), invalidate: (id) => ytdlp.invalidate(id) });
const diag = createDiagnostico(); /* anillo de eventos para la pestaña Diagnóstico (en memoria, sin claves) */
const ajustes = createAjustes({ dir: DATA_DIR }); /* filtro de contenido explícito (apagado por defecto) */
const timesync = createTimeSync(); /* hora real vía cabecera Date de HTTPS: la Pi puede tener el reloj atrasado */
const reloj = () => timesync.current();

/* Para las PANTALLAS el radio comprueba con el proxy que una canción se puede reproducir antes de ofrecerla (si no, se quedan en silencio).
 * Al oyente del panel se la da directo (sin esa espera), prefiriendo las que ya tienen la URL resuelta. */
const radio = createRadio({
  genres, filtro: (t) => ajustes.permite(t), listo: (id) => ytdlp.isResolved(id), resolver: (id) => ytdlp.resolve(id, 'audio'),
  search: (q, n) => ytdlp.search(q, n).catch((e) => { diag.add('yt-dlp', 'error', 'búsqueda: ' + (e && e.message)); throw e; }),
  probe: async (id) => { const ok = await proxy.probe(id); if (!ok) diag.add('yt-dlp', 'aviso', `pista ${id} no reproducible`); return ok; }
});

/* IA: Gemini (modelo de pago) si hay clave en GEMINI_KEY; si no, o si falla, el motor local. La clave NUNCA va al repo: solo en el entorno / .env. */
const gemini = createGemini({ key: process.env.GEMINI_KEY || '', ...(process.env.GEMINI_MODEL ? { model: process.env.GEMINI_MODEL } : {}) });
const geminiJson = gemini.json;
gemini.json = (...a) => geminiJson(...a).catch((e) => { if (e && e.code !== 'GEMINI_OFF') diag.add('gemini', 'aviso', (e && (e.code || e.message)) + ' → respaldo local'); throw e; });
const popularidad = createPopularidad({ dir: DATA_DIR }); /* lo más escuchado de la planta: solo conteos por artista y género */
const ia = createIa({ genres, artistas: require('./data/seed/artistas.json'), podcasts: require('./data/seed/podcasts.json'), popularidad, gemini });
const muestras = createMuestras({ radio, search: (q, n) => ytdlp.search(q, n), filtro: (t) => ajustes.permite(t) }); /* carátula y miniclip de los banners */
process.on('exit', () => { try { popularidad.guardar(); } catch (_) { /* sin disco */ } });

/* Calentador: en segundo plano tiene canciones listas (buscadas y resueltas) de los géneros destacados, de a uno cada CALENTAR_CADA_MS
 * (15 s; 0 lo apaga). Los géneros que la gente pide pasan al frente. Así cambiar de género en el panel empieza al instante. */
const calentador = createCalentador({
  radio, generos: () => genres.filter((g) => g.featured).map((g) => g.id),
  resolver: (id) => ytdlp.resolve(id, 'audio'),
  cadaMs: process.env.CALENTAR_CADA_MS === undefined ? 15000 : Math.max(0, Number(process.env.CALENTAR_CADA_MS) || 0)
});

const control = createControl();
const programa = createPrograma({ dir: DATA_DIR, genres, clock: reloj }); /* horario de las pantallas */
const anuncios = createAnuncios({ dir: DATA_DIR, send: (c) => control.send(c), clock: reloj, tickMs: 20 * 1000 });

if (!process.env.ENTRADA_SECRETO) diag.add('auth', 'aviso', '/entrar acepta enlaces sin firmar (define ENTRADA_SECRETO si otro sistema lo usa)');
else if (process.env.ENTRADA_SECRETO.length < 16) diag.add('auth', 'aviso', 'ENTRADA_SECRETO es corto: usa al menos 16 caracteres');

const server = createServer({
  publicDir: path.join(__dirname, 'public'),
  genres, ytdlp, radio, proxy, muestras, popularidad,
  thumbs: createThumbs(),
  lyrics: createLyrics(),
  control, programa, anuncios, ajustes, diag,
  onGenero: (id) => calentador.prioridad(id), /* el género que alguien está oyendo se mantiene caliente */
  clients: createClients(),
  history: createHistory({ dir: DATA_DIR }),
  timesync,
  users: createUsers({ dir: DATA_DIR }),
  sessions: createSessions({ dir: DATA_DIR }),
  library: createLibrary({ dir: DATA_DIR }),
  ia,
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  panelV2: process.env.PANEL_V2 !== '0',
  panelPrincipal: process.env.PANEL_PRINCIPAL === 'simple' ? 'simple' : 'completo', /* /panel = panel completo; PANEL_PRINCIPAL=simple vuelve al de siempre */
  hostsPermitidos: (process.env.HOSTS_PERMITIDOS || '').split(',').map((x) => x.trim()).filter(Boolean), /* nombres extra aceptados en cuenta/administración */
  podcasts: createPodcasts({ dir: DATA_DIR }),
  /* episodios: de 5 min a 4 h */
  episodes: (q, n) => ytdlp.search(episodeQuery(q), n, { minSec: 300 }),
  token: TOKEN,
  entradaSecreto: process.env.ENTRADA_SECRETO || '', /* firma del enlace /entrar (opcional pero recomendada) */
  relojEntrada: reloj, /* la vigencia de la firma usa la hora corregida por la red (la Pi puede tener el reloj atrasado) */
  panelOpen: process.env.PANEL_PUBLICO !== '0' /* /panel no pide clave; PANEL_PUBLICO=0 lo cierra */
});

(async () => {
  if (process.env.YTDLP_BIN) {
    await ytdlp.search('test', 1).then(() => {}, () => {});
  } else {
    await ytdlp.detect();
  }
  console.log(ytdlp.isReady()
    ? `  ✓ yt-dlp ${ytdlp.version() || ''}`
    : '  ✗ yt-dlp no encontrado — instálalo (ver README)');
  timesync.start();
  server.listen(PORT, HOST, () => {
    console.log(`  DEACERO Play Lite → http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}   (control remoto: /remote)`);
    if (envCargado.archivo) console.log(`  ✓ .env cargado (${envCargado.cargadas.length} variable(s))`);
    if (envDatos.archivo) console.log(`  ✓ .env de datos cargado (${envDatos.cargadas.length} variable(s))`);
    if (envDatos.ignoradas && envDatos.ignoradas.length) console.log(`  ⚠ .env de datos: ignoradas ${envDatos.ignoradas.join(', ')} (ahí solo van claves y opciones del panel; lo demás, en el entorno o el .env de la app)`);
    console.log(gemini.enabled ? '  ✓ IA: Gemini (con respaldo local)' : '  · IA: motor local (define GEMINI_KEY para usar Gemini)');
    if (!require('node:fs').existsSync(path.join(DATA_DIR, 'nominas-permitidas.txt'))) console.log('  ⚠ SIN lista de nóminas: cualquier nómina de 4 a 10 dígitos puede entrar (crea data/nominas-permitidas.txt)');
    if (HOST !== '127.0.0.1' && !TOKEN) console.log('  ⚠ Accesible desde la red SIN clave: define REMOTE_TOKEN');
  });
})();

server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `  Puerto ${PORT} en uso` : e);
  process.exit(1);
});
