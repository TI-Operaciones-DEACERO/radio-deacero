'use strict';
/* radio.js — el "bot": decide qué suena y cuándo cambia de género.
 *
 * Cada 4–6 canciones salta a un género al azar (sin repetir los últimos 3).
 * Un género pedido a mano también dura una racha de 4–6 y luego vuelve la rotación sola.
 * Las canciones salen de buscar una consulta al azar del género y se guardan en
 * un pool para no buscar en cada pista. Una sola instancia = un solo oyente. */

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
  probe = async () => true, probeTries = 3, probeTriesRacha = 6, badTtlMs = 30 * 60 * 1000, now = Date.now
}) {
  const byId = new Map(genres.map((g) => [g.id, g]));
  const randomPool = genres.some((g) => g.featured) ? genres.filter((g) => g.featured) : genres;
  const pools = new Map();   /* genreId → canciones aún sin tocar */
  const recent = new Set();  /* ids ya servidos (orden de inserción) */
  const lastGenres = [];
  const bad = new Map();     /* id → hasta cuándo se evita (no se pudo reproducir) */
  let genre = null;
  let left = 0;
  let locked = false; /* la racha actual la pidió el usuario: si no hay música de ese género avisa en vez de saltar a otro */
  let chain = Promise.resolve();

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

  function remember(id) {
    recent.add(id);
    if (recent.size > recentCap) recent.delete(recent.values().next().value);
  }

  function randomGenre(exclude = []) {
    const skip = new Set([...lastGenres.slice(-avoidLastGenres), ...exclude]);
    const cands = randomPool.filter((g) => !skip.has(g.id));
    return pick(cands.length ? cands : randomPool.filter((g) => !exclude.includes(g.id)));
  }

  /* allowRepeat: un género pedido a mano puede agotar sus canciones nuevas; entonces
   * se repiten las antiguas en vez de fallar. */
  async function takeTrack(g, allowRepeat = false) {
    const fresh = (list) => list.filter((t) => !isBad(t.id) && (allowRepeat || !recent.has(t.id)));
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
  async function nextInner(opts = {}) {
    const snap = { genre, left, locked };
    try { return await pickNext(opts); }
    catch (e) {
      if (opts.genre || opts.change) ({ genre, left, locked } = snap);
      throw e;
    }
  }

  /* Búsqueda explícita (control remoto): una pauta ÚNICA. Toca el primer resultado nuevo y la
   * lista sigue como iba (mismo género, misma racha, mismo candado): Jazz → [búsqueda] → Jazz. */
  async function pickQuery(q) {
    let found = [];
    try { found = await search(q, 8); } catch { /* sin resultados */ }
    const fresh = found.filter((t) => !recent.has(t.id) && !isBad(t.id));
    const ordered = [...fresh.filter((t) => !(t.duration > SONG_MAX_SEC)), ...fresh.filter((t) => t.duration > SONG_MAX_SEC)];
    let track = null;
    for (const t of ordered.slice(0, probeTries)) { if (await playable(t)) { track = t; break; } }
    if (!track) throw err('NO_SOURCE', ordered.length ? `Ningún resultado de "${q}" se pudo reproducir` : `Sin resultados para "${q}"`);
    remember(track.id);
    return { track, genre: { id: 'search', label: `Búsqueda: ${q}`, emoji: '🔎', color: '#F59B23' }, genreChanged: true, genreLeft: null };
  }

  async function pickNext({ genre: wanted, change, query }) {
    if (query) return pickQuery(query);
    let switched = false;
    if (wanted) {
      const g = byId.get(wanted);
      if (!g) throw err('UNKNOWN_GENRE', `Género desconocido: ${wanted}`);
      if (!locked || genre !== g) switched = true;
      genre = g; locked = true; left = between(perGenre); switched = true; /* racha nueva, como las automáticas */
    } else if (change) {
      locked = false; genre = null;
    }
    if (!genre || left <= 0) { locked = false; genre = randomGenre(); left = between(perGenre); switched = true; }

    const tried = [];
    for (;;) {
      const track = (await takeTrack(genre)) || (locked ? await takeTrack(genre, true) : null);
      if (track) {
        if (switched) { lastGenres.push(genre.id); if (lastGenres.length > 20) lastGenres.shift(); }
        remember(track.id);
        /* Una mezcla de horas cuenta como la "racha" completa del género. */
        left = track.duration > SONG_MAX_SEC ? 0 : left - 1;
        return { track, genre: pub(genre), genreChanged: switched, genreLeft: Math.max(left, 0) };
      }
      /* Un género pedido por el usuario no salta solo a otro: se avisa. */
      if (locked) throw err('NO_SOURCE', `Sin resultados para ${genre.label}`);
      tried.push(genre.id);
      if (tried.length >= 3) throw err('NO_SOURCE', 'Ningún género devolvió canciones');
      genre = randomGenre(tried); left = between(perGenre); switched = true;
    }
  }

  /* Serializa: el cliente precarga y puede pedir dos a la vez. */
  function next(opts) {
    const run = chain.then(() => nextInner(opts));
    chain = run.catch(() => {});
    return run;
  }

  return { next };
}

module.exports = { createRadio };
