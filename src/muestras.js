'use strict';
/* muestras.js — una canción de MUESTRA por género o artista: su carátula y un miniclip de unos segundos adornan el banner en vez de un emoji.
 * Con caché y de pocas en pocas: cada artista nuevo es una búsqueda de yt-dlp (en la Pi es lenta), así que no se lanzan en tropel. */

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const SONG_MAX_SEC = 15 * 60;

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const pub = (t) => ({ id: t.id, title: String(t.title || '').slice(0, 200), duration: Number(t.duration) > 0 ? Number(t.duration) : 0 });

function createMuestras({ radio, search, filtro = () => true, now = Date.now, ttlMs = 6 * 3600 * 1000, ttlFalloMs = 5 * 60 * 1000, max = 300, simultaneas = 2, maxEspera = 10 }) {
  const cache = new Map();    /* clave → { v (muestra o null), hasta } */
  const vuelo = new Map();    /* clave → promesa (peticiones iguales comparten trabajo) */
  let activas = 0;
  const espera = [];

  /* false = no hay lugar (la cola está llena): se responde «sin muestra» SIN guardarlo en la caché, para no saturar yt-dlp ni marcar como fallida una que sí existe */
  const turno = () => new Promise((resolve) => { if (activas < simultaneas) { activas++; resolve(true); } else if (espera.length >= maxEspera) resolve(false); else espera.push(() => resolve(true)); });
  const libera = () => { const sig = espera.shift(); if (sig) sig(); else activas--; };

  async function con(clave, calcular) {
    const hit = cache.get(clave);
    if (hit && hit.hasta > now()) return hit.v;
    if (vuelo.has(clave)) return vuelo.get(clave);
    const p = (async () => {
      if (!(await turno())) return null;
      let v = null;
      try { v = await calcular(); } catch (_) { v = null; } finally { libera(); }
      cache.delete(clave);
      cache.set(clave, { v, hasta: now() + (v ? ttlMs : ttlFalloMs) });
      while (cache.size > max) cache.delete(cache.keys().next().value);
      return v;
    })().finally(() => vuelo.delete(clave));
    vuelo.set(clave, p);
    return p;
  }

  const genero = (id) => con('g:' + id, async () => {
    const t = radio && radio.muestra ? await radio.muestra(id) : null;
    return t && VIDEO_ID.test(t.id) ? pub(t) : null;
  });

  const artista = (q) => {
    const texto = String(q || '').trim().replace(/\s+/g, ' ').slice(0, 100);
    if (!texto) return Promise.resolve(null);
    return con('a:' + norm(texto), async () => {
      const lista = await search(texto + ' official music video', 5);
      const t = (lista || []).find((x) => x && VIDEO_ID.test(x.id) && !(x.duration > SONG_MAX_SEC) && filtro(x));
      return t ? pub(t) : null;
    });
  };

  return { genero, artista, size: () => cache.size };
}

module.exports = { createMuestras };
