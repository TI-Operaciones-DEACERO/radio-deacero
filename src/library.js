'use strict';
/* library.js — lo que guarda cada cuenta: Me gusta / No me gusta, playlists, historial y preferencias.
 * Un archivo por cuenta (DATA_DIR/users/<id>.json): se lee y escribe pequeño, y exportar o borrar una cuenta es copiar o borrar un archivo.
 * El id de la cuenta sale SIEMPRE de la sesión, nunca de la petición: no hay forma de pedir los datos de otra persona. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { readJson, writeJson } = require('./jsonfile');

const UID = /^[a-f0-9]{16}$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const GENRE_ID = /^[A-Za-z0-9_-]{1,40}$/;
const PREF_KEYS = ['bienestar', 'tema', 'ia'];
const LIMITS = { reactions: 2000, history: 500, playlists: 50, playlistTracks: 200, merge: 500, prefValue: 2000 };

const text = (x, n) => (typeof x === 'string' ? x.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '').slice(0, n) : '');

/* Solo los campos conocidos de una canción, con tope; null si no es una canción válida. */
function cleanTrack(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x) || typeof x.id !== 'string' || !VIDEO_ID.test(x.id)) return null;
  const t = { id: x.id, title: text(x.title, 300), channel: text(x.channel, 200), duration: Number.isFinite(x.duration) ? Math.min(1e5, Math.max(0, x.duration)) : 0 };
  if (typeof x.genre === 'string' && GENRE_ID.test(x.genre)) t.genre = x.genre;
  return t;
}

/* El id de una canción puede ser "constructor" (11 letras): nunca se consulta con `in`, que mira también lo heredado. */
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

const empty = () => ({ reactions: {}, playlists: [], history: [], prefs: {} });

function createLibrary({ dir, now = Date.now, limits = LIMITS }) {
  const cache = new Map(); /* uid → { sig, d } */
  const fileOf = (uid) => path.join(dir, 'users', uid + '.json');

  /* Lee la cuenta (de la caché si el archivo no cambió). Sin archivo = cuenta vacía, sin crear nada. */
  function load(uid) {
    if (typeof uid !== 'string' || !UID.test(uid)) return null;
    let sig = null;
    try { const st = fs.statSync(fileOf(uid)); sig = st.mtimeMs + ':' + st.size; } catch (_) { cache.delete(uid); return empty(); }
    const c = cache.get(uid);
    if (c && c.sig === sig) return c.d;
    const raw = readJson(fileOf(uid), null);
    const d = { ...empty(), ...(raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) };
    if (!d.reactions || typeof d.reactions !== 'object' || Array.isArray(d.reactions)) d.reactions = {};
    for (const k of ['playlists', 'history']) if (!Array.isArray(d[k])) d[k] = [];
    if (!d.prefs || typeof d.prefs !== 'object' || Array.isArray(d.prefs)) d.prefs = {};
    cache.set(uid, { sig, d });
    return d;
  }

  function save(uid, d) {
    try { writeJson(fileOf(uid), d, 0o600, 0); } catch (_) { /* sigue en memoria mientras el disco falle */ }
    try { const st = fs.statSync(fileOf(uid)); cache.set(uid, { sig: st.mtimeMs + ':' + st.size, d }); } catch (_) { cache.set(uid, { sig: null, d }); }
  }

  /* — Me gusta / No me gusta — */
  /* Más reciente primero; con la misma hora, la que se puso después. */
  const sortedReactions = (d) => Object.values(d.reactions).map((x, i) => [x, i]).sort((a, b) => b[0].at - a[0].at || b[1] - a[1]).map(([x]) => x);
  const reactions = (uid) => { const d = load(uid); return d ? sortedReactions(d).map((x) => ({ r: x.r, at: x.at, track: { ...x.track } })) : []; };

  function trimReactions(d) {
    const list = sortedReactions(d);
    for (const old of list.slice(limits.reactions)) delete d.reactions[old.track.id];
  }

  function react(uid, rawTrack, r) {
    const d = load(uid);
    const track = cleanTrack(rawTrack);
    if (!d || !track || (r !== null && r !== 'like' && r !== 'dislike')) return { ok: false };
    if (r === null) { if (!has(d.reactions, track.id)) return { ok: true }; delete d.reactions[track.id]; } else {
      delete d.reactions[track.id]; /* al cambiar de opinión pasa al final (la más reciente) */
      d.reactions[track.id] = { r, at: now(), track };
      trimReactions(d);
    }
    save(uid, d);
    return { ok: true };
  }

  /* Fusiona lo que la persona marcó en el navegador antes de tener cuenta: lo que ya está en la cuenta manda. */
  function merge(uid, items) {
    const d = load(uid);
    if (!d || !Array.isArray(items)) return { added: 0 };
    let added = 0;
    for (const it of items.slice(0, limits.merge)) {
      const track = it && cleanTrack(it.track);
      if (!track || (it.r !== 'like' && it.r !== 'dislike') || has(d.reactions, track.id)) continue;
      d.reactions[track.id] = { r: it.r, at: now() - added, track };
      added++;
    }
    if (added) { trimReactions(d); save(uid, d); }
    return { added };
  }

  /* — playlists — */
  const view = (p) => ({ id: p.id, name: p.name, created: p.created, count: p.tracks.length });
  const playlists = (uid) => { const d = load(uid); return d ? d.playlists.map(view) : []; };
  const find = (d, pid) => d.playlists.find((p) => p.id === pid);
  const playlist = (uid, pid) => { const d = load(uid); const p = d && find(d, pid); return p ? { ...view(p), tracks: p.tracks.map((t) => ({ ...t })) } : null; };

  function createPlaylist(uid, name) {
    const d = load(uid);
    const n = text(name, 60).replace(/\s+/g, ' ').trim();
    if (!d || !n || d.playlists.length >= limits.playlists) return { ok: false };
    const p = { id: crypto.randomBytes(4).toString('hex'), name: n, created: now(), tracks: [] };
    d.playlists.push(p);
    save(uid, d);
    return { ok: true, playlist: { ...view(p), tracks: [] } };
  }

  function renamePlaylist(uid, pid, name) {
    const d = load(uid);
    const p = d && find(d, pid);
    const n = text(name, 60).replace(/\s+/g, ' ').trim();
    if (!p || !n) return { ok: false };
    p.name = n;
    save(uid, d);
    return { ok: true, playlist: view(p) };
  }

  function deletePlaylist(uid, pid) {
    const d = load(uid);
    if (!d || !find(d, pid)) return false;
    d.playlists = d.playlists.filter((p) => p.id !== pid);
    save(uid, d);
    return true;
  }

  function addTrack(uid, pid, rawTrack) {
    const d = load(uid);
    const p = d && find(d, pid);
    const track = cleanTrack(rawTrack);
    if (!p || !track) return { ok: false };
    if (p.tracks.some((t) => t.id === track.id)) return { ok: true, existed: true };
    if (p.tracks.length >= limits.playlistTracks) return { ok: false };
    p.tracks.push(track);
    save(uid, d);
    return { ok: true };
  }

  function removeTrack(uid, pid, trackId) {
    const d = load(uid);
    const p = d && find(d, pid);
    if (!p) return false;
    const n = p.tracks.length;
    p.tracks = p.tracks.filter((t) => t.id !== trackId);
    if (p.tracks.length === n) return false;
    save(uid, d);
    return true;
  }

  /* — historial (el más reciente primero) — */
  function pushHistory(uid, rawTrack) {
    const d = load(uid);
    const track = cleanTrack(rawTrack);
    if (!d || !track) return { ok: false };
    if (d.history[0] && d.history[0].track.id === track.id) return { ok: true, repeated: true };
    d.history.unshift({ track, at: now() });
    d.history = d.history.slice(0, limits.history);
    save(uid, d);
    return { ok: true };
  }
  const history = (uid, limit = 100) => { const d = load(uid); return d ? d.history.slice(0, limit).map((h) => ({ at: h.at, track: { ...h.track } })) : []; };
  function clearHistory(uid) { const d = load(uid); if (d && d.history.length) { d.history = []; save(uid, d); } return true; }

  /* — gustos: puntaje por género y por artista (canal): Me gusta suma, No me gusta resta — */
  function taste(uid) {
    const d = load(uid);
    const out = { generos: { gustan: [], evitar: [] }, artistas: { gustan: [], evitar: [] }, total: 0 };
    if (!d) return out;
    const g = new Map(), a = new Map();
    const bump = (m, k, v) => { if (k) m.set(k, (m.get(k) || 0) + v); };
    for (const x of Object.values(d.reactions)) {
      const v = x.r === 'like' ? 1 : -1;
      bump(g, x.track.genre, v); bump(a, x.track.channel, v);
      out.total++;
    }
    const top = (m, sign) => [...m].filter(([, v]) => v * sign > 0).sort((p, q) => (q[1] - p[1]) * sign || (p[0] < q[0] ? -1 : 1)).slice(0, 10).map(([k]) => k);
    out.generos = { gustan: top(g, 1), evitar: top(g, -1) };
    out.artistas = { gustan: top(a, 1), evitar: top(a, -1) };
    return out;
  }

  /* Géneros que esta persona rechaza de verdad: saldo de al menos `min` No me gusta más que Me gusta. */
  function avoidGenres(uid, min = 2) {
    const d = load(uid);
    if (!d) return [];
    const g = new Map();
    for (const x of Object.values(d.reactions)) if (x.track.genre) g.set(x.track.genre, (g.get(x.track.genre) || 0) + (x.r === 'like' ? 1 : -1));
    return [...g].filter(([, v]) => v <= -min).sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1)).map(([k]) => k);
  }

  /* — preferencias (p. ej. el viaje de Bienestar favorito) — */
  const prefs = (uid) => { const d = load(uid); return d ? JSON.parse(JSON.stringify(d.prefs)) : {}; };
  function setPrefs(uid, values) {
    const d = load(uid);
    if (!d || !values || typeof values !== 'object' || Array.isArray(values)) return { ok: false };
    const next = {};
    for (const k of PREF_KEYS) {
      if (!(k in values)) continue;
      const s = JSON.stringify(values[k]);
      if (s === undefined || s.length > limits.prefValue) return { ok: false };
      next[k] = values[k];
    }
    Object.assign(d.prefs, next);
    save(uid, d);
    return { ok: true };
  }

  function exportAll(uid) {
    const d = load(uid);
    if (!d) return null;
    return { reactions: reactions(uid), playlists: d.playlists.map((p) => ({ ...view(p), tracks: p.tracks })), history: history(uid, limits.history), prefs: prefs(uid) };
  }

  return { reactions, react, merge, playlists, playlist, createPlaylist, renamePlaylist, deletePlaylist, addTrack, removeTrack, pushHistory, history, clearHistory, taste, avoidGenres, prefs, setPrefs, exportAll };
}

module.exports = { createLibrary, cleanTrack, LIMITS };
