'use strict';
/* ytdlp.js — búsqueda y resolución de URLs de YouTube con yt-dlp.
 *
 * Nota de mantenimiento: YouTube cambia su cifrado seguido. Si las pistas dejan
 * de sonar o se cortan a los ~900 KB, lo primero es actualizar yt-dlp. */
const { spawn: realSpawn } = require('node:child_process');

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const MIN_SEC = 60;
const MAX_SEC = 4 * 3600; /* hay géneros (café, ambient, estudio) que solo existen como mezclas de horas */
/* Ruido que no es "una canción": karaoke, reacciones, versiones alteradas... */
const NOISE = /\b(karaoke|reaction|reacci[oó]n|shorts?|tutorial|nightcore|slowed|8d audio|full album|compilation|loop)\b/i;

/* YouTube ya no sirve archivos con audio+video juntos, y juntarlos pide ffmpeg.
 * Por eso el video va SIN audio (360p H.264, lo único que una Raspberry Pi
 * decodifica sin sufrir) y el navegador lo sincroniza con el audio. */
const FORMATS = {
  audio: 'bestaudio[ext=m4a]/bestaudio',
  video: 'bv[ext=mp4][vcodec^=avc1][height<=360]/bv[ext=mp4][vcodec^=avc1][height<=480]/bv[height<=360]'
};

const CANDIDATES = [
  { cmd: 'yt-dlp', extra: [] },
  { cmd: 'python3', extra: ['-m', 'yt_dlp'] },
  { cmd: 'python', extra: ['-m', 'yt_dlp'] },
  { cmd: 'py', extra: ['-m', 'yt_dlp'] }
];

const MAX_URL_TTL = 5 * 3600 * 1000;
const URL_MARGIN = 60 * 1000;
const MAX_CONCURRENT = 2;
const MAX_WAITING = 20; /* peticiones en espera: más allá se rechaza (la cola no crece sin límite) */
/* Baja prioridad (carátulas y miniclips de los banners): a lo sumo UN lugar, nunca antes que la música en fila, y fila corta. Sin esto, abrir el
 * panel llenaba la cola de yt-dlp y el kiosco esperaba minutos su siguiente canción. */
const MAX_BAJA = 1;
const MAX_WAITING_BAJA = 10;

/* yt-dlp (y lo que haya en YTDLP_EXTRA) no necesita ni debe heredar las claves del servidor. */
const SECRETO = /key|token|secret|passw|credential/i;
function cleanEnv(env = process.env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) if (!SECRETO.test(k)) out[k] = v;
  return out;
}
const MAX_CACHE = 300;

/* Las URLs de googlevideo traen su caducidad en `expire` (epoch, s). */
function ttlFromUrl(url, maxMs, now = Date.now()) {
  try {
    const exp = Number(new URL(url).searchParams.get('expire'));
    if (Number.isFinite(exp) && exp > 0) {
      const left = exp * 1000 - now - URL_MARGIN;
      return left <= 0 ? 0 : Math.min(left, maxMs);
    }
  } catch { /* sin expire: usar el tope */ }
  return maxMs;
}

/* extraArgs: opciones propias (p. ej. ['--cookies','cookies.txt'] si YouTube pide verificar que no eres un bot). */
function createYtdlp({ spawn = realSpawn, cmd = null, now = Date.now, concurrency = MAX_CONCURRENT, maxWaiting = MAX_WAITING, extraArgs = [] } = {}) {
  let current = cmd;
  let versionStr = null;
  const cache = new Map();     /* `${id}|${mode}` → { url, duration, expires } */
  const inflight = new Map();  /* misma clave → { p: Promise, ficha } */
  let active = 0, activeBaja = 0;
  const waiting = [], waitingBaja = [];

  /* ficha = { baja }: con qué prioridad corre (puede subir mientras espera; ver subir()). */
  function slot(ficha) {
    if (ficha.baja) {
      if (active < concurrency && activeBaja < MAX_BAJA && !waiting.length) { active++; activeBaja++; return Promise.resolve(); }
      return new Promise((r) => { ficha.espera = r; waitingBaja.push(r); });
    }
    if (active < concurrency) { active++; return Promise.resolve(); }
    return new Promise((r) => waiting.push(r));
  }
  /* Un adorno que ESPERA pasa a prioridad normal (alguien pidió de verdad ese mismo video): sale de la fila de adornos y entra a la normal,
     o arranca ya si hay lugar. Si ya está corriendo no hay nada que hacer. */
  function subir(ficha) {
    const i = ficha.baja && ficha.espera ? waitingBaja.indexOf(ficha.espera) : -1;
    if (i < 0) return;
    waitingBaja.splice(i, 1);
    ficha.baja = false;
    if (active < concurrency) { active++; ficha.espera(); } else waiting.push(ficha.espera);
  }
  /* El lugar que se libera pasa primero a la música en fila; si no hay, a un adorno (si no hay otro adorno en curso). */
  function release(baja) {
    if (baja) activeBaja--;
    const next = waiting.shift();
    if (next) return next();
    if (activeBaja < MAX_BAJA && waitingBaja.length) { activeBaja++; return waitingBaja.shift()(); }
    active--;
  }

  function run(args, timeoutMs = 25000, { baja = false, ficha = { baja } } = {}) {
    if (!current) return Promise.reject(new Error('yt-dlp no disponible'));
    if (ficha.baja ? waitingBaja.length >= MAX_WAITING_BAJA : active >= concurrency && waiting.length >= maxWaiting) return Promise.reject(new Error('yt-dlp: cola llena'));
    return slot(ficha).then(() => new Promise((resolve, reject) => {
      const baja = ficha.baja; /* la prioridad con la que de verdad tomó el lugar */
      ficha.espera = null;
      let out = '';
      let err = '';
      let settled = false;
      const finish = (fn, v) => { if (!settled) { settled = true; clearTimeout(timer); release(baja); fn(v); } };
      let p;
      try { p = spawn(current.cmd, [...current.extra, ...extraArgs, ...args], { env: cleanEnv() }); }
      catch (e) { release(baja); return reject(e); }
      const timer = setTimeout(() => { try { p.kill(); } catch { /* ya terminó */ } finish(reject, new Error('yt-dlp: tiempo agotado')); }, timeoutMs);
      p.stdout.on('data', (d) => { out += d; });
      p.stderr.on('data', (d) => { err += d; });
      p.on('error', (e) => finish(reject, e));
      p.on('close', (code) => {
        if (code !== 0 && !out.trim()) {
          finish(reject, new Error(err.trim().split('\n').pop() || `yt-dlp salió con código ${code}`));
        } else finish(resolve, out);
      });
    }));
  }

  /* Detecta el comando disponible y su versión (se llama una vez al arrancar). */
  async function detect() {
    for (const c of CANDIDATES) {
      try {
        current = c;
        const out = await run(['--version'], 4000);
        versionStr = out.trim().split('\n')[0] || null;
        return c;
      } catch { current = null; }
    }
    return null;
  }

  /* minSec/maxSec acotan la duración (p. ej. episodios de podcast: de 5 min a 4 h). */
  /* baja: true = adorno (banners); ver MAX_BAJA. */
  async function search(query, max = 10, { minSec = MIN_SEC, maxSec = MAX_SEC, baja = false } = {}) {
    const out = await run([`ytsearch${max}:${query}`, '--flat-playlist', '--print-json', '--no-warnings', '--socket-timeout', '6'], undefined, { baja });
    const items = [];
    for (const l of out.split('\n')) {
      if (!l.trim().startsWith('{')) continue;
      let v;
      try { v = JSON.parse(l); } catch { continue; }
      const id = v.id;
      if (typeof id !== 'string' || !VIDEO_ID.test(id)) continue;
      const d = v.duration;
      if (typeof d !== 'number' || d < minSec || d > maxSec) continue;
      const title = (v.title || '').trim();
      if (!title || NOISE.test(title)) continue;
      items.push({ id, title, channel: v.channel || v.uploader || '', duration: d });
    }
    return items;
  }

  function resolve(id, mode = 'audio', { baja = false } = {}) {
    if (typeof id !== 'string' || !VIDEO_ID.test(id)) return Promise.reject(new Error('ID inválido'));
    if (!FORMATS[mode]) return Promise.reject(new Error('Modo inválido (audio|video)'));
    const key = `${id}|${mode}`;
    const hit = cache.get(key);
    if (hit && hit.expires > now()) return Promise.resolve({ url: hit.url, duration: hit.duration });
    if (inflight.has(key)) {
      const f = inflight.get(key);
      if (!baja) subir(f.ficha); /* lo pide alguien de verdad: si esperaba como adorno, ya no espera detrás de otros adornos */
      return f.p;
    }

    const ficha = { baja };
    const p = run(['--no-playlist', '-f', FORMATS[mode], '--print', 'duration', '--print', 'urls',
      '--no-warnings', '--socket-timeout', '8', `https://www.youtube.com/watch?v=${id}`], undefined, { ficha })
      .then((out) => {
        const lines = out.split('\n').map((s) => s.trim()).filter(Boolean);
        const url = lines.find((s) => s.startsWith('http'));
        if (!url) throw new Error('yt-dlp: sin URL en la salida');
        const d = Number(lines[0]);
        const res = { url, duration: Number.isFinite(d) && lines[0] !== url ? d : null };
        const ttl = ttlFromUrl(url, MAX_URL_TTL, now());
        if (ttl > 0) {
          if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
          cache.set(key, { ...res, expires: now() + ttl });
        }
        return res;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, { p, ficha });
    return p;
  }

  function invalidate(id) {
    for (const mode of Object.keys(FORMATS)) cache.delete(`${id}|${mode}`);
  }

  /* ¿Ya está resuelta (y vigente) la URL de esta pista? Sin lanzar nada. */
  const isResolved = (id, mode = 'audio') => { const h = cache.get(`${id}|${mode}`); return !!h && h.expires > now(); };

  return { detect, search, resolve, invalidate, isResolved, version: () => versionStr, isReady: () => !!current };
}

module.exports = { createYtdlp, ttlFromUrl, VIDEO_ID };
