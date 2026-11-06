'use strict';
/* Fase 4: el planificador del Viaje ISO (sin IA, sin red) debe dar un plan válido para CUALQUIER combinación. */
const test = require('node:test');
const assert = require('node:assert/strict');
const genres = require('../data/genres.json');
const B = require('../src/bienestar');

const seeded = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const ids = new Set(genres.map((g) => g.id));
const VACIO = { generos: { gustan: [], evitar: [] }, artistas: { gustan: [], evitar: [] }, total: 0 };

test('catálogo: 18 ánimos en 3 grupos, 6 destinos, 11 estilos, 3 idiomas, 3 duraciones, 3 intensidades', () => {
  const o = B.opciones();
  assert.equal(o.animos.length, 18);
  assert.deepEqual([...new Set(o.animos.map((a) => a.grupo))].sort(), ['Para acompañar', 'Para activar', 'Para calmar']);
  assert.equal(o.destinos.length, 6);
  assert.equal(o.estilos.length, 11);
  assert.equal(o.idiomas.length, 3);
  assert.deepEqual(o.duraciones.map((d) => d.id), ['corta', 'media', 'larga']);
  assert.deepEqual(o.intensidades.map((d) => d.id), ['suave', 'media', 'intensa']);
  for (const a of o.animos) assert.ok(a.id && a.label && a.emoji);
});

test('animoDeTexto: reconoce palabras del texto libre', () => {
  assert.equal(B.animoDeTexto('estoy muy estresado por el trabajo'), 'estresado');
  assert.equal(B.animoDeTexto('me siento agotado'), 'agotado');
  assert.equal(B.animoDeTexto('estoy súper contento!'), 'contento');
  assert.equal(B.animoDeTexto('qwertyuiop'), null);
  assert.equal(B.animoDeTexto(''), null);
  assert.equal(B.animoDeTexto(undefined), null);
});

test('plan básico: 5 fases con energía, géneros reales y temas por duración', () => {
  const p = B.planViaje({ estado: 'estresado', destino: 'relajar', intensidad: 'media', duracion: 'media', genres, taste: VACIO, rng: seeded(1) });
  assert.equal(p.fases.length, 5);
  assert.equal(p.temasPorFase, 3);
  assert.ok(p.analisis && p.cierre && p.destino.label);
  for (const f of p.fases) {
    assert.ok(f.nombre && f.generos.length >= 2);
    for (const g of f.generos) assert.ok(ids.has(g.id));
    assert.ok(f.energia >= 0 && f.energia <= 1);
  }
});

test('plan: la curva parte cerca del ánimo y llega al destino', () => {
  const baja = B.planViaje({ estado: 'estresado', destino: 'dormir', intensidad: 'media', duracion: 'corta', genres, taste: VACIO, rng: seeded(2) });
  assert.ok(baja.fases[0].energia > baja.fases[4].energia + 0.3, 'baja de intensidad');
  assert.ok(baja.fases[4].energia <= 0.25);
  const sube = B.planViaje({ estado: 'agotado', destino: 'energia', intensidad: 'media', duracion: 'corta', genres, taste: VACIO, rng: seeded(2) });
  assert.ok(sube.fases[4].energia > sube.fases[0].energia + 0.3, 'sube');
  assert.ok(sube.fases[0].energia <= 0.4, 'parte del cansancio real, no de golpe en alto');
});

test('plan: sin destino sube hacia ~0.65; sin ánimo reconocido usa uno neutro', () => {
  const p = B.planViaje({ estado: 'agotado', genres, taste: VACIO, rng: seeded(3) });
  assert.ok(Math.abs(p.fases[4].energia - 0.65) <= 0.1);
  const q = B.planViaje({ texto: 'qwerty', destino: 'relajar', genres, taste: VACIO, rng: seeded(3) });
  assert.equal(q.fases.length, 5);
});

test('plan: la intensidad cambia la forma (suave se queda más tiempo cerca del origen)', () => {
  const mk = (intensidad) => B.planViaje({ estado: 'agotado', destino: 'energia', intensidad, duracion: 'media', genres, taste: VACIO, rng: seeded(4) });
  assert.ok(mk('suave').fases[1].energia < mk('intensa').fases[1].energia);
});

test('plan: respeta gustos y evita lo rechazado', () => {
  const taste = { generos: { gustan: ['lofi'], evitar: ['jazz', 'pop'] }, artistas: { gustan: [], evitar: [] }, total: 4 };
  for (let s = 0; s < 15; s++) {
    const p = B.planViaje({ estado: 'estresado', destino: 'relajar', genres, taste, rng: seeded(s) });
    for (const f of p.fases) for (const g of f.generos) assert.ok(!['jazz', 'pop'].includes(g.id));
  }
});

test('plan: es repetible con la misma semilla', () => {
  const a = B.planViaje({ estado: 'ansioso', destino: 'concentrar', genres, taste: VACIO, rng: seeded(9) });
  const b = B.planViaje({ estado: 'ansioso', destino: 'concentrar', genres, taste: VACIO, rng: seeded(9) });
  assert.deepEqual(a, b);
});

test('plan: entradas basura no rompen (se usan valores por defecto)', () => {
  for (const x of [{}, { estado: 5, destino: {}, intensidad: [], duracion: null, estilo: 'x', idioma: 'x' }, { estado: '__proto__', destino: 'constructor' }]) {
    const p = B.planViaje({ ...x, genres, taste: VACIO, rng: seeded(1) });
    assert.equal(p.fases.length, 5);
    assert.equal(p.temasPorFase, 3);
  }
});

/* La matriz completa: 18 ánimos × 6 destinos × 3 intensidades × 11 estilos (× idioma y duración rotando). */
test('MATRIZ: toda combinación da un plan válido', () => {
  const o = B.opciones();
  const temas = { corta: 2, media: 3, larga: 5 };
  let planes = 0, relajados = 0;
  const t0 = Date.now();
  for (const a of o.animos) for (const d of o.destinos) for (const i of o.intensidades) for (const e of o.estilos) {
    const idioma = o.idiomas[planes % 3].id;
    const duracion = o.duraciones[planes % 3].id;
    const p = B.planViaje({ estado: a.id, destino: d.id, intensidad: i.id, duracion, estilo: e.id, idioma, genres, taste: VACIO, rng: seeded(planes) });
    const ctx = `${a.id}/${d.id}/${i.id}/${e.id}`;
    planes++;
    assert.equal(p.fases.length, 5, ctx);
    assert.equal(p.temasPorFase, temas[duracion], ctx);
    const sube = p.fases[4].energia >= p.fases[0].energia;
    for (let k = 0; k < 5; k++) {
      const f = p.fases[k];
      assert.ok(f.generos.length >= 2, `${ctx} fase ${k}: ${f.generos.length} géneros`);
      assert.ok(f.generos.every((g) => ids.has(g.id)), ctx);
      assert.ok(f.energia >= 0 && f.energia <= 1, ctx);
      if (k > 0) {
        const prev = new Set(p.fases[k - 1].generos.map((g) => g.id));
        assert.ok(!f.generos.some((g) => prev.has(g.id)), `${ctx}: fases ${k - 1} y ${k} comparten género`);
        assert.ok(sube ? f.energia >= p.fases[k - 1].energia - 1e-9 : f.energia <= p.fases[k - 1].energia + 1e-9, `${ctx}: la energía no avanza en una sola dirección`);
      }
    }
    if (p.avisos.length) relajados++;
  }
  assert.equal(planes, 18 * 6 * 3 * 11);
  assert.ok(Date.now() - t0 < 20000, 'la matriz entera tarda poco');
  assert.ok(relajados < planes, 'la mayoría no necesita relajar nada');
});

test('estilo inexistente en un destino calmado: se relaja y se AVISA en vez de fallar', () => {
  const p = B.planViaje({ estado: 'estresado', destino: 'dormir', estilo: 'cumbia', idioma: 'espanol', genres, taste: VACIO, rng: seeded(1) });
  assert.ok(p.fases.every((f) => f.generos.length >= 2));
  assert.ok(p.avisos.length >= 1);
  assert.match(p.avisos[0], /afines|estilo|tranquila/i);
});

test('continuación: géneros de la energía final, sin vaciarse', () => {
  const p = B.planViaje({ estado: 'estresado', destino: 'relajar', genres, taste: VACIO, rng: seeded(1) });
  const c = B.generosContinuacion(p, genres, VACIO);
  assert.ok(c.length >= 4);
  for (const g of c) assert.ok(Math.abs(g.energy - p.fases[4].energia) <= 0.45);
});

test('firma de título: "(En vivo)", "(Remaster)" y "[Official Video]" no cuentan como canciones distintas', () => {
  const f = B.firma;
  assert.equal(f('Mi Canción (En vivo)'), f('Mi Canción'));
  assert.equal(f('Mi Canción - Remastered 2011'), f('mi cancion'));
  assert.equal(f('Mi Canción [Official Video]'), f('MI CANCIÓN'));
  assert.equal(f('Mi Canción (Official Audio) ft. Otro'), f('Mi Canción'));
  assert.notEqual(f('Mi Canción'), f('Otra Canción'));
  assert.equal(f(''), '');
});
