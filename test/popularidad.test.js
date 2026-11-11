'use strict';
/* popularidad.js — lo más escuchado de la planta: solo conteos agregados por artista y género (nada de quién ni desde dónde). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPopularidad, limpiarCanal } = require('../src/popularidad');

const DIA = 24 * 3600 * 1000;
const crear = (over = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'play-pop-'));
  const reloj = { t: Date.UTC(2026, 10, 11, 15, 0, 0) };
  const p = createPopularidad({ dir, now: () => reloj.t, minimo: 2, guardarCadaMs: 0, ...over });
  return { p, dir, reloj };
};

test('limpiarCanal: deja el nombre del artista, sin «- Topic», VEVO ni «Official»', () => {
  assert.equal(limpiarCanal('Cuco - Topic'), 'Cuco');
  assert.equal(limpiarCanal('BadBunnyVEVO'), 'BadBunny');
  assert.equal(limpiarCanal('Grupo Frontera Official'), 'Grupo Frontera');
  assert.equal(limpiarCanal('  Natanael   Cano  '), 'Natanael Cano');
  assert.equal(limpiarCanal(''), '');
  assert.equal(limpiarCanal(null), '');
  assert.equal(limpiarCanal(42), '');
  assert.ok(limpiarCanal('x'.repeat(500)).length <= 80);
});

test('top: ordena por reproducciones y exige un mínimo para no exponer lo que oyó una sola vez', () => {
  const { p } = crear();
  for (let i = 0; i < 3; i++) p.registrar({ channel: 'Cuco - Topic', genre: 'indie' });
  for (let i = 0; i < 2; i++) p.registrar({ channel: 'Grupo Frontera', genre: 'grupero' });
  p.registrar({ channel: 'Solo Una Vez', genre: 'jazz' });
  const t = p.top();
  assert.deepEqual(t.artistas.map((a) => a.name), ['Cuco', 'Grupo Frontera']);
  assert.deepEqual(t.artistas.map((a) => a.n), [3, 2]);
  assert.deepEqual(t.generos.map((g) => g.id), ['indie', 'grupero']);
  assert.ok(!JSON.stringify(t).includes('Solo Una Vez'));
});

test('registrar ignora lo inválido y los «géneros» internos del motor (search, podcast, lista)', () => {
  const { p } = crear({ minimo: 1 });
  p.registrar(null); p.registrar({}); p.registrar({ channel: '', genre: 'jazz' });
  p.registrar({ channel: 'Artista', genre: 'search' });
  p.registrar({ channel: 'Artista', genre: '../../etc' });
  const t = p.top();
  assert.deepEqual(t.artistas.map((a) => a.name), ['Artista']);
  assert.equal(t.artistas[0].n, 2, 'el artista cuenta aunque el género no sirva');
  assert.deepEqual(t.generos, [], 'ni «search» ni un id raro cuentan como género');
});

test('ventana móvil: lo de hace más de N días ya no cuenta', () => {
  const { p, reloj } = crear({ dias: 7 });
  for (let i = 0; i < 5; i++) p.registrar({ channel: 'Viejo', genre: 'rock' });
  reloj.t += 8 * DIA;
  for (let i = 0; i < 2; i++) p.registrar({ channel: 'Nuevo', genre: 'pop' });
  assert.deepEqual(p.top().artistas.map((a) => a.name), ['Nuevo']);
});

test('se guarda en disco y se recupera; el archivo no trae nada personal', () => {
  const { p, dir, reloj } = crear();
  for (let i = 0; i < 3; i++) p.registrar({ channel: 'Cuco', genre: 'indie' });
  p.guardar();
  const texto = fs.readFileSync(path.join(dir, 'popularidad.json'), 'utf8');
  assert.ok(!/sid|user|usuario|nomina|ip/i.test(texto.replace(/"indie"/g, '')), 'sin identificadores');
  const otra = createPopularidad({ dir, now: () => reloj.t, minimo: 2, guardarCadaMs: 0 });
  assert.deepEqual(otra.top().artistas.map((a) => a.name), ['Cuco']);
});

test('un archivo dañado no tumba nada', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'play-pop-'));
  fs.writeFileSync(path.join(dir, 'popularidad.json'), '{no es json');
  const p = createPopularidad({ dir, minimo: 1 });
  assert.deepEqual(p.top(), { artistas: [], generos: [] });
  p.registrar({ channel: 'A', genre: 'jazz' });
  assert.equal(p.top().artistas.length, 1);
});

test('tope de artistas distintos por día: no crece sin límite', () => {
  const { p } = crear({ minimo: 1, maxPorDia: 20 });
  for (let i = 0; i < 100; i++) p.registrar({ channel: 'Artista ' + i, genre: 'pop' });
  assert.ok(p.top({ n: 1000 }).artistas.length <= 20);
});

test('top({ n }) limita la lista', () => {
  const { p } = crear({ minimo: 1 });
  for (let i = 0; i < 10; i++) p.registrar({ channel: 'A' + i, genre: 'pop' });
  assert.equal(p.top({ n: 3 }).artistas.length, 3);
});

test('/api/next anota solo artista y género de lo que se sirve (nada de sesión, cuenta ni IP)', async () => {
  const { withServer } = require('./helpers/servidor');
  const anotado = [];
  const radio = { next: async () => ({ track: { id: 'aaaaaaaaaaa', title: 'T', channel: 'Cuco - Topic' }, genre: { id: 'indie', label: 'Indie' } }) };
  await withServer({ radio, ytdlp: { resolve: async () => ({}), version: () => '1' }, popularidad: { registrar: (x) => anotado.push(x) } }, async (s, c) => {
    const r = await c.call('GET', '/api/next?sid=abcdefgh1234');
    assert.equal(r.status, 200);
    assert.deepEqual(anotado, [{ channel: 'Cuco - Topic', genre: 'indie' }]);
  });
});
