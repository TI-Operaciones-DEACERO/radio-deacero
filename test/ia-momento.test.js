'use strict';
/* «Lo más escuchado del momento»: géneros Y artistas del momento (lo que se oye en la planta + lo propio de la hora). */
const test = require('node:test');
const assert = require('node:assert/strict');
const local = require('../src/ia/local');
const { createIa } = require('../src/ia');
const { withServer } = require('./helpers/servidor');

const genres = require('../data/genres.json');
const seeds = require('../data/seed/artistas.json');
const podcasts = require('../data/seed/podcasts.json');
const vacio = { generos: { gustan: [], evitar: [] }, artistas: { gustan: [], evitar: [] }, total: 0 };
const rng = () => 0.37;

test('momento: trae géneros y artistas, con la forma de las tarjetas', () => {
  const r = local.momento({ hour: 10, genres, seeds, taste: vacio, rng });
  assert.ok(r.razon && r.franja);
  assert.ok(r.generos.length >= 4 && r.generos.every((g) => g.id && g.label));
  assert.ok(r.artistas.length >= 6, 'artistas del momento: ' + r.artistas.length);
  for (const a of r.artistas) { assert.ok(a.name && a.query && a.reason, JSON.stringify(a)); assert.equal(typeof a.emoji, 'string'); }
  assert.equal(new Set(r.artistas.map((a) => a.name.toLowerCase())).size, r.artistas.length, 'sin repetir');
});

test('momento: lo más escuchado en la planta va primero y lo dice', () => {
  const pop = { artistas: [{ name: 'Cuco', n: 9 }, { name: 'Artista Que No Está En Las Semillas', n: 5 }], generos: [{ id: 'jazz', n: 4 }] };
  const r = local.momento({ hour: 10, genres, seeds, taste: vacio, pop, rng });
  assert.equal(r.artistas[0].name, 'Cuco');
  assert.equal(r.artistas[0].popular, true);
  assert.match(r.artistas[0].reason, /escuch/i);
  assert.equal(r.artistas[1].name, 'Artista Que No Está En Las Semillas');
  assert.ok(r.artistas[1].query.includes('Artista Que No Está En Las Semillas'), 'se puede buscar aunque no esté en las semillas');
  assert.ok(r.artistas.slice(2).every((a) => !a.popular));
  assert.ok(r.generos.some((g) => g.id === 'jazz'), 'un género popular entra entre las sugerencias');
});

test('momento: sin datos de la planta sigue habiendo artistas del momento (por la hora)', () => {
  for (const pop of [undefined, null, { artistas: [], generos: [] }]) {
    const r = local.momento({ hour: 22, genres, seeds, taste: vacio, pop, rng });
    assert.ok(r.artistas.length >= 6);
    assert.ok(r.artistas.every((a) => !a.popular));
  }
});

test('momento: respeta lo que la persona evita (género de artista y de radio)', () => {
  const evita = { ...vacio, generos: { gustan: [], evitar: ['banda'] } };
  const r = local.momento({ hour: 10, genres, seeds, taste: evita, rng });
  assert.ok(!r.generos.some((g) => g.id === 'banda'));
  assert.ok(!r.artistas.some((a) => /^banda$/i.test(a.genre)), 'ningún artista de un género evitado');
});

test('momento: cambia con la hora (mañana ≠ noche) cuando no hay datos de la planta', () => {
  const m = local.momento({ hour: 8, genres, seeds, taste: vacio, rng: Math.random });
  const n = local.momento({ hour: 23, genres, seeds, taste: vacio, rng: Math.random });
  assert.notEqual(m.franja, n.franja);
});

test('ia.momento usa la popularidad de la planta y marca la fuente', async () => {
  const pop = { top: () => ({ artistas: [{ name: 'Cuco', n: 3 }], generos: [] }) };
  const ia = createIa({ genres, artistas: seeds, podcasts, popularidad: pop, rng });
  const r = await ia.momento({ taste: vacio, hour: 10, recientes: [] });
  assert.equal(r.fuente, 'local');
  assert.equal(r.artistas[0].name, 'Cuco');
});

test('ia.momento funciona sin módulo de popularidad', async () => {
  const ia = createIa({ genres, artistas: seeds, podcasts, rng });
  const r = await ia.momento({ taste: vacio, hour: 10, recientes: [] });
  assert.ok(r.artistas.length >= 6);
});

test('/api/ia/momento: abierta al oyente, solo GET, con la hora del servidor y los gustos de la cuenta', async () => {
  const llamadas = [];
  const ia = { momento: async (o) => { llamadas.push(o); return { fuente: 'local', razon: 'x', generos: [], artistas: [] }; }, gemini: () => ({ enabled: false }) };
  await withServer({ ia }, async (s, c) => {
    const r = await c.call('GET', '/api/ia/momento');
    assert.equal(r.status, 200);
    assert.equal(llamadas.at(-1).hour, new Date(s.now.t).getHours());
    assert.equal((await c.call('POST', '/api/ia/momento', { body: {} })).status, 405);
  });
  await withServer({ ia, panelOpen: false }, async (s, c) => {
    assert.equal((await c.call('GET', '/api/ia/momento')).status, 401);
  });
});
