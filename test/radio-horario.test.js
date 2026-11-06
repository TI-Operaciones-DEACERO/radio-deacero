'use strict';
/* Fase 6: el horario limita los géneros de la rotación (lo pide el servidor solo para las pantallas) y el filtro de títulos. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRadio } = require('../src/radio');

const genres = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, label: id, emoji: 'x', color: '#000', featured: id !== 'e', queries: [id] }));
let n = 0;
const mk = (extra = {}) => createRadio({
  genres, rng: Math.random, perGenre: [3, 3],
  search: async (q) => [
    { id: (q + String(++n).padStart(10, '0')).slice(-11), title: q + ' canción', channel: 'c', duration: 100 },
    { id: (q + String(++n).padStart(10, '0')).slice(-11), title: q + ' (Explicit)', channel: 'c', duration: 100 }
  ],
  ...extra
});

test('onlyGenres: la rotación solo usa esos géneros (aunque no sean destacados)', async () => {
  const r = mk();
  for (let i = 0; i < 40; i++) {
    const x = await r.next({ onlyGenres: ['b', 'e'] });
    assert.ok(['b', 'e'].includes(x.genre.id), x.genre.id);
  }
});

test('onlyGenres: al empezar un bloque nuevo cambia de género sin esperar a que acabe la racha', async () => {
  const r = mk();
  const x = await r.next({ onlyGenres: ['a'] });
  assert.equal(x.genre.id, 'a');
  const y = await r.next({ onlyGenres: ['c'] });
  assert.equal(y.genre.id, 'c');
});

test('onlyGenres: un género pedido a mano se respeta durante su racha', async () => {
  const r = mk();
  const x = await r.next({ genre: 'd', onlyGenres: ['a'] });
  assert.equal(x.genre.id, 'd');
  assert.equal((await r.next({ onlyGenres: ['a'] })).genre.id, 'd');
});

test('sin onlyGenres: rotación normal (los destacados)', async () => {
  const r = mk();
  const vistos = new Set();
  for (let i = 0; i < 60; i++) vistos.add((await r.next({})).genre.id);
  assert.ok(vistos.size >= 3);
  assert.ok(!vistos.has('e'), 'e no es destacado');
});

test('filtro: las pistas que no pasan el filtro nunca se ofrecen', async () => {
  const r = mk({ filtro: (t) => !/explicit/i.test(t.title) });
  for (let i = 0; i < 30; i++) assert.ok(!/explicit/i.test((await r.next({ session: 'oyente-uno' })).track.title));
});
