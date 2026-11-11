'use strict';
/* muestras.js — una canción de muestra (carátula + miniclip) para el banner de cada género o artista. Con caché y sin saturar yt-dlp. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMuestras } = require('../src/muestras');
const { withServer } = require('./helpers/servidor');

const T = (id, over = {}) => ({ id, title: 'Canción ' + id, channel: 'Canal', duration: 200, ...over });
const ID1 = 'aaaaaaaaaaa', ID2 = 'bbbbbbbbbbb', ID3 = 'ccccccccccc';

test('genero: usa la muestra de la radio y la guarda en caché', async () => {
  let n = 0;
  const m = createMuestras({ radio: { muestra: async (g) => { n++; return g === 'jazz' ? T(ID1) : null; } }, search: async () => [] });
  assert.deepEqual(await m.genero('jazz'), { id: ID1, title: 'Canción ' + ID1, duration: 200 });
  await m.genero('jazz');
  assert.equal(n, 1, 'la segunda sale de la caché');
  assert.equal(await m.genero('no-hay'), null);
});

test('artista: toma el primer resultado válido y corto, y lo guarda en caché sin distinguir mayúsculas', async () => {
  const llamadas = [];
  const m = createMuestras({ radio: {}, search: async (q, n) => { llamadas.push([q, n]); return [T('corto', { id: 'x' }), T(ID2, { duration: 3 * 3600 }), T(ID3)]; } });
  const r = await m.artista('Cuco');
  assert.equal(r.id, ID3, 'descarta ids inválidos y mezclas de horas');
  await m.artista('  cuco ');
  assert.equal(llamadas.length, 1);
  assert.ok(llamadas[0][0].toLowerCase().includes('cuco'));
});

test('artista: respeta el filtro de contenido y no revienta si la búsqueda falla', async () => {
  const filtro = (t) => t.id !== ID1;
  const m = createMuestras({ radio: {}, search: async () => [T(ID1), T(ID2)], filtro });
  assert.equal((await m.artista('A')).id, ID2);
  const falla = createMuestras({ radio: {}, search: async () => { throw new Error('sin red'); } });
  assert.equal(await falla.artista('B'), null);
});

test('peticiones iguales a la vez comparten UNA búsqueda; hay tope de simultáneas', async () => {
  let activas = 0, pico = 0, total = 0;
  const m = createMuestras({ radio: {}, simultaneas: 2, search: async () => { total++; activas++; pico = Math.max(pico, activas); await new Promise((r) => setTimeout(r, 15)); activas--; return [T(ID1)]; } });
  await Promise.all([m.artista('uno'), m.artista('uno'), m.artista('dos'), m.artista('tres'), m.artista('cuatro')]);
  assert.equal(total, 4, 'la repetida no busca otra vez');
  assert.ok(pico <= 2, 'pico ' + pico);
});

test('las que no hay se recuerdan un rato corto (no se vuelve a buscar en cada tarjeta) y luego se reintentan', async () => {
  let n = 0; const reloj = { t: 1000 };
  const m = createMuestras({ radio: {}, now: () => reloj.t, search: async () => { n++; return []; }, ttlFalloMs: 1000 });
  await m.artista('nadie'); await m.artista('nadie');
  assert.equal(n, 1);
  reloj.t += 1500;
  await m.artista('nadie');
  assert.equal(n, 2);
});

test('la caché tiene tope', async () => {
  const m = createMuestras({ radio: {}, max: 5, search: async () => [T(ID1)] });
  for (let i = 0; i < 20; i++) await m.artista('artista ' + i);
  assert.ok(m.size() <= 5);
});

test('GET /api/muestra: de género o de artista (este último pide sesión), valida entradas y responde 404 si no hay', async () => {
  const muestras = { genero: async (g) => (g === 'jazz' ? { id: ID1, title: 'T', duration: 100 } : null), artista: async (q) => (q === 'Cuco' ? { id: ID2, title: 'U', duration: 90 } : null) };
  await withServer({ muestras }, async (s, c) => {
    const sid = 'abcdefgh1234';
    assert.deepEqual((await c.call('GET', '/api/muestra?g=jazz')).json, { id: ID1, title: 'T', duration: 100 });
    assert.equal((await c.call('GET', '/api/muestra?g=desconocido')).status, 404);
    assert.equal((await c.call('GET', '/api/muestra?g=../../x')).status, 400);
    assert.equal((await c.call('GET', '/api/muestra')).status, 400);
    assert.equal((await c.call('GET', '/api/muestra?a=Cuco&sid=' + sid)).json.id, ID2);
    assert.equal((await c.call('GET', '/api/muestra?a=Nadie&sid=' + sid)).status, 404);
    assert.equal((await c.call('GET', '/api/muestra?a=' + 'x'.repeat(300) + '&sid=' + sid)).status, 400);
    assert.equal((await c.call('GET', '/api/muestra?a=Cuco')).status, 401, 'artista sin sesión pide clave');
    assert.equal((await c.call('POST', '/api/muestra?g=jazz', { body: {} })).status, 405);
  });
  await withServer({ muestras, panelOpen: false }, async (s, c) => {
    assert.equal((await c.call('GET', '/api/muestra?g=jazz')).status, 401);
  });
});
