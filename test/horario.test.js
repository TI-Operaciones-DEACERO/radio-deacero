'use strict';
/* Fase 6: horario del radio principal (pantallas). Funciones puras: misma entrada → misma salida; la hora es la LOCAL del servidor. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const H = require('../src/horario');

const genres = require('../data/genres.json');
const ids = new Set(genres.map((g) => g.id));
const at = (dia, hh, mm = 0) => new Date(2026, 10, 1 + dia, hh, mm).getTime(); /* 2026-11-01 es domingo → dia 0..6 */

test('aMin / validar: HH:MM y bloques', () => {
  assert.equal(H.aMin('07:30'), 450);
  assert.equal(H.aMin('24:00'), 1440);
  assert.equal(H.aMin('7:3'), null);
  assert.equal(H.aMin('25:00'), null);
  const ok = H.validar({ modo: 'horario', jornada: { inicio: 7, fin: 19 }, bloques: [{ dias: [1, 2], desde: '08:00', hasta: '10:00', generos: ['lofi'] }] }, ids);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.horario.bloques[0].dias, [1, 2]);
  for (const malo of [
    { modo: 'x', bloques: [] },
    { modo: 'horario', bloques: [{ dias: [1], desde: '10:00', hasta: '09:00', generos: ['lofi'] }] },
    { modo: 'horario', bloques: [{ dias: [7], desde: '08:00', hasta: '09:00', generos: ['lofi'] }] },
    { modo: 'horario', bloques: [{ dias: [1], desde: '08:00', hasta: '09:00', generos: ['no-existe'] }] },
    { modo: 'horario', bloques: [{ dias: [1], desde: '08:00', hasta: '09:00', generos: [] }] },
    { modo: 'horario', jornada: { inicio: 19, fin: 7 }, bloques: [] },
    { modo: 'horario', bloques: Array.from({ length: 21 }, () => ({ dias: [1], desde: '08:00', hasta: '09:00', generos: ['lofi'] })) }
  ]) assert.equal(H.validar(malo, ids).ok, false, JSON.stringify(malo).slice(0, 80));
});

test('validar: solo guarda campos conocidos y quita duplicados', () => {
  const r = H.validar({ modo: 'horario', hack: 1, bloques: [{ dias: [1, 1, 3], desde: '08:00', hasta: '09:00', generos: ['lofi', 'lofi'], extra: 'x', nombre: 'Mañana' }] }, ids);
  assert.equal(r.ok, true);
  assert.equal(r.horario.hack, undefined);
  assert.deepEqual(r.horario.bloques[0], { dias: [1, 3], desde: '08:00', hasta: '09:00', generos: ['lofi'], nombre: 'Mañana' });
});

test('bloqueActivo: por día y franja (desde incluido, hasta excluido)', () => {
  const h = { modo: 'horario', bloques: [{ dias: [1], desde: '08:00', hasta: '10:00', generos: ['lofi'] }, { dias: [1, 2], desde: '10:00', hasta: '12:00', generos: ['salsa'] }] };
  assert.equal(H.bloqueActivo(at(1, 8, 0), h).generos[0], 'lofi');
  assert.equal(H.bloqueActivo(at(1, 9, 59), h).generos[0], 'lofi');
  assert.equal(H.bloqueActivo(at(1, 10, 0), h).generos[0], 'salsa');
  assert.equal(H.bloqueActivo(at(2, 11, 0), h).generos[0], 'salsa');
  assert.equal(H.bloqueActivo(at(2, 9, 0), h), null);
  assert.equal(H.bloqueActivo(at(0, 11, 0), h), null);
});

test('moodMusicoterapia: curva de la jornada (calma → foco → ánimo → energía → bajar)', () => {
  const j = { inicio: 7, fin: 19 };
  assert.equal(H.moodMusicoterapia(at(1, 7, 10), j), 'calm');
  assert.equal(H.moodMusicoterapia(at(1, 10, 0), j), 'focus');
  assert.equal(H.moodMusicoterapia(at(1, 12, 30), j), 'uplift');
  assert.equal(H.moodMusicoterapia(at(1, 16, 0), j), 'energy');
  assert.equal(H.moodMusicoterapia(at(1, 18, 30), j), 'winddown');
  assert.equal(H.moodMusicoterapia(at(1, 3, 0), j), 'calm', 'fuera de la jornada: calma');
});

test('seleccion: rotación no limita; horario usa el bloque; musicoterapia elige géneros del mood', () => {
  assert.deepEqual(H.seleccion(at(1, 9), { modo: 'rotacion', bloques: [] }, genres).generos, []);
  const h = { modo: 'horario', bloques: [{ dias: [1], desde: '08:00', hasta: '10:00', generos: ['lofi', 'salsa'] }] };
  assert.deepEqual(H.seleccion(at(1, 9), h, genres).generos, ['lofi', 'salsa']);
  assert.deepEqual(H.seleccion(at(1, 11), h, genres).generos, [], 'fuera de bloque: rotación normal');
  const m = H.seleccion(at(1, 10), { modo: 'musicoterapia', jornada: { inicio: 7, fin: 19 }, bloques: [] }, genres);
  assert.equal(m.mood, 'focus');
  assert.ok(m.generos.length >= 3);
  const byId = new Map(genres.map((g) => [g.id, g]));
  for (const id of m.generos) assert.equal(byId.get(id).mood, 'focus', id);
});

test('generarSemana: ≤ 8 bloques válidos, lunes a viernes, géneros del mood y uno latino al mediodía', () => {
  let s = 1;
  const rng = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const r = H.generarSemana({ jornada: { inicio: 7, fin: 19 }, genres, rng });
  assert.ok(r.length >= 4 && r.length <= 8);
  assert.equal(H.validar({ modo: 'horario', bloques: r }, ids).ok, true);
  const latino = /latin|salsa|cumbia|bachata|reggaet|banda|ranchera|norte|mariachi|regional|grupera/;
  assert.ok(r.some((b) => b.generos.some((g) => latino.test(g))), 'al menos un género latino de día');
  for (const b of r) assert.deepEqual(b.dias, [1, 2, 3, 4, 5]);
  assert.deepEqual(r.map((b) => b.mood), ['calm', 'focus', 'uplift', 'focus', 'energy', 'winddown']);
  /* determinista con la misma semilla */
  s = 1; const r2 = H.generarSemana({ jornada: { inicio: 7, fin: 19 }, genres, rng });
  assert.deepEqual(r2, r);
});

test('createPrograma: guarda en DATA_DIR, valida, y por defecto es la rotación de siempre', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'play-hor-'));
  const reloj = { t: at(1, 9) };
  const p = H.createPrograma({ dir, genres, clock: () => reloj.t });
  assert.equal(p.get().modo, 'rotacion');
  assert.deepEqual(p.seleccion().generos, []);
  assert.equal(p.set({ modo: 'nada' }).ok, false);
  assert.equal(p.set({ modo: 'horario', bloques: [{ dias: [1], desde: '08:00', hasta: '10:00', generos: ['lofi'] }] }).ok, true);
  assert.deepEqual(p.seleccion().generos, ['lofi']);
  reloj.t = at(1, 11);
  assert.deepEqual(p.seleccion().generos, []);
  const p2 = H.createPrograma({ dir, genres, clock: () => at(1, 9) });
  assert.deepEqual(p2.seleccion().generos, ['lofi'], 'sobrevive a un reinicio');
  fs.writeFileSync(path.join(dir, 'horario.json'), '{roto');
  assert.equal(H.createPrograma({ dir, genres }).get().modo, 'rotacion', 'archivo dañado → rotación');
});
