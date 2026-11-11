'use strict';
/* server.js — HTTP sin dependencias: API + estáticos. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { validateCommand, searchGenres } = require('./control');
const { describeAgent, cleanIp, cleanUser } = require('./clients');
const { readBody, sameOrigin, hostAllowed, ipKey } = require('./http');
const policy = require('./policy');
const { createAuthRoutes } = require('./authroutes');
const { createLimiter } = require('./ratelimit');
const { createMeRoutes } = require('./meroutes');
const { createIaRoutes } = require('./iaroutes');
const { createBienestarRoutes } = require('./bienestarroutes');
const { createAdminRoutes } = require('./adminroutes');

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg',
  '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon'
};

/* nosniff: el navegador no adivina tipos; SAMEORIGIN: solo este mismo sitio puede enmarcar páginas (el panel nuevo enmarca /panel). */
const SEC_HEADERS = { 'x-content-type-options': 'nosniff', 'x-frame-options': 'SAMEORIGIN' };
/* El panel nuevo solo carga recursos de este mismo sitio (defensa en profundidad contra XSS). */
const PANEL_CSP = "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'";

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

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

function createServer({ publicDir, genres, ytdlp, radio, proxy, thumbs, muestras, emisoras, popularidad, lyrics, control, clients, history, podcasts, episodes, timesync, users, sessions, library, ia, programa, anuncios, ajustes, diag, onGenero, token = '', entradaSecreto = '', relojEntrada = null, claveMax = 15, muestraArtistaMax = 20, trustLoopback = true, panelOpen = true, cookieSecure = false, panelV2 = false, panelPrincipal = 'simple', hostsPermitidos = [], loginMax, iaMax, iaGeminiMax, meMax, nextMax = 60, bienestarMax, now = Date.now }) {
  const anotar = (servicio, nivel, msg) => { if (diag) diag.add(servicio, nivel, msg); };
  const permite = (t) => (ajustes ? ajustes.permite(t) : true);
  const admin = createAdminRoutes({
    programa, anuncios, ajustes, diag, json: (...a) => json(...a),
    sistema: () => ({
      uptime: Math.round(process.uptime()),
      ytdlp: ytdlp && ytdlp.version ? ytdlp.version() || null : null,
      relojSincronizado: timesync ? !!timesync.info().synced : false,
      gemini: ia && ia.gemini ? ia.gemini() : { enabled: false },
      pantallas: control ? control.getScreens().length : 0,
      sesionesRadio: radio && radio.sessionCount ? radio.sessionCount() : 0,
      cuentas: users && users.list ? users.list().length : 0
    })
  });
  /* Campos que ya salían + los nuevos (desc, mood, energy) solo si el género los trae. Las consultas de búsqueda nunca salen. */
  const publicList = genres.map(({ id, label, emoji, color, featured, desc, mood, energy }) => ({ id, label, emoji, color, featured: !!featured, ...(desc !== undefined ? { desc } : {}), ...(mood !== undefined ? { mood } : {}), ...(energy !== undefined ? { energy } : {}) }));
  const bienestar = radio && radio.startViaje ? createBienestarRoutes({ radio, genres, library, json: (...a) => json(...a), ...(bienestarMax ? { max: bienestarMax } : {}) }) : null;
  const iaApi = ia ? createIaRoutes({ ia, library, clock: () => (timesync ? timesync.current() : Date.now()), json: (...a) => json(...a), ...(iaMax ? { max: iaMax } : {}), ...(iaGeminiMax ? { geminiMax: iaGeminiMax } : {}) }) : null;
  const nextLimiter = createLimiter({ max: nextMax, windowMs: 60 * 1000 }); /* cada /api/next puede lanzar búsquedas en yt-dlp */
  const muestraLimiter = createLimiter({ max: 4 * nextMax, windowMs: 60 * 1000 }); /* los banners de GÉNERO piden muchas (con caché y de pocas en pocas en el servidor) */
  const muestraArtistaLimiter = createLimiter({ max: muestraArtistaMax, windowMs: 60 * 1000 }); /* cada artista NUEVO es una búsqueda de yt-dlp: cupo corto, como /api/buscar */
  const claveLimiter = createLimiter({ max: claveMax, windowMs: 15 * 60 * 1000 }); /* intentos de clave MALOS por IP */
  const me = library ? createMeRoutes({ library, json: (...a) => json(...a), ...(meMax ? { max: meMax } : {}) }) : null;
  const auth = users && sessions ? createAuthRoutes({ users, sessions, library, json: (...a) => json(...a), cookieSecure, now, entradaSecreto, relojEntrada, ...(loginMax ? { loginMax } : {}) }) : null;
  const root = path.resolve(publicDir);

  const json = (res, code, body, extra = {}) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...SEC_HEADERS, ...(code === 413 ? { connection: 'close' } : {}), ...extra });
    res.end(JSON.stringify(body));
  };

  function serveStatic(pathname, res) {
    if (pathname === '/remote') pathname = '/remote.html'; /* control remoto */
    const completo = panelV2 && panelPrincipal === 'completo';
    if (panelV2 && (pathname === '/panel/completo' || pathname === '/panel/completo/')) pathname = '/panel-completo.html'; /* panel completo (PANEL_V2) */
    else if (completo && (pathname === '/panel' || pathname === '/panel/')) pathname = '/panel-completo.html'; /* Fase 8: /panel ES el panel completo */
    /* El panel de siempre: reproduce en este navegador (remote.js lo decide por la ruta). Con el cambio de la Fase 8 vive en /panel/simple. */
    if (pathname === '/panel' || pathname === '/panel/' || pathname === '/panel/simple' || pathname === '/panel/simple/') pathname = '/remote.html';
    if (pathname === '/admin' || pathname === '/admin/') pathname = '/admin.html'; /* Administración: página aparte, pide la clave de /remote */
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
        'cache-control': 'no-cache',
        ...SEC_HEADERS,
        ...(['panel-completo.html', 'admin.html'].includes(path.basename(file)) ? { 'content-security-policy': PANEL_CSP } : {})
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

  /* Adivinar la clave: solo cuentan los intentos MALOS con una clave puesta (sin clave no se gasta nada). Pasado el tope la IP recibe 429, aun con la buena,
   * hasta que acabe la ventana. → segundos de espera si está bloqueada, o 0. */
  function topeClave(req, url, buena) {
    if (!token || !(req.headers['x-token'] || url.searchParams.get('t'))) return 0;
    const k = ipKey(req.socket.remoteAddress);
    const p = claveLimiter.peek(k);
    if (!p.ok) return p.retryAfter;
    if (!buena) claveLimiter.hit(k);
    return 0;
  }

  /* Administración de cuentas: sin REMOTE_TOKEN NO se abre a la red (el resto de rutas sí, como siempre); solo la propia máquina. */
  function adminAuthorized(req, url) {
    if (token) return authorized(req, url);
    return trustLoopback && LOOPBACK.has(req.socket.remoteAddress);
  }

  /* /panel (oyente que escucha en su propio navegador) NO pide clave. Qué rutas son de oyente lo dice policy.js (nivel `oyente`):
   * ver géneros, oír, carátulas, buscar/leer podcasts y /api/next CON id de sesión (su racha es suya y no toca la de las pantallas).
   * Nada que mande órdenes a pantallas (/api/cmd, /api/events, /api/state) ni que muestre equipos (/api/clients, /api/history).
   * panelOpen=false (PANEL_PUBLICO=0) lo vuelve a cerrar todo. */
  function isListenerRequest(req, url, route) {
    if (!panelOpen) return false; /* el método ya lo fijó la tabla de rutas */
    if (route.needs === 'sid') return SESSION_ID.test(url.searchParams.get('sid') || '');
    return true;
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
    const account = auth ? auth.currentUser(req) : null;
    if (p.startsWith('/api/bienestar/')) return bienestar ? bienestar.handle(req, res, url, account) : json(res, 503, { error: 'BIENESTAR_NO_DISPONIBLE' });
    if (p.startsWith('/api/ia/')) return iaApi ? iaApi.handle(req, res, url, account) : json(res, 404, { error: 'Endpoint no encontrado' });
    if (p.startsWith('/api/me/')) return me && account ? me.handle(req, res, url, account) : json(res, 404, { error: 'Endpoint no encontrado' });
    const at = Number(req.headers['x-client-time']);
    if (isControlPath(p) && !(p === '/api/state' && req.method === 'POST')) clients.touch({ ip: req.socket.remoteAddress, ua, user });
    /* Historial de búsquedas: quién, desde dónde y cuándo (hora del cliente: la de la Pi puede estar atrasada). */
    const record = (kind, text) => history.add({ kind, text, user, ip: req.socket.remoteAddress, at });

    const deCuentas = p.startsWith('/api/auth/') || p.startsWith('/api/admin/usuarios');
    if (auth && deCuentas) return auth.handle(req, res, url, account);
    if (deCuentas) return json(res, 404, { error: 'Endpoint no encontrado' });
    if (p.startsWith('/api/admin/') || p.startsWith('/api/anuncio/')) return admin.handle(req, res, url);

    if (p === '/api/buscar') {
      const text = (q.get('q') || '').trim().slice(0, 100);
      if (!text) return json(res, 400, { error: 'FALTA_Q' });
      if (!q.has('sid')) record('song', text); /* las del oyente (con sid, sin clave) no entran al historial: lo podrían desplazar */
      let found;
      try { found = await ytdlp.search(text, 12); }
      catch (e) { anotar('yt-dlp', 'error', 'búsqueda: ' + (e && e.message)); return json(res, 503, { error: 'SIN_CONEXION' }); }
      return json(res, 200, (found || []).filter((t) => t && VIDEO_ID.test(t.id) && permite(t)).slice(0, 10)
        .map((t) => ({ id: t.id, title: String(t.title || ''), channel: String(t.channel || ''), duration: Number(t.duration) || 0 })));
    }
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
        const semilla = (q.get('semilla') || '').trim().slice(0, 100);
        if (semilla) opts.semilla = semilla; /* «más como esto»: artista de la canción elegida */
        if (q.has('sid')) opts.session = q.get('sid'); /* sin sid: la sesión principal (las pantallas) */
        else if (programa) { const sel = programa.seleccion(); if (sel.generos.length) opts.onlyGenres = sel.generos; } /* horario: SOLO las pantallas */
        const evitar = account && library ? library.avoidGenres(account.id) : [];
        if (evitar.length) opts.avoidGenres = evitar; /* con cuenta: lo que no le gusta no sale en su rotación */
        const r = await radio.next(opts);
        ytdlp.resolve(r.track.id, 'audio').catch(() => {}); /* precalienta: el cliente lo pide enseguida */
        if (popularidad) { try { popularidad.registrar({ channel: r.track.channel, genre: r.genre && r.genre.id }); } catch (_) { /* solo estadística */ } }
        if (onGenero && r.genre && genreIds.has(r.genre.id)) { try { onGenero(r.genre.id); } catch (_) { /* solo es un aviso */ } }
        return json(res, 200, r);
      } catch (e) {
        if (e.code === 'UNKNOWN_GENRE') return json(res, 400, { error: e.code });
        if (e.code === 'STALE') return json(res, 409, { error: e.code }); /* precarga superada por lo que la persona pidió: normal */
        if (e.code === 'NO_SOURCE') { anotar('radio', 'aviso', e.message); return json(res, 503, { error: e.code }); }
        anotar('radio', 'error', e && e.message);
        return json(res, 500, { error: 'INTERNAL' });
      }
    }

    let m = /^\/api\/play\/([^/]+)$/.exec(p);
    if (m) {
      const mode = q.get('mode') || 'audio';
      if (!VIDEO_ID.test(m[1]) || !['audio', 'video'].includes(mode)) return json(res, 400, { error: 'Parámetros inválidos' });
      return proxy.handle(req, res, m[1], mode);
    }

    /* Radio en vivo (lista curada en data/seed/emisoras.json; el servidor hace de proxy del flujo) */
    if (p === '/api/emisoras') return emisoras ? json(res, 200, { emisoras: emisoras.list() }) : json(res, 404, { error: 'Endpoint no encontrado' });
    m = /^\/api\/emisora\/([a-z0-9-]{1,40})$/.exec(p);
    if (m) return emisoras ? emisoras.escuchar(m[1], req, res) : json(res, 404, { error: 'Endpoint no encontrado' });

    m = /^\/api\/thumb\/([^/]+)$/.exec(p);
    if (m) {
      const t = VIDEO_ID.test(m[1]) ? await thumbs.get(m[1]) : null;
      if (!t) return json(res, 404, { error: 'Sin carátula' });
      res.writeHead(200, { 'content-type': t.type, 'content-length': t.body.length, 'cache-control': 'public, max-age=86400' });
      return res.end(t.body);
    }

    /* Muestra del banner de un género (?g=id) o de un artista (?a=texto, con sesión: lanza una búsqueda). La respuesta es solo { id, title, duration }:
     * el navegador pide la carátula y el miniclip a /api/thumb y /api/play como siempre. */
    if (p === '/api/muestra') {
      if (!muestras) return json(res, 404, { error: 'Endpoint no encontrado' });
      const g = q.get('g'), a = q.get('a');
      let r = null;
      if (g !== null) {
        if (!/^[A-Za-z0-9_-]{1,40}$/.test(g)) return json(res, 400, { error: 'GENERO' });
        r = genreIds.has(g) ? await muestras.genero(g) : null;
      } else if (a !== null) {
        const texto = a.trim();
        if (!texto || a.length > 100) return json(res, 400, { error: 'ARTISTA' });
        if (!SESSION_ID.test(q.get('sid') || '') && !authorized(req, url)) return json(res, 401, { error: 'UNAUTHORIZED' });
        const lim = muestraArtistaLimiter.hit(ipKey(req.socket.remoteAddress));
        if (!lim.ok) return json(res, 429, { error: 'DEMASIADAS_PETICIONES' }, { 'retry-after': String(lim.retryAfter) });
        r = await muestras.artista(texto);
      } else return json(res, 400, { error: 'FALTA_G_O_A' });
      return r ? json(res, 200, r) : json(res, 404, { error: 'SIN_MUESTRA' });
    }

    if (p === '/api/lyrics') {
      /* Abierta al oyente: con tope de largo (salen a lrclib / lyrics.ovh y son la llave de la caché). */
      const title = (q.get('title') || '').trim().slice(0, 200);
      if (!title) return json(res, 400, { error: 'Falta title' });
      const r = await lyrics.get({ title, channel: (q.get('channel') || '').slice(0, 200), duration: Number(q.get('duration')) || 0 });
      return r ? json(res, 200, r) : json(res, 404, { error: 'Sin letra' });
    }

    return json(res, 404, { error: 'Endpoint no encontrado' });
  }

  return http.createServer((req, res) => {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { return json(res, 400, { error: 'URL inválida' }); }
    const fail = (e) => { anotar('servidor', 'error', `${req.method} ${url.pathname}: ${e && e.message}`); if (!res.headersSent) json(res, 500, { error: 'INTERNAL' }); else res.destroy(); };
    if (url.pathname === '/entrar') { /* otro sistema manda a la persona a la radio con la sesión iniciada (ver authroutes.js) */
      if (!auth) return json(res, 404, { error: 'No encontrado' });
      if (req.method !== 'GET') return json(res, 405, { error: 'Método no permitido' });
      if (!hostAllowed(req.headers.host, hostsPermitidos)) return json(res, 421, { error: 'HOST' });
      try { return auth.entrarPorUrl(req, res, url); } catch (e) { return fail(e); }
    }
    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET') return json(res, 405, { error: 'Método no permitido' });
      return Promise.resolve(serveStatic(url.pathname, res)).catch(fail);
    }
    /* Desde la propia máquina solo se acepta Host propio (si no, una página de otro sitio podría usar la confianza de loopback: DNS rebinding). */
    if (url.pathname !== '/api/health' && LOOPBACK.has(req.socket.remoteAddress) && !hostAllowed(req.headers.host, hostsPermitidos)) return json(res, 421, { error: 'HOST' });
    const route = policy.resolve(req.method, url.pathname);
    if (!route) {
      /* Existe pero con otro método → 405; lo que no existe: 405 si no es GET, y si es GET pide clave antes de decir 404. */
      if (req.method !== 'GET' || policy.pathExists(url.pathname)) return json(res, 405, { error: 'Método no permitido' });
      /* Bajo /api/admin/ manda la regla de administración (sin REMOTE_TOKEN, solo la propia máquina). Y lo no declarado NO llega a
       * ningún manejador (algunos atienden por prefijo): se responde 404 aquí mismo. */
      const topeA = topeClave(req, url, url.pathname.startsWith('/api/admin/') ? adminAuthorized(req, url) : authorized(req, url));
      if (topeA) return json(res, 429, { error: 'DEMASIADOS_INTENTOS' }, { 'retry-after': String(topeA) });
      if (!(url.pathname.startsWith('/api/admin/') ? adminAuthorized(req, url) : authorized(req, url))) return json(res, 401, { error: 'UNAUTHORIZED' });
      return json(res, 404, { error: 'Endpoint no encontrado' });
    }
    if (/^\/api\/(auth|admin)\//.test(url.pathname) && !hostAllowed(req.headers.host, hostsPermitidos)) return json(res, 421, { error: 'HOST' });
    if (req.method !== 'GET' && !sameOrigin(req)) return json(res, 403, { error: 'ORIGIN' });
    if (route.level === 'oyente' && !isListenerRequest(req, url, route) && !authorized(req, url)) return json(res, 401, { error: 'UNAUTHORIZED' });
    if (route.level === 'clave') {
      const buena = url.pathname.startsWith('/api/admin/') ? adminAuthorized(req, url) : authorized(req, url);
      const tope = topeClave(req, url, buena);
      if (tope) return json(res, 429, { error: 'DEMASIADOS_INTENTOS' }, { 'retry-after': String(tope) });
      if (!buena) return json(res, 401, { error: 'UNAUTHORIZED' });
    }
    if (route.level === 'usuario' && !(auth && auth.currentUser(req))) return json(res, 401, { error: 'NO_SESSION' });
    if (url.pathname === '/api/next' || url.pathname === '/api/podcast/search' || url.pathname === '/api/buscar' || url.pathname === '/api/lyrics') {
      const lim = nextLimiter.hit(ipKey(req.socket.remoteAddress));
      if (!lim.ok) return json(res, 429, { error: 'DEMASIADAS_PETICIONES' }, { 'retry-after': String(lim.retryAfter) });
    }
    if (url.pathname === '/api/muestra') {
      const lim = muestraLimiter.hit(ipKey(req.socket.remoteAddress));
      if (!lim.ok) return json(res, 429, { error: 'DEMASIADAS_PETICIONES' }, { 'retry-after': String(lim.retryAfter) });
    }
    return api(req, res, url).catch(fail);
  });
}

module.exports = { createServer };
