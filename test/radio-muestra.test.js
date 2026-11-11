'use strict';
/* radio.muestra: una canción del pool de un género para su banner (sin consumirla). */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRadio } = require('../src/radio');

const genres = [{ id: 'jazz', label: 'Jazz', emoji: '🎷', color: '#f90', queries: ['jazz'] }];
const T = (n) => ({ id: String(n).padStart(11, 'x'), title: 'T' + n, channel: 'C', duration: 200 });

test('muestra: con el pool vacio busca y devuelve una cancion', async () => {
  let busquedas = 0;
  const radio = createRadio({ genres, search: async () => { busquedas++; return [T(1), T(2), T(3)]; } });
  const m = await radio.muestra('jazz');
  assert.ok(m && m.id.length === 11, JSON.stringify(m));
  assert.equal(busquedas, 1);
});

test('muestra: despues de servir canciones del genero (el pool ya existe) sigue habiendo muestra', async () => {
  const radio = createRadio({ genres, search: async () => [1, 2, 3, 4, 5, 6, 7, 8].map(T), perGenre: [4, 4] });
  await radio.next({ genre: 'jazz', session: 'abcdefgh1234' });
  const m = await radio.muestra('jazz');
  assert.ok(m, 'queda pool tras servir una');
});

test('muestra: genero desconocido -> null; nunca consume el pool', async () => {
  const radio = createRadio({ genres, search: async () => [1, 2, 3].map(T) });
  assert.equal(await radio.muestra('no-existe'), null);
  await radio.muestra('jazz'); await radio.muestra('jazz');
  const a = await radio.next({ genre: 'jazz', session: 'abcdefgh1234' });
  assert.ok(a.track);
});

test('muestra: con resultados SIN duracion (yt-dlp --flat-playlist a veces no la trae) tambien funciona', async () => {
  const radio = createRadio({ genres, search: async () => [{ id: 'aaaaaaaaaaa', title: 'X', channel: 'C' }, { id: 'bbbbbbbbbbb', title: 'Y', channel: 'C', duration: null }] });
  const m = await radio.muestra('jazz');
  assert.ok(m, 'sin duracion');
  assert.equal(m.id, 'aaaaaaaaaaa');
});

test('muestra: si el genero solo trae mezclas largas (lofi, jazz: horas), igual hay muestra; prefiere una corta si existe', async () => {
  const largas = createRadio({ genres, search: async () => [{ ...T(1), duration: 3 * 3600 }, { ...T(2), duration: 2 * 3600 }] });
  const m = await largas.muestra('jazz');
  assert.ok(m, 'una mezcla larga sirve: el miniclip empieza a ~30 s');
  const mixtas = createRadio({ genres, search: async () => [{ ...T(1), duration: 3 * 3600 }, { ...T(2), duration: 200 }] });
  assert.equal((await mixtas.muestra('jazz')).id, T(2).id, 'prefiere la corta');
});
