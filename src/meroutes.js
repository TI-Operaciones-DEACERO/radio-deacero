'use strict';
/* meroutes.js — /api/me/*: la biblioteca de LA cuenta que hace la petición (Me gusta, playlists, historial, gustos, preferencias).
 * El id de la cuenta viene de la sesión (policy.js ya exigió el nivel `usuario`); nunca se lee de la petición. */
const { jsonBody } = require('./http');
const { createLimiter } = require('./ratelimit');

const PLAYLIST = /^\/api\/me\/playlists\/([a-f0-9]{8})$/;
const PLAYLIST_TRACKS = /^\/api\/me\/playlists\/([a-f0-9]{8})\/tracks$/;
const PLAYLIST_TRACK = /^\/api\/me\/playlists\/([a-f0-9]{8})\/tracks\/([A-Za-z0-9_-]{11})$/;

function createMeRoutes({ library, json, bodyLimit = 4096, max = 120, windowMs = 60 * 1000 }) {
  /* Cada escritura reescribe el archivo de la cuenta: se limita POR CUENTA (leer no cuesta). */
  const writes = createLimiter({ max, windowMs });
  const noContent = (res) => { res.writeHead(204); res.end(); };
  const notFound = (res) => json(res, 404, { error: 'NO_EXISTE' });
  const bad = (res) => json(res, 400, { error: 'DATOS_INVALIDOS' });

  async function handle(req, res, url, user) {
    const p = url.pathname;
    const m = req.method;
    const uid = user.id;
    let x;
    if (m !== 'GET') {
      const w = writes.hit(uid);
      if (!w.ok) return json(res, 429, { error: 'DEMASIADAS_PETICIONES' }, { 'retry-after': String(w.retryAfter) });
    }

    if (p === '/api/me/reactions') {
      if (m === 'GET') return json(res, 200, library.reactions(uid));
      const b = await jsonBody(req, res, json, bodyLimit);
      if (!b) return undefined;
      if (!('r' in b)) return bad(res);
      return library.react(uid, b.track, b.r).ok ? json(res, 200, { ok: true }) : bad(res);
    }
    if (p === '/api/me/reactions/merge') {
      const b = await jsonBody(req, res, json, MERGE_LIMIT);
      return b ? json(res, 200, library.merge(uid, b.items)) : undefined;
    }

    if (p === '/api/me/playlists') {
      if (m === 'GET') return json(res, 200, library.playlists(uid));
      const b = await jsonBody(req, res, json, bodyLimit);
      if (!b) return undefined;
      const r = library.createPlaylist(uid, b.name);
      return r.ok ? json(res, 201, { playlist: r.playlist }) : bad(res);
    }
    if ((x = PLAYLIST.exec(p))) {
      if (m === 'GET') { const pl = library.playlist(uid, x[1]); return pl ? json(res, 200, pl) : notFound(res); }
      if (m === 'DELETE') return library.deletePlaylist(uid, x[1]) ? noContent(res) : notFound(res);
      if (!library.playlist(uid, x[1])) return notFound(res);
      const b = await jsonBody(req, res, json, bodyLimit);
      if (!b) return undefined;
      const r = library.renamePlaylist(uid, x[1], b.name);
      return r.ok ? json(res, 200, { playlist: r.playlist }) : bad(res);
    }
    if ((x = PLAYLIST_TRACKS.exec(p))) {
      if (!library.playlist(uid, x[1])) return notFound(res);
      const b = await jsonBody(req, res, json, bodyLimit);
      if (!b) return undefined;
      const r = library.addTrack(uid, x[1], b.track);
      return r.ok ? json(res, 200, { ok: true, existed: !!r.existed }) : bad(res);
    }
    if ((x = PLAYLIST_TRACK.exec(p))) return library.removeTrack(uid, x[1], x[2]) ? noContent(res) : notFound(res);

    if (p === '/api/me/history') {
      if (m === 'GET') return json(res, 200, library.history(uid, Math.min(200, Math.max(1, Number.parseInt(url.searchParams.get('limit'), 10) || 100))));
      if (m === 'DELETE') { library.clearHistory(uid); return noContent(res); }
      const b = await jsonBody(req, res, json, bodyLimit);
      if (!b) return undefined;
      return library.pushHistory(uid, b.track).ok ? json(res, 200, { ok: true }) : bad(res);
    }

    if (p === '/api/me/taste') return json(res, 200, library.taste(uid));

    if (p === '/api/me/prefs') {
      if (m === 'GET') return json(res, 200, library.prefs(uid));
      const b = await jsonBody(req, res, json, bodyLimit);
      if (!b) return undefined;
      return library.setPrefs(uid, b).ok ? json(res, 200, library.prefs(uid)) : bad(res);
    }
    return json(res, 404, { error: 'Endpoint no encontrado' });
  }

  return { handle };
}

/* La fusión trae hasta 500 canciones (≈ 300 B cada una) */
const MERGE_LIMIT = 131072;

module.exports = { createMeRoutes, MERGE_LIMIT };
