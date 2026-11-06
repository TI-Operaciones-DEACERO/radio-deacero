'use strict';
/* Lógica pura de la pestaña Administración (public/js/panel/admin-logica.js): editor de horario, anuncios, ajustes y formatos. */
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../public/js/panel/admin-logica');

const GEN = ['lofi', 'jazz', 'salsa', 'rock', 'cumbia', 'pop', 'bolero', 'banda', 'trova', 'house', 'techno', 'ambient', 'tango'];
const bloque = (extra = {}) => ({ dias: [1, 2, 3, 4, 5], desde: '09:00', hasta: '11:30', generos: ['lofi', 'jazz'], ...extra });
const horario = (extra = {}) => ({ modo: 'horario', jornada: { inicio: 7, fin: 19 }, bloques: [bloque()], ...extra });

test('hhmm y aMinutos: horas válidas 00:00–23:59 (y 24:00 solo como fin)', () => {
  assert.equal(A.hhmm('09:05'), true);
  assert.equal(A.hhmm('23:59'), true);
  assert.equal(A.hhmm('24:00'), false);
  assert.equal(A.hhmm('24:00', true), true);
  assert.equal(A.hhmm('9:05'), false);
  assert.equal(A.hhmm('12:60'), false);
  assert.equal(A.hhmm(null), false);
  assert.equal(A.aMinutos('01:30'), 90);
  assert.equal(A.aMinutos('24:00'), 1440);
  assert.equal(A.aMinutos('x'), -1);
});

test('validarHorario: un horario correcto no tiene errores', () => {
  const r = A.validarHorario(horario(), GEN);
  assert.deepEqual(r, { ok: true, errores: [] });
  assert.equal(A.validarHorario(horario({ modo: 'rotacion', bloques: [] }), GEN).ok, true);
  assert.equal(A.validarHorario(horario({ modo: 'musicoterapia', bloques: [] }), GEN).ok, true);
  assert.equal(A.validarHorario(horario({ bloques: [bloque({ mood: 'focus', nombre: 'Mañana' })] }), GEN).ok, true);
});

test('validarHorario: modo, jornada y número de bloques', () => {
  const err = (h) => A.validarHorario(h, GEN).errores;
  assert.ok(err(horario({ modo: 'fiesta' })).some((e) => e.bloque === -1 && /modo/i.test(e.msg)));
  assert.ok(err(horario({ jornada: { inicio: 19, fin: 7 } })).some((e) => /jornada/i.test(e.msg)));
  assert.ok(err(horario({ jornada: { inicio: 7.5, fin: 19 } })).some((e) => /jornada/i.test(e.msg)));
  assert.ok(err(horario({ jornada: { inicio: -1, fin: 25 } })).length);
  assert.ok(err(horario({ jornada: null })).length);
  assert.ok(err(horario({ bloques: Array.from({ length: 21 }, () => bloque()) })).some((e) => /20/.test(e.msg)));
  assert.ok(err(horario({ bloques: [] })).some((e) => /bloque/i.test(e.msg)), 'el modo horario sin bloques no tiene qué seguir');
});

test('validarHorario: cada bloque dice qué le falta, con su número', () => {
  const errs = (b) => A.validarHorario(horario({ bloques: [bloque(), b] }), GEN).errores.filter((e) => e.bloque === 1).map((e) => e.msg).join(' | ');
  assert.match(errs(bloque({ dias: [] })), /día/i);
  assert.match(errs(bloque({ dias: [7] })), /día/i);
  assert.match(errs(bloque({ desde: '25:00' })), /desde/i);
  assert.match(errs(bloque({ hasta: 'x' })), /hasta/i);
  assert.match(errs(bloque({ desde: '12:00', hasta: '11:00' })), /antes/i);
  assert.match(errs(bloque({ generos: [] })), /género/i);
  assert.match(errs(bloque({ generos: GEN.slice(0, 13) })), /12/);
  assert.match(errs(bloque({ generos: ['inventado'] })), /género/i);
  assert.match(errs(bloque({ mood: 'triste' })), /ánimo/i);
  assert.match(errs(bloque({ nombre: 'x'.repeat(41) })), /40/); /* mismo tope que src/horario.js */
  assert.equal(A.validarHorario(horario({ bloques: [bloque({ hasta: '24:00' })] }), GEN).ok, true);
  assert.equal(A.validarHorario(horario({ bloques: [bloque({ generos: ['inventado'] })] }), null).ok, true, 'sin catálogo de géneros no se comprueban los ids');
});

test('limpiarHorario: deja solo lo del contrato (días ordenados y sin repetir, sin campos vacíos)', () => {
  const h = A.limpiarHorario({
    modo: 'horario', jornada: { inicio: '8', fin: 18 }, extra: 1,
    bloques: [{ dias: [5, 1, 1, '3'], desde: '08:00', hasta: '10:00', generos: ['jazz', 'jazz', 'lofi'], mood: '', nombre: '  ', basura: true }]
  });
  assert.deepEqual(h, { modo: 'horario', jornada: { inicio: 8, fin: 18 }, bloques: [{ dias: [1, 3, 5], desde: '08:00', hasta: '10:00', generos: ['jazz', 'lofi'] }] });
  const b = A.limpiarHorario({ modo: 'horario', jornada: { inicio: 7, fin: 19 }, bloques: [bloque({ mood: 'calm', nombre: ' Inicio ' })] }).bloques[0];
  assert.equal(b.mood, 'calm');
  assert.equal(b.nombre, 'Inicio');
});

test('filtrarGeneros: busca sin acentos en nombre e id, excluye los ya elegidos y topa', () => {
  const gs = [{ id: 'bolero', label: 'Boleros' }, { id: 'musica-clasica', label: 'Música clásica' }, { id: 'salsa', label: 'Salsa' }, { id: 'jazz', label: 'Jazz & Soul' }];
  assert.deepEqual(A.filtrarGeneros(gs, 'musica', []).map((g) => g.id), ['musica-clasica']);
  assert.deepEqual(A.filtrarGeneros(gs, 'CLÁSICA', []).map((g) => g.id), ['musica-clasica']);
  assert.deepEqual(A.filtrarGeneros(gs, 'sa', ['salsa']).map((g) => g.id), []);
  assert.equal(A.filtrarGeneros(gs, '', [], 2).length, 2);
  assert.deepEqual(A.filtrarGeneros(null, 'x', []), []);
});

test('validarAnuncio: nombre, días, horas, intervalo (0 o 15–720) y el archivo al crear', () => {
  const ok = { nombre: 'Pausa activa', dias: [1, 3], desde: '10:00', hasta: '16:00', cadaMin: 60 };
  const mp3 = { bytes: 1000, tipo: 'audio/mpeg', archivo: 'pausa.mp3' };
  assert.deepEqual(A.validarAnuncio(ok, mp3), []);
  assert.deepEqual(A.validarAnuncio({ ...ok, cadaMin: 0 }, mp3), []);
  assert.deepEqual(A.validarAnuncio(ok), [], 'al editar no hay archivo');
  assert.ok(A.validarAnuncio({ ...ok, nombre: '  ' }, mp3).some((m) => /nombre/i.test(m)));
  assert.ok(A.validarAnuncio({ ...ok, dias: [] }, mp3).some((m) => /día/i.test(m)));
  assert.ok(A.validarAnuncio({ ...ok, desde: '99:00' }, mp3).some((m) => /hora/i.test(m)));
  assert.ok(A.validarAnuncio({ ...ok, desde: '16:00', hasta: '16:00', cadaMin: 0 }, mp3).some((m) => /antes/i.test(m)), 'el servidor exige desde < hasta siempre');
  assert.ok(A.validarAnuncio({ ...ok, cadaMin: 10 }, mp3).some((m) => /15/.test(m)));
  assert.ok(A.validarAnuncio({ ...ok, cadaMin: 721 }, mp3).some((m) => /720/.test(m)));
  assert.ok(A.validarAnuncio({ ...ok, cadaMin: 30.5 }, mp3).length);
  assert.ok(A.validarAnuncio(ok, { ...mp3, bytes: 5 * 1024 * 1024 + 1 }).some((m) => /5 MB/.test(m)));
  assert.ok(A.validarAnuncio(ok, { ...mp3, bytes: 0 }).length);
  assert.ok(A.validarAnuncio(ok, { bytes: 100, tipo: 'audio/wav', archivo: 'x.wav' }).some((m) => /mp3/i.test(m)));
  assert.deepEqual(A.validarAnuncio(ok, { bytes: 100, tipo: '', archivo: 'X.MP3' }), [], 'algunos sistemas no dan el tipo: basta la extensión');
  assert.ok(A.validarAnuncio(ok, null).length === 0);
  assert.ok(A.validarAnuncio(ok, { archivo: '' }).some((m) => /archivo/i.test(m)));
});

test('base64DeDataUrl: quita el encabezado data:…;base64,', () => {
  assert.equal(A.base64DeDataUrl('data:audio/mpeg;base64,SUQzBA=='), 'SUQzBA==');
  assert.equal(A.base64DeDataUrl('data:;base64,AAAA'), 'AAAA');
  assert.equal(A.base64DeDataUrl('sin coma'), '');
  assert.equal(A.base64DeDataUrl(null), '');
});

test('textoProgramacion: resumen legible de cuándo suena un anuncio', () => {
  assert.equal(A.textoProgramacion({ dias: [1, 2, 3, 4, 5], desde: '09:00', hasta: '17:00', cadaMin: 60 }), 'Lun a Vie · 09:00–17:00 · cada 60 min');
  assert.equal(A.textoProgramacion({ dias: [0, 1, 2, 3, 4, 5, 6], desde: '08:00', hasta: '08:00', cadaMin: 0 }), 'Todos los días · una vez a las 08:00');
  assert.equal(A.textoProgramacion({ dias: [5, 1, 3], desde: '10:00', hasta: '12:00', cadaMin: 90 }), 'Lun, Mié, Vie · 10:00–12:00 · cada 90 min');
  assert.equal(A.textoProgramacion({ dias: [] }), 'Sin días');
  assert.equal(A.textoProgramacion(null), 'Sin días');
});

test('palabrasDeTexto: una por línea o separadas por coma; sin vacías ni repetidas; en minúsculas y con tope', () => {
  assert.deepEqual(A.palabrasDeTexto('Grosería\n  otra ,  OTRA\n\n tercera'), ['grosería', 'otra', 'tercera']);
  assert.deepEqual(A.palabrasDeTexto(''), []);
  assert.deepEqual(A.palabrasDeTexto(null), []);
  assert.equal(A.palabrasDeTexto(Array.from({ length: 400 }, (_, i) => 'p' + i).join('\n')).length, 200);
  assert.equal(A.palabrasDeTexto('x'.repeat(100))[0].length, 40);
});

test('fmtBytes y fmtUptime', () => {
  assert.equal(A.fmtBytes(500), '500 B');
  assert.equal(A.fmtBytes(2048), '2.0 KB');
  assert.equal(A.fmtBytes(5 * 1024 * 1024), '5.0 MB');
  assert.equal(A.fmtBytes(-1), '—');
  assert.equal(A.fmtUptime(59), '59 s');
  assert.equal(A.fmtUptime(3600 * 2 + 60 * 5), '2 h 5 min');
  assert.equal(A.fmtUptime(86400 * 3 + 3600), '3 d 1 h');
  assert.equal(A.fmtUptime('x'), '—');
});

test('resumenDiagnostico: cuenta errores y avisos y marca los servicios con problemas', () => {
  const r = A.resumenDiagnostico({ servicios: [{ servicio: 'ytdlp', errores1h: 3, avisos1h: 1 }, { servicio: 'lrclib', errores1h: 0, avisos1h: 2 }, { servicio: 'proxy', errores1h: 0, avisos1h: 0 }] });
  assert.deepEqual(r, { errores: 3, avisos: 3, conProblemas: ['ytdlp'] });
  assert.deepEqual(A.resumenDiagnostico(null), { errores: 0, avisos: 0, conProblemas: [] });
});
