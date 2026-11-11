/* biblioteca-local.js — historial y playlists SIN nómina: se guardan en este navegador (localStorage) con la misma forma de respuesta que
   la cuenta ({ ok, status, data }), así las vistas funcionan igual con o sin sesión. Los Me gusta locales ya los lleva nucleo.js.
   Mismas reglas que src/library.js (id de YouTube válido, textos recortados, topes). Si el almacenamiento falla o tiene basura, se empieza vacío. */
(function (root) {
  'use strict';
  const K_HIST = 'pl_local_historial', K_PL = 'pl_local_playlists';
  const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
  const GENRE_ID = /^[A-Za-z0-9_-]{1,40}$/;
  const texto = (x, n) => (typeof x === 'string' ? x.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').slice(0, n) : '');
  function limpiar(x) {
    if (!x || typeof x !== 'object' || typeof x.id !== 'string' || !VIDEO_ID.test(x.id)) return null;
    const t = { id: x.id, title: texto(x.title, 300), channel: texto(x.channel, 200), duration: Number.isFinite(x.duration) ? Math.min(1e5, Math.max(0, x.duration)) : 0 };
    if (typeof x.genre === 'string' && GENRE_ID.test(x.genre)) t.genre = x.genre;
    return t;
  }
  const ok = (data, status) => Promise.resolve({ ok: true, status: status || 200, data });
  const mal = (status) => Promise.resolve({ ok: false, status, data: null });

  function createBibliotecaLocal(o) {
    const store = o.store, now = o.now || Date.now;
    const maxHistorial = o.maxHistorial || 200, maxPlaylists = o.maxPlaylists || 50, maxCanciones = o.maxCanciones || 200;
    const rnd = o.rnd || (() => { const a = new Uint8Array(4); (root.crypto || globalThis.crypto).getRandomValues(a); return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(''); });
    const leer = (k) => { try { const v = JSON.parse(store.get(k) || '[]'); return Array.isArray(v) ? v : []; } catch (_) { return []; } };
    const escribir = (k, v) => { try { if (v.length) store.set(k, JSON.stringify(v)); else store.del(k); } catch (_) { /* almacenamiento lleno o bloqueado */ } };
    const vista = (p) => ({ id: p.id, name: p.name, created: p.created, count: p.tracks.length });
    const pls = () => leer(K_PL).filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string' && Array.isArray(p.tracks));
    const nombre = (n) => texto(n, 60).replace(/\s+/g, ' ').trim();

    return {
      historial(limit) {
        const h = leer(K_HIST).filter((x) => x && x.track && limpiar(x.track));
        return ok(h.slice(0, Math.min(200, limit || 100)).map((x) => ({ at: x.at, track: limpiar(x.track) })));
      },
      registrarHistorial(track) {
        const t = limpiar(track);
        if (!t) return mal(400);
        const h = leer(K_HIST);
        if (h[0] && h[0].track && h[0].track.id === t.id) return ok({ ok: true, repeated: true });
        h.unshift({ track: t, at: now() });
        escribir(K_HIST, h.slice(0, maxHistorial));
        return ok({ ok: true });
      },
      borrarHistorial() { escribir(K_HIST, []); return ok({ ok: true }); },
      playlists() { return ok(pls().map(vista)); },
      playlist(id) { const p = pls().find((x) => x.id === id); return p ? ok({ ...vista(p), tracks: p.tracks.map((t) => ({ ...t })) }) : mal(404); },
      crearPlaylist(name) {
        const n = nombre(name), todas = pls();
        if (!n || todas.length >= maxPlaylists) return mal(400);
        const p = { id: rnd(), name: n, created: now(), tracks: [] };
        todas.push(p);
        escribir(K_PL, todas);
        return ok({ playlist: { ...vista(p), tracks: [] } }, 201);
      },
      renombrarPlaylist(id, name) {
        const n = nombre(name), todas = pls(), p = todas.find((x) => x.id === id);
        if (!p) return mal(404);
        if (!n) return mal(400);
        p.name = n;
        escribir(K_PL, todas);
        return ok({ playlist: vista(p) });
      },
      borrarPlaylist(id) {
        const todas = pls();
        if (!todas.some((x) => x.id === id)) return mal(404);
        escribir(K_PL, todas.filter((x) => x.id !== id));
        return ok({ ok: true });
      },
      agregarAPlaylist(id, track) {
        const t = limpiar(track), todas = pls(), p = todas.find((x) => x.id === id);
        if (!p) return mal(404);
        if (!t) return mal(400);
        if (p.tracks.some((x) => x.id === t.id)) return ok({ ok: true, existed: true });
        if (p.tracks.length >= maxCanciones) return mal(400);
        p.tracks.push(t);
        escribir(K_PL, todas);
        return ok({ ok: true, existed: false });
      },
      quitarDePlaylist(id, trackId) {
        const todas = pls(), p = todas.find((x) => x.id === id);
        if (!p || !p.tracks.some((x) => x.id === trackId)) return mal(404);
        p.tracks = p.tracks.filter((x) => x.id !== trackId);
        escribir(K_PL, todas);
        return ok({ ok: true });
      }
    };
  }

  const api = { createBibliotecaLocal };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PlayBibliotecaLocal = api;
})(typeof window !== 'undefined' ? window : globalThis);
