'use strict';
/* El radio en modo `viaje`: una sesión sigue las 5 fases del plan y luego continúa; las demás no se enteran. */
const test = require('node:test');
const assert = require('node:assert/strict');
const genres = require('../data/genres.json');
const { createRadio } = require('../src/radio');
const B = require('../src/bienestar');

const seeded = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const VACIO = { generos: { gustan: [], evitar: [] }, artistas: { gustan: [], evitar: [] }, total: 0 };
const porConsulta = new Map(genres.flatMap((g) => g.queries.map((q) => [q, g.id])));
const TONOS = / (relaxing|focus|chill|happy|upbeat)$/; /* en un viaje la consulta lleva el tono de la fase al final */
const consultas = [];

let n = 0;
const mk = (over = {}) => createRadio({
  genres, rng: seeded(11),
  /* cada búsqueda trae 5 canciones nuevas; el canal dice de qué género vinieron */
  search: async (q) => { consultas.push(q); const gid = porConsulta.get(q) || porConsulta.get(q.replace(TONOS, '')); return Array.from({ length: 5 }, (_, k) => ({ id: ('v' + String(++n).padStart(10, '0')).slice(-11), title: `${gid} canción ${n}-${k}`, channel: gid, duration: 200 })); },
  ...over
});
const plan = (o = {}) => B.planViaje({ estado: 'estresado', destino: 'relajar', duracion: 'corta', genres, taste: VACIO, rng: seeded(5), ...o });
const sacar = async (r, session, k) => { const out = []; for (let i = 0; i < k; i++) out.push(await r.next({ session })); return out; };

test('el viaje recorre las 5 fases, temasPorFase canciones en cada una', async () => {
  const r = mk(); const p = plan(); // corta = 2 temas
  r.startViaje('sesion-viaje', p, VACIO);
  const xs = await sacar(r, 'sesion-viaje', 10);
  xs.forEach((x, i) => {
    const fase = Math.floor(i / 2);
    assert.equal(x.viaje.fase, fase + 1, `canción ${i}`);
    assert.equal(x.viaje.tema, (i % 2) + 1);
    assert.equal(x.viaje.porFase, 2);
    assert.equal(x.viaje.continuando, false);
    assert.ok(p.fases[fase].generos.some((g) => g.id === x.track.channel), `${x.track.channel} debería ser de la fase ${fase + 1}`);
  });
});

test('trae la energía y el nombre de la fase para mostrarlos', async () => {
  const r = mk(); const p = plan();
  r.startViaje('sesion-viaje', p, VACIO);
  const [x] = await sacar(r, 'sesion-viaje', 1);
  assert.equal(x.viaje.nombre, p.fases[0].nombre);
  assert.equal(x.viaje.energia, p.fases[0].energia);
});

test('al terminar sigue sonando (continuación) sin silencio ni repetir canciones', async () => {
  const r = mk(); const p = plan();
  r.startViaje('sesion-viaje', p, VACIO);
  const xs = await sacar(r, 'sesion-viaje', 40);
  assert.ok(xs.slice(10).every((x) => x.viaje.continuando === true));
  assert.equal(new Set(xs.map((x) => x.track.id)).size, 40);
  const fin = p.fases[4].energia;
  for (const x of xs.slice(10)) { const g = genres.find((q) => q.id === x.track.channel); assert.ok(Math.abs(g.energy - fin) <= 0.45, `${g.id} ${g.energy} vs ${fin}`); }
});

test('dos oyentes con viajes distintos no se afectan, ni a las pantallas', async () => {
  const r = mk();
  const a = plan({ estado: 'estresado', destino: 'dormir' }), b = plan({ estado: 'agotado', destino: 'energia' });
  r.startViaje('oyente-uno', a, VACIO); r.startViaje('oyente-dos', b, VACIO);
  const [x1, y1, x2, y2] = [await r.next({ session: 'oyente-uno' }), await r.next({ session: 'oyente-dos' }), await r.next({ session: 'oyente-uno' }), await r.next({ session: 'oyente-dos' })];
  assert.equal(x1.viaje.fase, 1); assert.equal(y1.viaje.fase, 1); assert.equal(x2.viaje.tema, 2); assert.equal(y2.viaje.tema, 2);
  assert.ok(a.fases[0].generos.some((g) => g.id === x1.track.channel));
  assert.ok(b.fases[0].generos.some((g) => g.id === y1.track.channel));
  const pantalla = await r.next({});
  assert.equal(pantalla.viaje, undefined, 'la sesión principal (pantallas) sigue con su rotación');
  const sinViaje = await r.next({ session: 'oyente-tres' });
  assert.equal(sinViaje.viaje, undefined);
});

test('detener el viaje devuelve la rotación aleatoria de esa sesión', async () => {
  const r = mk();
  r.startViaje('sesion-viaje', plan(), VACIO);
  assert.ok((await r.next({ session: 'sesion-viaje' })).viaje);
  assert.equal(r.stopViaje('sesion-viaje'), true);
  assert.equal((await r.next({ session: 'sesion-viaje' })).viaje, undefined);
  assert.equal(r.stopViaje('sesion-viaje'), false);
  assert.equal(r.viajeInfo('sesion-viaje'), null);
});

test('pedir un género a mano cancela el viaje (el usuario manda)', async () => {
  const r = mk();
  r.startViaje('sesion-viaje', plan(), VACIO);
  await r.next({ session: 'sesion-viaje' });
  const x = await r.next({ session: 'sesion-viaje', genre: 'jazz' });
  assert.equal(x.genre.id, 'jazz');
  assert.equal(x.viaje, undefined);
  assert.equal(r.viajeInfo('sesion-viaje'), null);
});

test('una búsqueda es pauta única: el viaje sigue donde iba', async () => {
  const r = mk({ search: async (q) => (porConsulta.has(q) ? Array.from({ length: 5 }, (_, k) => ({ id: ('b' + String(++n).padStart(10, '0')).slice(-11), title: `${porConsulta.get(q)} c${n}-${k}`, channel: porConsulta.get(q), duration: 200 })) : [{ id: 'busqueda001', title: 'lo que pedí', channel: 'x', duration: 100 }]) });
  r.startViaje('sesion-viaje', plan(), VACIO);
  const a = await r.next({ session: 'sesion-viaje' });
  const q = await r.next({ session: 'sesion-viaje', query: 'algo especial' });
  const c = await r.next({ session: 'sesion-viaje' });
  assert.equal(a.viaje.tema, 1);
  assert.equal(q.viaje, undefined);
  assert.equal(c.viaje.tema, 2, 'la búsqueda no gastó un tema del viaje');
});

test('no repite la "misma" canción con otro sufijo (En vivo, Remaster, Official Video)', async () => {
  /* 4 canciones distintas, cada una con varias versiones del mismo título */
  const titulos = ['Mi Canción', 'Mi Canción (En vivo)', 'Mi Canción - Remastered 2011', 'Mi Canción [Official Video]',
    'Otra Distinta', 'Otra Distinta (Live)', 'Tercera', 'Tercera (Remaster)', 'Cuarta', 'Cuarta [Official Audio]'];
  const r = mk({ search: async () => titulos.map((t) => ({ id: ('f' + String(++n).padStart(10, '0')).slice(-11), title: t, channel: 'c', duration: 200 })) });
  r.startViaje('sesion-viaje', plan({ duracion: 'larga' }), VACIO);
  const vistas = [];
  for (let i = 0; i < 4; i++) vistas.push(B.firma((await r.next({ session: 'sesion-viaje' })).track.title));
  assert.equal(new Set(vistas).size, 4, 'las 4 son canciones distintas: ' + vistas.join(' | '));
});

test('si un género no da canciones, prueba con los otros de la fase en vez de fallar', async () => {
  const p = plan();
  const malo = p.fases[0].generos[0].id;
  const r = mk({ search: async (q) => { const gid = porConsulta.get(q); if (gid === malo) return []; return [{ id: ('m' + String(++n).padStart(10, '0')).slice(-11), title: gid + ' ' + n, channel: gid, duration: 200 }]; } });
  r.startViaje('sesion-viaje', p, VACIO);
  for (let i = 0; i < 8; i++) { const x = await r.next({ session: 'sesion-viaje' }); assert.ok(x.track); assert.notEqual(x.track.channel, malo); }
});

test('si ningún género da música lanza NO_SOURCE (el cliente lo avisa), sin colgarse', async () => {
  const r = mk({ search: async () => [] });
  r.startViaje('sesion-viaje', plan(), VACIO);
  await assert.rejects(r.next({ session: 'sesion-viaje' }), (e) => e.code === 'NO_SOURCE');
});

test('startViaje exige una sesión de oyente y un plan válido', () => {
  const r = mk();
  assert.throws(() => r.startViaje('', plan(), VACIO));
  assert.throws(() => r.startViaje('sesion-viaje', { fases: [] }, VACIO));
});

test('cada fase busca sus canciones con el tono de su carácter (relajar → "relaxing"); sin tono, la consulta de siempre', async () => {
  const r = mk(); const p = plan(); /* estresado → relajar: la última fase es «calma» con tono relaxing */
  r.startViaje('sesion-tono', p, VACIO);
  consultas.length = 0;
  await sacar(r, 'sesion-tono', 10);
  const ultima = new Set(p.fases[4].generos.flatMap((g) => genres.find((x) => x.id === g.id).queries));
  const deLaUltima = consultas.filter((q) => ultima.has(q.replace(TONOS, '')));
  assert.ok(deLaUltima.length >= 1, 'buscó canciones de la última fase');
  for (const q of deLaUltima) assert.match(q, / relaxing$/, q);
  consultas.length = 0;
  await r.next({ session: 'otra-sesion-normal' });
  for (const q of consultas) assert.doesNotMatch(q, TONOS, 'la radio normal no cambia sus búsquedas');
});

test('al llegar a la última canción de una fase, prepara en segundo plano la siguiente (con su tono) y resuelve su primera canción', async () => {
  const resueltos = [];
  const r = mk({ resolver: async (id) => { resueltos.push(id); } });
  const p = plan(); /* corta = 2 temas por fase */
  r.startViaje('sesion-precalienta', p, VACIO);
  consultas.length = 0;
  await sacar(r, 'sesion-precalienta', 2); /* fin de la fase 1 */
  await new Promise((ok) => setImmediate(ok));
  const sig = new Set(p.fases[1].generos.flatMap((g) => genres.find((x) => x.id === g.id).queries));
  assert.ok(consultas.some((q) => sig.has(q.replace(TONOS, ''))), 'buscó canciones de la fase 2 antes de que tocara');
  assert.ok(resueltos.length >= 1, 'dejó resuelta al menos una');
});
