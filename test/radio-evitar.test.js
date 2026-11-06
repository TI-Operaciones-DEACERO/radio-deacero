'use strict';
/* El radio puede evitar géneros por sesión (los que a esa persona no le gustan). */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRadio } = require('../src/radio');

const genres = ['a', 'b', 'c', 'd'].map((id) => ({ id, label: id, emoji: 'x', color: '#000', featured: true, queries: [id] }));
let n = 0;
const mk = () => createRadio({
  genres, rng: Math.random, perGenre: [1, 1],
  /* cada búsqueda trae canciones nuevas (id único de 11 caracteres) */
  search: async (q) => [{ id: (q + String(++n).padStart(10, '0')).slice(-11), title: q, channel: 'c', duration: 100 }]
});

test('avoidGenres: la rotación nunca cae en un género evitado', async () => {
  const r = mk();
  for (let i = 0; i < 60; i++) {
    const x = await r.next({ session: 'sesion-uno', avoidGenres: ['a', 'b'] });
    assert.ok(['c', 'd'].includes(x.genre.id), x.genre.id);
  }
});

test('avoidGenres: si evitaría todos, no se queda sin música', async () => {
  const r = mk();
  const x = await r.next({ session: 'sesion-dos', avoidGenres: ['a', 'b', 'c', 'd'] });
  assert.ok(x.track);
});

test('avoidGenres: un género pedido a mano sí se respeta (el usuario manda)', async () => {
  const r = mk();
  const x = await r.next({ session: 'sesion-tres', genre: 'a', avoidGenres: ['a'] });
  assert.equal(x.genre.id, 'a');
});

test('avoidGenres solo afecta a su sesión', async () => {
  const r = mk();
  const vistos = new Set();
  for (let i = 0; i < 80; i++) vistos.add((await r.next({ session: 'otra-sesion' })).genre.id);
  assert.ok(vistos.has('a') || vistos.has('b'), 'sin filtro salen todos');
});
