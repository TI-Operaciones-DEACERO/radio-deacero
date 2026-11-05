'use strict';
/* Arranque: DEACERO Play Lite. Variables opcionales: PORT (8000), HOST (127.0.0.1), REMOTE_TOKEN, DATA_DIR, YTDLP_BIN, YTDLP_EXTRA. */
const path = require('node:path');
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
const genres = require('./data/genres.json');

const PORT = Number(process.env.PORT) || 8000;
const HOST = process.env.HOST || '127.0.0.1'; /* 0.0.0.0 para controlarlo desde otro equipo de la red */
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data'); /* aquí se guardan los podcasts */
const TOKEN = process.env.REMOTE_TOKEN || ''; /* clave para quien NO sea la propia Pi (header x-token o ?t=) */

const extraArgs = (process.env.YTDLP_EXTRA || '').split(/\s+/).filter(Boolean); /* p. ej. "--cookies /ruta/cookies.txt" */
const ytdlp = createYtdlp({ extraArgs, ...(process.env.YTDLP_BIN ? { cmd: { cmd: process.env.YTDLP_BIN, extra: [] } } : {}) });
const proxy = createProxy({ resolve: (id, mode) => ytdlp.resolve(id, mode), invalidate: (id) => ytdlp.invalidate(id) });
/* El radio comprueba con el proxy que una canción se puede reproducir ANTES de ofrecerla (si no, la pantalla se queda en silencio y salta). */
const radio = createRadio({ genres, search: (q, n) => ytdlp.search(q, n), probe: (id) => proxy.probe(id) });

const timesync = createTimeSync(); /* hora real vía cabecera Date de HTTPS: la Pi puede tener el reloj atrasado */

const server = createServer({
  publicDir: path.join(__dirname, 'public'),
  genres, ytdlp, radio, proxy,
  thumbs: createThumbs(),
  lyrics: createLyrics(),
  control: createControl(),
  clients: createClients(),
  history: createHistory({ dir: DATA_DIR }),
  timesync,
  podcasts: createPodcasts({ dir: DATA_DIR }),
  /* episodios: de 5 min a 4 h */
  episodes: (q, n) => ytdlp.search(episodeQuery(q), n, { minSec: 300 }),
  token: TOKEN
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
    if (HOST !== '127.0.0.1' && !TOKEN) console.log('  ⚠ Accesible desde la red SIN clave: define REMOTE_TOKEN');
  });
})();

server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `  Puerto ${PORT} en uso` : e);
  process.exit(1);
});
