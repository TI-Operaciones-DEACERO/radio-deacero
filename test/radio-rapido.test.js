'use strict';
/* Panel: siguiente y cambio de género deben empezar YA. El oyente no espera a que el servidor compruebe la canción (si falla, su
 * reproductor reintenta y salta); los géneros se precalientan en segundo plano y se prefieren canciones ya resueltas. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRadio } = require('../src/radio');
const { createCalentador } = require('../src/calentador');

const genres = ['a', 'b', 'c'].map((id) => ({ id, label: id, emoji: 'x', color: '#000', featured: true, queries: [id] }));
let n = 0;
const mkSearch = (log = []) => async (q, k = 5) => { log.push(q); return Array.from({ length: Math.min(k, 6) }, () => ({ id: (q + String(++n).padStart(10, '0')).slice(-11), title: q + ' ' + n, channel: q, duration: 200 })); };

test('oyente con sesión: la canción sale SIN sondear (directo); las pantallas siguen sondeando', async () => {
  const sondeos = [];
  const r = createRadio({ genres, search: mkSearch(), probe: async (id) => { sondeos.push(id); return true; } });
  await r.next({ session: 'oyente-123' });
  await r.next({ session: 'oyente-123', genre: 'b' });
  assert.equal(sondeos.length, 0, 'el oyente no espera el sondeo');
  await r.next({});
  assert.ok(sondeos.length >= 1, 'la pantalla sí sondea');
});

test('oyente: aun sin sondear, nunca recibe una pista que ya se sabe que falla', async () => {
  const r = createRadio({ genres: genres.slice(0, 1), search: async () => [{ id: 'malamalamal', title: 'x', duration: 100 }, { id: 'buenabuenab', title: 'y', duration: 100 }], probe: async (id) => id !== 'malamalamal', rng: () => 0 });
  await r.next({}); /* la pantalla sondea y aprende que "malamalamal" falla */
  for (let i = 0; i < 3; i++) assert.notEqual((await r.next({ session: 'oyente-123', genre: 'a' })).track.id, 'malamalamal');
});

test('calentar: llena el pool de un género sin consumirlo; luego el cambio de género no busca', async () => {
  const log = [];
  const r = createRadio({ genres, search: mkSearch(log) });
  const ids = await r.calentar('b');
  assert.ok(ids.length >= 3);
  assert.equal(log.length, 1);
  await r.calentar('b');
  assert.equal(log.length, 1, 'si ya está lleno no vuelve a buscar');
  const x = await r.next({ session: 'oyente-123', genre: 'b' });
  assert.equal(log.length, 1, 'el cambio de género salió del pool caliente');
  assert.ok(ids.includes(x.track.id));
  assert.deepEqual(await r.calentar('no-existe'), []);
});

test('listo(): el oyente recibe primero una canción ya resuelta (empieza a sonar al instante)', async () => {
  const listas = new Set();
  const r = createRadio({ genres, search: mkSearch(), listo: (id) => listas.has(id), rng: () => 0 });
  const ids = await r.calentar('c');
  listas.add(ids[ids.length - 1]);
  const x = await r.next({ session: 'oyente-123', genre: 'c' });
  assert.equal(x.track.id, ids[ids.length - 1]);
});

test('calentador: recorre los géneros uno por uno, resuelve las primeras canciones y se puede apagar', async () => {
  const calentados = [], resueltos = [];
  const radio = { calentar: async (id) => { calentados.push(id); return [id + '-1', id + '-2', id + '-3']; } };
  const c = createCalentador({ radio, generos: () => ['a', 'b'], resolver: async (id) => { resueltos.push(id); }, porGenero: 2, cadaMs: 0 });
  await c.tick(); await c.tick(); await c.tick();
  assert.deepEqual(calentados, ['a', 'b', 'a']);
  assert.deepEqual(resueltos.slice(0, 4), ['a-1', 'a-2', 'b-1', 'b-2']);
  const roto = createCalentador({ radio: { calentar: async () => { throw new Error('yt-dlp caído'); } }, generos: () => ['a'], resolver: async () => {}, cadaMs: 0 });
  await roto.tick(); /* un fallo no rompe nada */
  assert.equal(typeof c.stop, 'function');
});

test('calentador: los géneros que pide la gente van primero (prioridad)', async () => {
  const calentados = [];
  const radio = { calentar: async (id) => { calentados.push(id); return []; } };
  const c = createCalentador({ radio, generos: () => ['a', 'b', 'c'], resolver: async () => {}, cadaMs: 0 });
  c.prioridad('c');
  await c.tick(); await c.tick();
  assert.deepEqual(calentados, ['c', 'a']);
});
