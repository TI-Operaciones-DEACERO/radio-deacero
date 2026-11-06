'use strict';
/* Fase 2: biblioteca de cada cuenta (Me gusta, playlists, historial, gustos). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLibrary, cleanTrack, LIMITS } = require('../src/library');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'play-lib-'));
const UID = '0123456789abcdef';
const OTRO = 'fedcba9876543210';
const id = (n) => String(n).padStart(11, 'x');
const T = (n, extra = {}) => ({ id: id(n), title: 'Canción ' + n, channel: 'Canal ' + n, duration: 200, ...extra });

test('cleanTrack: solo campos conocidos y con tope; rechaza ids inválidos', () => {
  const t = cleanTrack({ id: id(1), title: 'x'.repeat(999), channel: 'c', duration: 99999999, genre: 'jazz', extra: 'no', __proto__: { a: 1 } });
  assert.deepEqual(Object.keys(t).sort(), ['channel', 'duration', 'genre', 'id', 'title']);
  assert.equal(t.title.length, 300);
  assert.equal(t.duration, 1e5);
  for (const mal of [null, 1, 'x', {}, { id: 'corto' }, { id: 'a/b/c/d/e/f/' }, { id: id(1) + 'x' }, []]) assert.equal(cleanTrack(mal), null, JSON.stringify(mal));
});

test('reacciones: poner, cambiar, quitar', () => {
  const lib = createLibrary({ dir: tmp() });
  assert.deepEqual(lib.reactions(UID), []);
  lib.react(UID, T(1, { genre: 'jazz' }), 'like');
  lib.react(UID, T(2), 'dislike');
  assert.equal(lib.reactions(UID).length, 2);
  lib.react(UID, T(1), 'dislike');
  assert.equal(lib.reactions(UID).find((x) => x.track.id === id(1)).r, 'dislike');
  lib.react(UID, T(1), null);
  assert.equal(lib.reactions(UID).length, 1);
  assert.equal(lib.react(UID, T(3), 'raro').ok, false);
  assert.equal(lib.react(UID, { id: 'mal' }, 'like').ok, false);
});

test('reacciones: la más reciente primero y con tope', () => {
  let now = 1000;
  const lib = createLibrary({ dir: tmp(), now: () => now, limits: { ...LIMITS, reactions: 3 } });
  for (let i = 1; i <= 5; i++) { now += 1; lib.react(UID, T(i), 'like'); }
  const l = lib.reactions(UID);
  assert.equal(l.length, 3);
  assert.equal(l[0].track.id, id(5));
  assert.equal(l[2].track.id, id(3), 'se fueron las más viejas');
});

test('merge: fusiona los Me gusta guardados en el navegador sin pisar lo que ya hay', () => {
  const lib = createLibrary({ dir: tmp() });
  lib.react(UID, T(1), 'dislike');
  const r = lib.merge(UID, [{ track: T(1), r: 'like' }, { track: T(2), r: 'like' }, { track: { id: 'mal' }, r: 'like' }, { track: T(3), r: 'x' }]);
  assert.equal(r.added, 1);
  assert.equal(lib.reactions(UID).find((x) => x.track.id === id(1)).r, 'dislike', 'lo de la cuenta manda');
  assert.equal(lib.reactions(UID).length, 2);
  assert.equal(lib.merge(UID, 'no es lista').added, 0);
});

test('playlists: crear, renombrar, añadir, quitar, borrar', () => {
  const lib = createLibrary({ dir: tmp() });
  const p = lib.createPlaylist(UID, '  Mi lista  ');
  assert.equal(p.ok, true);
  assert.match(p.playlist.id, /^[a-f0-9]{8}$/);
  assert.equal(p.playlist.name, 'Mi lista');
  assert.equal(lib.addTrack(UID, p.playlist.id, T(1)).ok, true);
  assert.equal(lib.addTrack(UID, p.playlist.id, T(1)).existed, true, 'no duplica');
  assert.equal(lib.addTrack(UID, p.playlist.id, T(2)).ok, true);
  assert.equal(lib.playlists(UID)[0].count, 2);
  assert.equal(lib.playlist(UID, p.playlist.id).tracks.length, 2);
  assert.equal(lib.removeTrack(UID, p.playlist.id, id(1)), true);
  assert.equal(lib.removeTrack(UID, p.playlist.id, id(1)), false);
  assert.equal(lib.renamePlaylist(UID, p.playlist.id, 'Otra').playlist.name, 'Otra');
  assert.equal(lib.deletePlaylist(UID, p.playlist.id), true);
  assert.equal(lib.playlists(UID).length, 0);
  assert.equal(lib.deletePlaylist(UID, p.playlist.id), false);
});

test('playlists: nombre obligatorio y topes', () => {
  const lib = createLibrary({ dir: tmp(), limits: { ...LIMITS, playlists: 2, playlistTracks: 2 } });
  assert.equal(lib.createPlaylist(UID, '   ').ok, false);
  assert.equal(lib.createPlaylist(UID, 'x'.repeat(200)).playlist.name.length, 60);
  const p = lib.createPlaylist(UID, 'b').playlist;
  assert.equal(lib.createPlaylist(UID, 'c').ok, false, 'tope de playlists');
  lib.addTrack(UID, p.id, T(1)); lib.addTrack(UID, p.id, T(2));
  assert.equal(lib.addTrack(UID, p.id, T(3)).ok, false, 'tope de pistas');
});

test('aislamiento: una cuenta no ve ni toca lo de otra', () => {
  const lib = createLibrary({ dir: tmp() });
  const p = lib.createPlaylist(UID, 'privada').playlist;
  lib.react(UID, T(1), 'like');
  lib.pushHistory(UID, T(1));
  assert.deepEqual(lib.reactions(OTRO), []);
  assert.deepEqual(lib.playlists(OTRO), []);
  assert.equal(lib.playlist(OTRO, p.id), null);
  assert.equal(lib.addTrack(OTRO, p.id, T(2)).ok, false);
  assert.equal(lib.deletePlaylist(OTRO, p.id), false);
  assert.deepEqual(lib.history(OTRO), []);
  assert.equal(lib.playlist(UID, p.id).tracks.length, 0, 'lo de la dueña intacto');
});

test('historial: más reciente primero, sin repetir seguidas, con tope, y se puede borrar', () => {
  let now = 1000;
  const lib = createLibrary({ dir: tmp(), now: () => now, limits: { ...LIMITS, history: 3 } });
  for (const n of [1, 1, 2, 3, 4]) { now += 1; lib.pushHistory(UID, T(n)); }
  const h = lib.history(UID);
  assert.deepEqual(h.map((x) => x.track.id), [id(4), id(3), id(2)]);
  lib.clearHistory(UID);
  assert.deepEqual(lib.history(UID), []);
});

test('gustos: géneros y artistas con más Me gusta / No me gusta', () => {
  const lib = createLibrary({ dir: tmp() });
  lib.react(UID, T(1, { genre: 'jazz', channel: 'A' }), 'like');
  lib.react(UID, T(2, { genre: 'jazz', channel: 'A' }), 'like');
  lib.react(UID, T(3, { genre: 'rock', channel: 'B' }), 'like');
  lib.react(UID, T(4, { genre: 'pop', channel: 'C' }), 'dislike');
  const t = lib.taste(UID);
  assert.deepEqual(t.generos.gustan, ['jazz', 'rock']);
  assert.deepEqual(t.generos.evitar, ['pop']);
  assert.equal(t.artistas.gustan[0], 'A');
  assert.deepEqual(lib.taste(OTRO), { generos: { gustan: [], evitar: [] }, artistas: { gustan: [], evitar: [] }, total: 0 });
});

test('prefs: se guardan con tope y solo claves conocidas', () => {
  const lib = createLibrary({ dir: tmp() });
  assert.deepEqual(lib.prefs(UID), {});
  lib.setPrefs(UID, { bienestar: { estado: 'estresado', destino: 'relajar' }, tema: 'oscuro', raro: 1 });
  assert.deepEqual(Object.keys(lib.prefs(UID)).sort(), ['bienestar', 'tema']);
  assert.equal(lib.setPrefs(UID, { bienestar: 'x'.repeat(5000) }).ok, false);
});

test('persistencia: sobrevive a reiniciar y un archivo dañado no rompe', () => {
  const dir = tmp();
  createLibrary({ dir }).react(UID, T(1), 'like');
  assert.equal(createLibrary({ dir }).reactions(UID).length, 1);
  fs.writeFileSync(path.join(dir, 'users', UID + '.json'), '{roto');
  assert.deepEqual(createLibrary({ dir }).reactions(UID), []);
});

test('ids de cuenta inválidos no tocan el disco fuera de users/', () => {
  const dir = tmp();
  const lib = createLibrary({ dir });
  assert.equal(lib.react('../../x', T(1), 'like').ok, false);
  assert.deepEqual(lib.reactions('../x'), []);
  assert.ok(!fs.existsSync(path.join(dir, '..', 'x.json')));
});

test('export: lo mismo que ve la persona', () => {
  const lib = createLibrary({ dir: tmp() });
  lib.react(UID, T(1), 'like');
  const e = lib.exportAll(UID);
  assert.equal(e.reactions.length, 1);
  assert.deepEqual(Object.keys(e).sort(), ['history', 'playlists', 'prefs', 'reactions']);
});

test('archivo de la cuenta borrado a mano: se parte de cero', () => {
  const dir = tmp();
  const lib = createLibrary({ dir });
  lib.react(UID, T(1), 'like');
  fs.unlinkSync(path.join(dir, 'users', UID + '.json'));
  assert.deepEqual(lib.reactions(UID), []);
});
