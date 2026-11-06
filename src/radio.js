'use strict';
/* radio.js — el "bot": decide qué suena y cuándo cambia de género.
 *
 * Cada 4–6 canciones salta a un género al azar (sin repetir los últimos 3).
 * Un género pedido a mano también dura una racha de 4–6 y luego vuelve la rotación sola.
 * Las canciones salen de buscar una consulta al azar del género y se guardan en
 * un pool para no buscar en cada pista.
 *
 * Sesiones: cada oyente independiente (p. ej. /panel) manda su id y lleva SU racha (género, canciones que
 * le quedan, últimas canciones). Sin id se usa la sesión principal, la de las pantallas (/ y /kiosco).
 * Se comparten solo las cachés: el pool de resultados de yt-dlp y la lista de pistas que no se pudieron reproducir. */

const { firma, generosContinuacion } = require('./bienestar');

const err = (code, msg) => Object.assign(new Error(msg || code), { code });

/* Hasta esta duración es "una canción"; más largo es una mezcla (solo se usa si no hay otra cosa). */
const SONG_MAX_SEC = 15 * 60;
const SEARCH_ATTEMPTS = 2; /* cada búsqueda de yt-dlp tarda varios segundos: no gastar de más */

function createRadio({
  genres, search, rng = Math.random,
  perGenre = [4, 6], avoidLastGenres = 3, recentCap = 400, poolSize = 15,
  /* probe(id) → ¿se puede reproducir? Se comprueba ANTES de ofrecer la canción: hasta probeTries en una búsqueda (alguien espera)
   * y probeTriesRacha en la rotación (se prepara por adelantado: si la mitad de las pistas fallan, 6 intentos casi nunca se agotan).
   * Las que fallan se evitan badTtlMs (después se reintentan: puede haberse corregido la red o el reloj). */
  probe = async () => true, probeTries = 3, probeTriesRacha = 6, badTtlMs = 30 * 60 * 1000, now = Date.now,
  /* Sesiones de oyentes independientes: caducan sin actividad y hay un tope (se descartan las más antiguas). */
  sessionTtlMs = 2 * 60 * 60 * 1000, maxSessions = 100,
  /* filtro(track) → ¿se puede ofrecer? (ajustes: contenido explícito por palabras del título). Aplica a todas las sesiones. */
  filtro = () => true
}) {
  const byId = new Map(genres.map((g) => [g.id, g]));
  const randomPool = genres.some((g) => g.featured) ? genres.filter((g) => g.featured) : genres;
  const pools = new Map();   /* genreId → canciones aún sin tocar */
  const bad = new Map();     /* id → hasta cuándo se evita (no se pudo reproducir) */

  /* Estado de UN oyente. recent = ids ya servidos (orden de inserción). locked = la racha actual la pidió el usuario:
   * si no hay música de ese género avisa en vez de saltar a otro. chain serializa sus peticiones (el cliente precarga y pide dos a la vez). */
  const newSession = () => ({ genre: null, left: 0, locked: false, avoid: new Set(), only: null, viaje: null, firmas: new Set(), lastGenres: [], recent: new Set(), chain: Promise.resolve(), seen: now() });
  const main = newSession();
  const sessions = new Map(); /* id → estado */

  function sessionFor(id) {
    if (!id) return main;
    const t = now();
    for (const [k, v] of sessions) if (t - v.seen > sessionTtlMs) sessions.delete(k);
    let s = sessions.get(id);
    if (!s) {
      s = newSession();
      sessions.set(id, s);
      while (sessions.size > maxSessions) {
        let oldest = null;
        for (const [k, v] of sessions) if (k !== id && (oldest === null || v.seen < sessions.get(oldest).seen)) oldest = k;
        if (oldest === null) break;
        sessions.delete(oldest);
      }
    }
    s.seen = t;
    return s;
  }

  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const between = ([a, b]) => a + Math.floor(rng() * (b - a + 1));
  const pub = (g) => ({ id: g.id, label: g.label, emoji: g.emoji, color: g.color });

  const isBad = (id) => {
    const until = bad.get(id);
    if (until === undefined) return false;
    if (until <= now()) { bad.delete(id); return false; }
    return true;
  };
  async function playable(track) {
    if (await probe(track.id)) return true;
    bad.set(track.id, now() + badTtlMs);
    if (bad.size > 500) bad.delete(bad.keys().next().value);
    return false;
  }

  function remember(s, id, title) {
    if (s.viaje && title) { s.firmas.add(firma(title)); while (s.firmas.size > 400) s.firmas.delete(s.firmas.values().next().value); }
    s.recent.add(id);
    if (s.recent.size > recentCap) s.recent.delete(s.recent.values().next().value);
  }

  function randomGenre(s, exclude = []) {
    const skip = new Set([...s.lastGenres.slice(-avoidLastGenres), ...exclude]);
    /* Con horario, la rotación sale SOLO de los géneros del bloque (si se agotan, se repiten antes que salir del bloque). */
    const base = s.only ? [...s.only].map((id) => byId.get(id)) : randomPool;
    /* Orden de preferencia: ni reciente ni rechazado → rechazado nunca (aunque se repita uno reciente) → reciente permitido → lo que sea. */
    const ok = (g) => !s.avoid.has(g.id);
    let cands = base.filter((g) => !skip.has(g.id) && ok(g));
    if (!cands.length) cands = base.filter((g) => !exclude.includes(g.id) && ok(g));
    if (!cands.length) cands = base.filter((g) => !skip.has(g.id));
    if (!cands.length) cands = base.filter((g) => !exclude.includes(g.id));
    return pick(cands.length ? cands : randomPool.filter((g) => !exclude.includes(g.id)));
  }

  /* allowRepeat: un género pedido a mano puede agotar sus canciones nuevas; entonces
   * se repiten las antiguas en vez de fallar. */
  async function takeTrack(s, g, allowRepeat = false) {
    /* En un viaje de Bienestar tampoco se repite la "misma" canción con otro sufijo (En vivo, Remaster...): se compara la firma del título. */
    const repetida = (t) => s.recent.has(t.id) || (s.viaje && s.firmas.has(firma(t.title)));
    const fresh = (list) => list.filter((t) => !isBad(t.id) && filtro(t) && (allowRepeat || !repetida(t)));
    let pool = fresh(pools.get(g.id) || []);
    for (let attempt = 0; !pool.length && attempt < SEARCH_ATTEMPTS; attempt++) {
      try {
        pool = fresh(await search(pick(g.queries), poolSize));
      } catch { /* siguiente intento con otra consulta */ }
    }
    if (!pool.length) { pools.set(g.id, []); return null; }
    const songs = pool.filter((t) => !(t.duration > SONG_MAX_SEC));
    if (songs.length) pool = songs;
    let track = null;
    for (let tries = 0; tries < probeTriesRacha && pool.length; tries++) {
      const [t] = pool.splice(Math.floor(rng() * pool.length), 1);
      if (await playable(t)) { track = t; break; }
    }
    pools.set(g.id, pool);
    return track;
  }

  /* Si pedir un género/cambio falla, el radio vuelve al estado anterior (la
   * pantalla sigue con lo que suena y el servidor no queda "fijado" en vano). */
  async function nextInner(s, opts = {}) {
    const snap = { genre: s.genre, left: s.left, locked: s.locked };
    s.avoid = new Set(Array.isArray(opts.avoidGenres) ? opts.avoidGenres : []); /* géneros que esta sesión prefiere evitar */
    const only = Array.isArray(opts.onlyGenres) ? opts.onlyGenres.filter((id) => byId.has(id)) : [];
    s.only = only.length ? new Set(only) : null; /* horario de las pantallas: solo estos géneros */
    try { return await pickNext(s, opts); }
    catch (e) {
      if (opts.genre || opts.change) Object.assign(s, snap);
      throw e;
    }
  }

  /* Búsqueda explícita (control remoto): una pauta ÚNICA. Toca el primer resultado nuevo y la
   * lista sigue como iba (mismo género, misma racha, mismo candado): Jazz → [búsqueda] → Jazz. */
  async function pickQuery(s, q) {
    let found = [];
    try { found = await search(q, 8); } catch { /* sin resultados */ }
    const fresh = found.filter((t) => !s.recent.has(t.id) && !isBad(t.id) && filtro(t));
    const ordered = [...fresh.filter((t) => !(t.duration > SONG_MAX_SEC)), ...fresh.filter((t) => t.duration > SONG_MAX_SEC)];
    let track = null;
    for (const t of ordered.slice(0, probeTries)) { if (await playable(t)) { track = t; break; } }
    if (!track) throw err('NO_SOURCE', ordered.length ? `Ningún resultado de "${q}" se pudo reproducir` : `Sin resultados para "${q}"`);
    remember(s, track.id);
    return { track, genre: { id: 'search', label: `Búsqueda: ${q}`, emoji: '🔎', color: '#F59B23' }, genreChanged: true, genreLeft: null };
  }

  async function pickNext(s, { genre: wanted, change, query }) {
    if (query) return pickQuery(s, query);
    let switched = false;
    if (wanted) {
      const g = byId.get(wanted);
      if (!g) throw err('UNKNOWN_GENRE', `Género desconocido: ${wanted}`);
      s.viaje = null; /* el usuario eligió: se termina el viaje */
      s.genre = g; s.locked = true; s.left = between(perGenre); switched = true; /* racha nueva, como las automáticas */
    } else if (change) {
      s.locked = false; s.genre = null;
    }
    if (s.viaje) return pickViaje(s);
    if (s.only && s.genre && !s.locked && !s.only.has(s.genre.id)) s.left = 0; /* empezó otro bloque del horario: se cambia ya */
    if (!s.genre || s.left <= 0) { s.locked = false; s.genre = randomGenre(s); s.left = between(perGenre); switched = true; }

    const tried = [];
    for (;;) {
      const track = (await takeTrack(s, s.genre)) || (s.locked ? await takeTrack(s, s.genre, true) : null);
      if (track) {
        if (switched) { s.lastGenres.push(s.genre.id); if (s.lastGenres.length > 20) s.lastGenres.shift(); }
        remember(s, track.id, track.title);
        /* Una mezcla de horas cuenta como la "racha" completa del género. */
        s.left = track.duration > SONG_MAX_SEC ? 0 : s.left - 1;
        return { track, genre: pub(s.genre), genreChanged: switched, genreLeft: Math.max(s.left, 0) };
      }
      /* Un género pedido por el usuario no salta solo a otro: se avisa. */
      if (s.locked) throw err('NO_SOURCE', `Sin resultados para ${s.genre.label}`);
      tried.push(s.genre.id);
      if (tried.length >= 3) throw err('NO_SOURCE', 'Ningún género devolvió canciones');
      s.genre = randomGenre(s, tried); s.left = between(perGenre); switched = true;
    }
  }

  /* — Viaje de Bienestar: la sesión sigue las fases del plan; al terminar CONTINÚA en la energía final (nunca silencio) — */
  async function pickViaje(s) {
    const v = s.viaje;
    const last = v.plan.fases.length - 1;
    const fase = v.continuando ? last : v.fase;
    const f = v.plan.fases[fase];
    const cands = v.continuando ? v.cont : f.generos.map((g) => byId.get(g.id)).filter(Boolean);
    const start = v.rot++;
    let track = null, g = null;
    for (const repetir of [false, true]) {
      for (let i = 0; i < cands.length && !track; i++) {
        g = cands[(start + i) % cands.length];
        track = await takeTrack(s, g, repetir);
      }
      if (track) break;
    }
    if (!track) throw err('NO_SOURCE', 'Ningún género del viaje devolvió canciones');
    remember(s, track.id, track.title);
    v.n++;
    const info = { fase: fase + 1, tema: v.continuando ? v.n - v.plan.fases.length * v.plan.temasPorFase : v.tema + 1, porFase: v.plan.temasPorFase, continuando: v.continuando, energia: f.energia, nombre: f.nombre };
    if (!v.continuando) {
      v.tema++;
      if (v.tema >= v.plan.temasPorFase) { v.fase++; v.tema = 0; if (v.fase > last) v.continuando = true; }
    }
    return { track, genre: pub(g), genreChanged: true, genreLeft: null, viaje: info };
  }

  const validPlan = (p) => p && Array.isArray(p.fases) && p.fases.length > 0 && Number.isInteger(p.temasPorFase) && p.temasPorFase > 0 && p.fases.every((f) => f && Array.isArray(f.generos) && f.generos.length);

  /* Solo para oyentes con sesión propia: nunca toca la sesión principal (las pantallas). */
  function startViaje(id, plan, taste) {
    if (!id || typeof id !== 'string') throw err('BAD_SESSION', 'Hace falta la sesión del oyente');
    if (!validPlan(plan)) throw err('BAD_PLAN', 'Plan de viaje inválido');
    const s = sessionFor(id);
    s.viaje = { plan, fase: 0, tema: 0, continuando: false, rot: 0, n: 0, cont: generosContinuacion(plan, genres, taste).filter((g) => byId.has(g.id)).map((g) => byId.get(g.id)) };
    s.firmas = new Set();
    s.genre = null; s.locked = false; s.left = 0;
    return true;
  }
  function stopViaje(id) {
    const s = id ? sessions.get(id) : null;
    if (!s || !s.viaje) return false;
    s.viaje = null;
    s.genre = null; s.left = 0; /* vuelve la rotación aleatoria */
    return true;
  }
  const viajeInfo = (id) => { const s = id ? sessions.get(id) : null; return s && s.viaje ? { fase: s.viaje.continuando ? s.viaje.plan.fases.length : s.viaje.fase + 1, continuando: s.viaje.continuando } : null; };

  /* Serializa las peticiones de cada sesión; sesiones distintas no se esperan entre sí.
   * opts.session = id del oyente independiente (sin él, la sesión principal). */
  function next(opts) {
    const s = sessionFor(opts && opts.session);
    const run = s.chain.then(() => nextInner(s, opts));
    s.chain = run.catch(() => {});
    return run;
  }

  return { next, startViaje, stopViaje, viajeInfo, sessionCount: () => sessions.size };
}

module.exports = { createRadio };
