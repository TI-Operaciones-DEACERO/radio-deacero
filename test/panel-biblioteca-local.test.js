'use strict';
/* Sin nómina, historial y playlists se guardan en ESTE navegador (localStorage) con la misma forma de respuesta que la cuenta. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createBibliotecaLocal } = require('../public/js/panel/biblioteca-local');

const mem = () => { const m = new Map(); return { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, String(v)), del: (k) => m.delete(k), m }; };
const T = (id, title = 'Canción ' + id) => ({ id: (id + 'xxxxxxxxxxx').slice(0, 11), title, channel: 'Canal', duration: 200 });

test('historial: el más reciente primero, sin repetir la misma seguida, con tope y se puede borrar', async () => {
  let t = 1000;
  const s = mem();
  const b = createBibliotecaLocal({ store: s, now: () => t++, maxHistorial: 3 });
  assert.equal((await b.registrarHistorial(T('a'))).ok, true);
  await b.registrarHistorial(T('a'));
  await b.registrarHistorial(T('b')); await b.registrarHistorial(T('c')); await b.registrarHistorial(T('d'));
  const h = await b.historial(100);
  assert.equal(h.ok, true);
  assert.deepEqual(h.data.map((x) => x.track.id.slice(0, 1)), ['d', 'c', 'b']);
  assert.ok(h.data[0].at > 0);
  const b2 = createBibliotecaLocal({ store: s }); /* otra pestaña / recarga: sigue ahí */
  assert.equal((await b2.historial()).data.length, 3);
  await b2.borrarHistorial();
  assert.equal((await b.historial()).data.length, 0);
});

test('playlists: crear, listar, agregar (sin duplicar), quitar, renombrar y borrar con la forma de la cuenta', async () => {
  const b = createBibliotecaLocal({ store: mem() });
  const c = await b.crearPlaylist('  Para   correr ');
  assert.equal(c.ok, true);
  const pl = c.data.playlist;
  assert.equal(pl.name, 'Para correr');
  assert.match(pl.id, /^[a-f0-9]{8}$/);
  assert.equal((await b.agregarAPlaylist(pl.id, T('a'))).data.existed, false);
  assert.equal((await b.agregarAPlaylist(pl.id, T('a'))).data.existed, true);
  await b.agregarAPlaylist(pl.id, T('b'));
  assert.deepEqual((await b.playlists()).data.map((p) => [p.name, p.count]), [['Para correr', 2]]);
  assert.equal((await b.playlist(pl.id)).data.tracks.length, 2);
  assert.equal((await b.quitarDePlaylist(pl.id, T('a').id)).ok, true);
  assert.equal((await b.renombrarPlaylist(pl.id, 'Gym')).data.playlist.name, 'Gym');
  assert.equal((await b.playlist('ffffffff')).status, 404);
  assert.equal((await b.borrarPlaylist(pl.id)).ok, true);
  assert.equal((await b.playlists()).data.length, 0);
});

test('valida como la cuenta: nombre vacío, canción inválida y topes → 400', async () => {
  const b = createBibliotecaLocal({ store: mem(), maxPlaylists: 1 });
  assert.equal((await b.crearPlaylist('   ')).status, 400);
  const pl = (await b.crearPlaylist('Una')).data.playlist;
  assert.equal((await b.crearPlaylist('Dos')).status, 400, 'tope de playlists');
  assert.equal((await b.agregarAPlaylist(pl.id, { id: 'no válido', title: 'x' })).status, 400);
  assert.equal((await b.registrarHistorial({ title: 'sin id' })).status, 400);
});

test('datos dañados en el navegador no rompen nada (se empieza vacío)', async () => {
  const s = mem();
  s.set('pl_local_historial', '{roto');
  s.set('pl_local_playlists', '"texto"');
  const b = createBibliotecaLocal({ store: s });
  assert.deepEqual((await b.historial()).data, []);
  assert.deepEqual((await b.playlists()).data, []);
});

test('el título se guarda como texto plano recortado (no se interpreta)', async () => {
  const b = createBibliotecaLocal({ store: mem() });
  await b.registrarHistorial({ id: 'abcdefghijk', title: '<img src=x onerror=alert(1)>' + 'x'.repeat(500), channel: 'c', duration: 5 });
  const t = (await b.historial()).data[0].track;
  assert.ok(t.title.length <= 300);
  assert.equal(t.title.slice(0, 4), '<img', 'se guarda tal cual: el panel lo pinta con textContent');
});
