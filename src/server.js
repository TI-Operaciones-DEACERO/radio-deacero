'use strict';
/* server.js — HTTP sin dependencias: API + estáticos. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { validateCommand, searchGenres } = require('./control');
const { describeAgent, cleanIp, cleanUser } = require('./clients');

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg',
  '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon'
};

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const BODY_LIMIT = 4096;

const num = (x, min, max) => (Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : undefined);
const str = (x, n) => (typeof x === 'string' ? x.slice(0, n) : undefined);

/* Solo se guardan los campos conocidos de lo que reporta la pantalla. */
function sanitizeState(b) {
  b = b && typeof b === 'object' ? b : {};
  const t = b.track && typeof b.track === 'object' ? b.track : null;
  const g = b.genre && typeof b.genre === 'object' ? b.genre : null;
  return {
    paused: typeof b.paused === 'boolean' ? b.paused : undefined,
    muted: typeof b.muted === 'boolean' ? b.muted : undefined,
    volume: num(b.volume, 0, 100),
    time: num(b.time, 0, 1e5),
    mode: b.mode === 'video' || b.mode === 'audio' ? b.mode : undefined,
    track: t ? { id: VIDEO_ID.test(t.id) ? t.id : undefined, title: str(t.title, 300), channel: str(t.channel, 200), duration: num(t.duration, 0, 1e5) } : undefined,
    genre: g ? { id: str(g.id, 40), label: str(g.label, 80), emoji: str(g.emoji, 8), color: str(g.color, 20) } : undefined
  };
}

function readBody(req, limit = BODY_LIMIT) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let tooBig = false;
    req.on('data', (c) => {
      size += c.length;
      if (tooBig) return; /* se descarta el resto; el 413 sale ya y la conexión se cierra */
      if (size > limit) { tooBig = true; reject(Object.assign(new Error('Cuerpo demasiado grande'), { status: 413 })); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/* token: si se define, los clientes remotos deben presentarlo (header x-token o ?t=).
 * La propia Pi (loopback) no lo necesita. trustLoopback=false solo para pruebas. */
/* Direcciones IPv4 del servidor (para saber a dónde conectarse cuando cambia la IP). */
function localIps() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
  }
  return out;
}

/* Id de sesión de un oyente independiente (/panel): lo inventa el navegador. */
const SESSION_ID = /^[A-Za-z0-9_-]{8,40}$/;

function createServer({ publicDir, genres, ytdlp, radio, proxy, thumbs, lyrics, control, clients, history, podcasts, episodes, timesync, token = '', trustLoopback = true, panelOpen = true }) {
  const publicList = genres.map(({ id, label, emoji, color, featured }) => ({ id, label, emoji, color, featured: !!featured }));
  const root = path.resolve(publicDir);

  const json = (res, code, body, extra = {}) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...(code === 413 ? { connection: 'close' } : {}), ...extra });
    res.end(JSON.stringify(body));
  };

  function serveStatic(pathname, res) {
    if (pathname === '/remote') pathname = '/remote.html'; /* control remoto */
    if (pathname === '/panel' || pathname === '/panel/') pathname = '/remote.html'; /* mismo panel, pero reproduce en este navegador (remote.js lo decide por la ruta) */
    if (pathname === '/kiosco' || pathname === '/kiosco/') pathname = '/index.html'; /* misma página; la vista la elige app.js por la ruta */
    let rel;
    try { rel = decodeURIComponent(pathname); } catch { return json(res, 400, { error: 'URL inválida' }); }
    if (rel.includes('\0') || rel.includes('\\')) return json(res, 400, { error: 'URL inválida' });
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(root, '.' + rel);
    if (file !== root && !file.startsWith(root + path.sep)) return json(res, 403, { error: 'Prohibido' });
    fs.stat(file, (e, st) => {
      if (e || !st.isFile()) return json(res, 404, { error: 'No encontrado' });
      res.writeHead(200, {
        'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'content-length': st.size,
        'cache-control': 'no-cache'
      });
      fs.createReadStream(file).pipe(res);
    });
  }

  function authorized(req, url) {
    if (!token) return true;
    if (trustLoopback && LOOPBACK.has(req.socket.remoteAddress)) return true;
    const given = req.headers['x-token'] || url.searchParams.get('t') || '';
    return safeEqual(given, token);
  }

  /* /panel (oyente que escucha en su propio navegador) NO pide clave. Solo se abre lo que ese oyente necesita:
   * ver géneros, oír, carátulas, buscar/leer podcasts y /api/next CON id de sesión (su racha es suya y no toca la de las pantallas).
   * Nada que mande órdenes a pantallas (/api/cmd, /api/events, /api/state) ni que muestre equipos (/api/clients, /api/history).
   * panelOpen=false (PANEL_PUBLICO=0) lo vuelve a cerrar todo. */
  function isListenerRequest(req, url) {
    if (!panelOpen || req.method !== 'GET') return false;
    const p = url.pathname;
    if (p === '/api/genres' || p === '/api/podcast/search' || p === '/api/podcasts') return true;
    if (p === '/api/next') return SESSION_ID.test(url.searchParams.get('sid') || '');
    return /^\/api\/(play|thumb)\/[^/]+$/.test(p);
  }

  const genreIds = new Set(genres.map((g) => g.id));

  /* Rutas que usa quien CONTROLA (web /remote, comando play); la propia pantalla usa otras. */
  const isControlPath = (p) => p === '/api/state' || p === '/api/cmd' || p === '/api/search' || p === '/api/clients'
    || p === '/api/podcasts' || p.startsWith('/api/podcasts/') || p === '/api/podcast/search' || p === '/api/history';

  async function api(req, res, url) {
    const p = url.pathname;
    const q = url.searchParams;
    const ua = req.headers['user-agent'];
    const user = cleanUser(req.headers['x-user']);
    const at = Number(req.headers['x-client-time']);
    if (isControlPath(p) && !(p === '/api/state' && req.method === 'POST')) clients.touch({ ip: req.socket.remoteAddress, ua, user });
    /* Historial de búsquedas: quién, desde dónde y cuándo (hora del cliente: la de la Pi puede estar atrasada). */
    const record = (kind, text) => history.add({ kind, text, user, ip: req.socket.remoteAddress, at });

    if (p === '/api/health') return json(res, 200, { ok: true, ytdlp: ytdlp.version(), uptime: Math.round(process.uptime()), ips: localIps() });
    if (p === '/api/genres') return json(res, 200, publicList);
    if (p === '/api/time') { const i = timesync.info(); return json(res, 200, { now: timesync.current(), offset: i.offset, synced: i.synced }); }
    if (p === '/api/search') return json(res, 200, searchGenres(genres, q.get('q') || ''));

    if (p === '/api/events') return control.subscribe(res, { ip: cleanIp(req.socket.remoteAddress), agent: describeAgent(ua) });

    if (p === '/api/clients') {
      const ip = cleanIp(req.socket.remoteAddress);
      const t = Date.now();
      /* Una pantalla local ES la de la Pi (Chromium oculta que es ARM y la marca como "PC Linux"). */
      const screenAgent = (s) => {
        if (!LOOPBACK.has(s.ip)) return s.agent;
        const m = /\(([^)]+)\)$/.exec(s.agent);
        return 'Pantalla de la Pi' + (m ? ` (${m[1]})` : '');
      };
      const screens = await Promise.all(control.getScreens().map(async (s) => ({
        ip: s.ip, host: await clients.resolveHost(s.ip), agent: screenAgent(s), seconds: Math.max(0, Math.floor((t - s.since) / 1000))
      })));
      return json(res, 200, { screens, controllers: await clients.list(), you: { ip, host: await clients.resolveHost(ip), agent: describeAgent(ua), user } });
    }

    if (p === '/api/history') {
      if (req.method === 'DELETE') { history.clear(); res.writeHead(204); return res.end(); }
      const limit = Math.min(200, Math.max(1, Number.parseInt(q.get('limit'), 10) || 100));
      const items = await Promise.all(history.list(limit).map(async (e) => ({ ...e, host: e.ip ? await clients.resolveHost(e.ip) : null })));
      return json(res, 200, items);
    }

    if (p === '/api/podcasts') {
      if (req.method === 'GET') return json(res, 200, podcasts.list());
      let body;
      try { body = JSON.parse(await readBody(req)); }
      catch (e) { return json(res, e.status || 400, { error: e.status ? 'Cuerpo demasiado grande' : 'JSON inválido' }); }
      const r = podcasts.add(body);
      if (!r.ok) return json(res, 400, { error: r.error });
      return json(res, r.existed ? 200 : 201, r.item);
    }

    const pm = /^\/api\/podcasts\/([a-z0-9]+)$/.exec(p);
    if (pm) {
      if (req.method !== 'DELETE') return json(res, 405, { error: 'Método no permitido' });
      if (!podcasts.remove(pm[1])) return json(res, 404, { error: 'No existe' });
      res.writeHead(204); return res.end();
    }

    if (p === '/api/podcast/search') {
      const text = (q.get('q') || '').trim().slice(0, 100);
      if (!text) return json(res, 400, { error: 'Falta q' });
      record('podcast', text);
      try { return json(res, 200, await episodes(text, 15)); }
      catch (_) { return json(res, 503, { error: 'SIN_CONEXION' }); }
    }

    if (p === '/api/state') {
      if (req.method === 'GET') return json(res, 200, control.getState());
      let body;
      try { body = JSON.parse(await readBody(req) || '{}'); }
      catch (e) { return json(res, e.status || 400, { error: e.status ? 'Cuerpo demasiado grande' : 'JSON inválido' }); }
      control.setState(sanitizeState(body));
      res.writeHead(204); return res.end();
    }

    if (p === '/api/cmd') {
      let body;
      try { body = JSON.parse(await readBody(req)); }
      catch (e) { return json(res, e.status || 400, { error: e.status ? 'Cuerpo demasiado grande' : 'JSON inválido' }); }
      const v = validateCommand(body, genreIds);
      if (!v.ok) return json(res, 400, { error: v.error });
      clients.touch({ ip: req.socket.remoteAddress, ua, user, cmd: v.cmd.cmd });
      const c = v.cmd;
      if (c.cmd === 'search') record('song', c.q);
      else if (c.cmd === 'track') record(c.kind === 'podcast' ? 'episode' : 'song', c.track.title);
      else if (c.cmd === 'genre') record('genre', (genres.find((g) => g.id === c.id) || {}).label || c.id);
      const delivered = control.send(v.cmd);
      return delivered ? json(res, 200, { ok: true, delivered }) : json(res, 409, { error: 'NO_PLAYER' });
    }

    if (p === '/api/next') {
      if (q.has('sid') && !SESSION_ID.test(q.get('sid'))) return json(res, 400, { error: 'BAD_SESSION' });
      try {
        const opts = { genre: q.get('genre') || undefined, change: q.get('change') === '1', query: (q.get('q') || '').trim().slice(0, 100) || undefined };
        if (q.has('sid')) opts.session = q.get('sid'); /* sin sid: la sesión principal (las pantallas) */
        const r = await radio.next(opts);
        ytdlp.resolve(r.track.id, 'audio').catch(() => {}); /* precalienta: el cliente lo pide enseguida */
        return json(res, 200, r);
      } catch (e) {
        if (e.code === 'UNKNOWN_GENRE') return json(res, 400, { error: e.code });
        if (e.code === 'NO_SOURCE') return json(res, 503, { error: e.code });
        return json(res, 500, { error: 'INTERNAL' });
      }
    }

    let m = /^\/api\/play\/([^/]+)$/.exec(p);
    if (m) {
      const mode = q.get('mode') || 'audio';
      if (!VIDEO_ID.test(m[1]) || !['audio', 'video'].includes(mode)) return json(res, 400, { error: 'Parámetros inválidos' });
      return proxy.handle(req, res, m[1], mode);
    }

    m = /^\/api\/thumb\/([^/]+)$/.exec(p);
    if (m) {
      const t = VIDEO_ID.test(m[1]) ? await thumbs.get(m[1]) : null;
      if (!t) return json(res, 404, { error: 'Sin carátula' });
      res.writeHead(200, { 'content-type': t.type, 'content-length': t.body.length, 'cache-control': 'public, max-age=86400' });
      return res.end(t.body);
    }

    if (p === '/api/lyrics') {
      const title = (q.get('title') || '').trim();
      if (!title) return json(res, 400, { error: 'Falta title' });
      const r = await lyrics.get({ title, channel: q.get('channel') || '', duration: Number(q.get('duration')) || 0 });
      return r ? json(res, 200, r) : json(res, 404, { error: 'Sin letra' });
    }

    return json(res, 404, { error: 'Endpoint no encontrado' });
  }

  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const isApi = url.pathname.startsWith('/api/');
    const postOk = req.method === 'POST' && ['/api/cmd', '/api/state', '/api/podcasts'].includes(url.pathname);
    const delOk = req.method === 'DELETE' && (url.pathname.startsWith('/api/podcasts/') || url.pathname === '/api/history');
    if (req.method !== 'GET' && !postOk && !delOk) return json(res, 405, { error: 'Método no permitido' });
    if (isApi && url.pathname !== '/api/health' && !isListenerRequest(req, url) && !authorized(req, url)) return json(res, 401, { error: 'UNAUTHORIZED' });
    const run = isApi ? api(req, res, url) : Promise.resolve(serveStatic(url.pathname, res));
    run.catch(() => { if (!res.headersSent) json(res, 500, { error: 'INTERNAL' }); else res.destroy(); });
  });
}

module.exports = { createServer };
