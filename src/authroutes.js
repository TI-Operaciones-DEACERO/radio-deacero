'use strict';
/* authroutes.js — /api/auth/* (entrar con nómina, salir, mi cuenta) y /api/admin/usuarios.
 * El nivel de acceso de cada ruta lo decide policy.js; aquí solo se atiende lo que ya pasó esa puerta. */
const crypto = require('node:crypto');
const { readBody, parseCookies, ipKey } = require('./http');
const { createLimiter } = require('./ratelimit');

const COOKIE = 'pl_user';
const ADMIN_ID = /^\/api\/admin\/usuarios\/([a-f0-9]{8,32})$/;

const publicUser = (u) => ({ id: u.id, nombre: u.nombre, nomina: u.nomina });

function createAuthRoutes({ users, sessions, library, json, bodyLimit = 4096, cookieSecure = false, loginMax = 20, loginWindowMs = 15 * 60 * 1000, now = Date.now, relojEntrada = null, entradaSecreto = '', entradaVentanaMs = 5 * 60 * 1000 }) {
  const limiter = createLimiter({ max: loginMax, windowMs: loginWindowMs, now });
  const writes = createLimiter({ max: loginMax * 3, windowMs: loginWindowMs, now }); /* perfil, salir y borrar: cada uno escribe en disco */
  const maxAge = Math.floor(sessions.ttlMs / 1000);
  const setCookie = (token) => `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${cookieSecure ? '; Secure' : ''}`;
  const clearCookie = `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${cookieSecure ? '; Secure' : ''}`;

  const tokenOf = (req) => parseCookies(req.headers.cookie)[COOKIE];

  /* La cuenta de esta petición, o null. Una cuenta desactivada o borrada deja de valer aunque su sesión no haya caducado. */
  function currentUser(req) {
    const uid = sessions.verify(tokenOf(req));
    const u = uid && users.get(uid);
    return u && u.estado === 'activo' ? publicUser(u) : null;
  }

  async function body(req, res) {
    const hasBody = Number(req.headers['content-length']) > 0 || req.headers['transfer-encoding'] !== undefined;
    if (hasBody && !/^application\/json\b/i.test(req.headers['content-type'] || '')) {
      json(res, 415, { error: 'UNSUPPORTED_MEDIA_TYPE' });
      return undefined;
    }
    try {
      const v = JSON.parse((await readBody(req, bodyLimit)) || '{}');
      if (v && typeof v === 'object' && !Array.isArray(v)) return v;
    } catch (e) {
      if (e.status === 413) { json(res, 413, { error: 'Cuerpo demasiado grande' }); return undefined; }
    }
    json(res, 400, { error: 'JSON inválido' });
    return undefined;
  }

  /* Nómina no permitida y cuenta desactivada responden IGUAL: no se debe poder saber qué nóminas existen. */
  const LOGIN_ERRORS = { NOMINA_INVALIDA: [400, 'NOMINA_INVALIDA'], NO_AUTORIZADA: [403, 'ACCESO_DENEGADO'], DESACTIVADA: [403, 'ACCESO_DENEGADO'], LLENO: [503, 'LLENO'] };

  async function login(req, res) {
    const lim = limiter.hit(ipKey(req.socket.remoteAddress));
    if (!lim.ok) return json(res, 429, { error: 'DEMASIADOS_INTENTOS' }, { 'retry-after': String(lim.retryAfter) });
    const b = await body(req, res);
    if (!b) return undefined;
    const r = users.entrar(b.nomina, b.nombre);
    if (!r.ok) { const [code, error] = LOGIN_ERRORS[r.error] || [400, r.error]; return json(res, code, { error }); }
    sessions.destroy(tokenOf(req)); /* se cambia el token al entrar */
    const token = sessions.create(r.user.id);
    return json(res, 200, { user: publicUser(r.user), nuevo: r.nuevo }, { 'set-cookie': setCookie(token) });
  }

  /* GET /entrar?nomina=…&nombre=…[&ts=…&firma=…] — para que OTRO sistema mande a la persona a la radio ya con la sesión iniciada.
   * Abre la sesión, pone la cookie y redirige a /panel SIN dejar la nómina ni el nombre en la dirección. Cualquier fallo (nómina inválida, no permitida,
   * cuenta desactivada, firma mala o vencida) responde igual: /panel?entrada=no, sin pistas de qué nóminas existen.
   * Con ENTRADA_SECRETO el enlace debe venir firmado: firma = HMAC-SHA256 hex de «nómina|nombre|ts» y ts (segundos o milisegundos) dentro de ±5 min.
   * Sin secreto se acepta como el login normal (que tampoco tiene contraseña); entonces cualquier página podría iniciar la sesión de otra persona
   * en este navegador, por eso se recomienda firmar. */
  const baseEntrada = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' };
  function firmaValida(q, nomina, nombre) {
    const tsRaw = q.get('ts') || '', firma = (q.get('firma') || '').toLowerCase();
    const ts = Number(tsRaw);
    if (!/^\d{1,15}$/.test(tsRaw) || !Number.isFinite(ts) || !/^[0-9a-f]{64}$/.test(firma)) return false;
    if (Math.abs((relojEntrada || now)() - (ts < 1e12 ? ts * 1000 : ts)) > entradaVentanaMs) return false;
    const esperada = crypto.createHmac('sha256', entradaSecreto).update(nomina + '|' + nombre + '|' + tsRaw).digest();
    return crypto.timingSafeEqual(esperada, Buffer.from(firma, 'hex'));
  }
  function entrarPorUrl(req, res, url) {
    const lim = limiter.hit(ipKey(req.socket.remoteAddress));
    if (!lim.ok) return json(res, 429, { error: 'DEMASIADOS_INTENTOS' }, { 'retry-after': String(lim.retryAfter) });
    const q = url.searchParams;
    const nomina = q.get('nomina') || '', nombre = q.get('nombre') || '';
    const fallo = () => { res.writeHead(302, { ...baseEntrada, location: '/panel?entrada=no' }); res.end(); };
    if (!nomina || (entradaSecreto && !firmaValida(q, nomina, nombre))) return fallo();
    /* Sin firma, el enlace solo puede venir de una navegación de la persona (no de <img>, <iframe>, fetch…) y no renombra cuentas existentes. */
    const destino = req.headers['sec-fetch-dest'];
    if (!entradaSecreto && destino && destino !== 'document') return fallo();
    const r = users.entrar(nomina, nombre, { soloNombreNuevo: !entradaSecreto });
    if (!r.ok) return fallo();
    sessions.destroy(tokenOf(req));
    res.writeHead(302, { ...baseEntrada, location: '/panel', 'set-cookie': setCookie(sessions.create(r.user.id)) });
    return res.end();
  }

  async function handleAuth(req, res, p, user) {
    if (p === '/api/auth/login') return login(req, res);
    if (p === '/api/auth/me') return json(res, 200, { user });
    const w = writes.hit(ipKey(req.socket.remoteAddress));
    if (!w.ok) return json(res, 429, { error: 'DEMASIADOS_INTENTOS' }, { 'retry-after': String(w.retryAfter) });
    if (p === '/api/auth/logout') {
      sessions.destroy(tokenOf(req));
      return json(res, 200, { ok: true }, { 'set-cookie': clearCookie });
    }
    if (p === '/api/auth/profile') {
      const b = await body(req, res);
      if (!b) return undefined;
      const u = users.rename(user.id, b.nombre);
      return u ? json(res, 200, { user: publicUser(u) }) : json(res, 404, { error: 'NO_EXISTE' });
    }
    if (p === '/api/auth/export') {
      const data = users.export(user.id);
      if (!data) return json(res, 404, { error: 'NO_EXISTE' });
      return json(res, 200, library ? { ...data, datos: library.exportAll(user.id) } : data, { 'content-disposition': 'attachment; filename="mis-datos-play.json"' });
    }
    /* Las cuentas NO se pueden borrar desde la app (decisión del producto): no hay ruta para ello. Solo el administrador las desactiva. */
    return json(res, 404, { error: 'Endpoint no encontrado' });
  }

  async function handleAdmin(req, res, p) {
    if (p === '/api/admin/usuarios') return json(res, 200, users.list());
    const m = ADMIN_ID.exec(p);
    if (!m) return json(res, 404, { error: 'Endpoint no encontrado' });
    if (req.method === 'DELETE') {
      if (!users.remove(m[1])) return json(res, 404, { error: 'NO_EXISTE' });
      sessions.destroyUser(m[1]);
      res.writeHead(204);
      return res.end();
    }
    const b = await body(req, res);
    if (!b) return undefined;
    if (b.estado !== 'activo' && b.estado !== 'desactivado') return json(res, 400, { error: 'ESTADO_INVALIDO' });
    const u = users.setEstado(m[1], b.estado);
    if (!u) return json(res, 404, { error: 'NO_EXISTE' });
    if (b.estado === 'desactivado') sessions.destroyUser(m[1]);
    return json(res, 200, u);
  }

  function handle(req, res, url, user) {
    const p = url.pathname;
    return p.startsWith('/api/admin/') ? handleAdmin(req, res, p) : handleAuth(req, res, p, user);
  }

  return { currentUser, handle, entrarPorUrl };
}

module.exports = { createAuthRoutes };
