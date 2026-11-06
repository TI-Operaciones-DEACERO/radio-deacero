'use strict';
/* Lógica pura de la Fase 5 del panel completo (public/js/panel/escucha-logica.js y atajos de logica.js):
   búsqueda, letras (línea activa y desplazamiento proporcional), visualizador sintético, Naturaleza y atajos de teclado. */
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../public/js/panel/escucha-logica');
const L = require('../public/js/panel/logica');

const ID = (n) => String(n).padStart(11, 'a');

/* ───────────── búsqueda ───────────── */
test('consultaBusqueda: recorta, junta espacios, exige 2 caracteres y topa en 100', () => {
  assert.equal(E.consultaBusqueda('  soda   stereo  '), 'soda stereo');
  assert.equal(E.consultaBusqueda(' a '), '');
  assert.equal(E.consultaBusqueda(''), '');
  assert.equal(E.consultaBusqueda(null), '');
  assert.equal(E.consultaBusqueda(42), '');
  assert.equal(E.consultaBusqueda('x'.repeat(300)).length, 100);
});

test('limpiarResultados: solo canciones válidas, campos conocidos y máximo 10', () => {
  assert.deepEqual(E.limpiarResultados(null), []);
  assert.deepEqual(E.limpiarResultados({ error: 'x' }), []);
  const out = E.limpiarResultados([
    { id: ID(1), title: 'Uno', channel: 'Canal', duration: 200, extra: '<b>' },
    { id: 'malo', title: 'x' },
    { id: ID(2), title: '   ' },
    { id: ID(3), title: 'Tres', channel: 7, duration: -4 },
    null, 'texto'
  ]);
  assert.deepEqual(out, [
    { id: ID(1), title: 'Uno', channel: 'Canal', duration: 200 },
    { id: ID(3), title: 'Tres', channel: '', duration: 0 }
  ]);
  assert.equal(E.limpiarResultados(Array.from({ length: 30 }, (_, i) => ({ id: ID(i), title: 'T' + i }))).length, 10);
});

test('mensajeBusqueda: mensajes amables por error del contrato', () => {
  assert.match(E.mensajeBusqueda(400, 'FALTA_Q'), /escribe/i);
  assert.match(E.mensajeBusqueda(429), /espera/i);
  assert.match(E.mensajeBusqueda(503, 'SIN_CONEXION'), /internet|conexi/i);
  assert.match(E.mensajeBusqueda(0), /conexi/i);
  assert.equal(typeof E.mensajeBusqueda(500), 'string');
});

/* ───────────── letras ───────────── */
test('normalizarLetra: acepta synced con `time` (contrato) o `t` (servidor actual), texto plano o nada', () => {
  const a = E.normalizarLetra({ synced: [{ time: 12.5, text: 'B' }, { time: 1, text: 'A' }, { time: 'x', text: 'mal' }, { time: 3, text: '' }], plain: 'A\nB' });
  assert.equal(a.tipo, 'synced');
  assert.deepEqual(a.lineas, [{ t: 1, text: 'A' }, { t: 12.5, text: 'B' }]); /* ordenadas; sin las inválidas ni vacías */
  const b = E.normalizarLetra({ synced: [{ t: 4, text: 'X' }], plain: null });
  assert.deepEqual(b.lineas, [{ t: 4, text: 'X' }]);
  const c = E.normalizarLetra({ synced: null, plain: 'Hola\r\n\r\nmundo\n' });
  assert.equal(c.tipo, 'plain');
  assert.deepEqual(c.lineas, [{ t: null, text: 'Hola' }, { t: null, text: '' }, { t: null, text: 'mundo' }]);
  assert.equal(E.normalizarLetra(null).tipo, 'ninguna');
  assert.equal(E.normalizarLetra({ synced: [], plain: '   ' }).tipo, 'ninguna');
});

test('lineaActiva: la última línea cuyo tiempo ya pasó; -1 antes de la primera', () => {
  const ls = [{ t: 1 }, { t: 5 }, { t: 9 }];
  assert.equal(E.lineaActiva(ls, 0), -1);
  assert.equal(E.lineaActiva(ls, 1), 0);
  assert.equal(E.lineaActiva(ls, 6.2), 1);
  assert.equal(E.lineaActiva(ls, 999), 2);
  assert.equal(E.lineaActiva([], 3), -1);
  assert.equal(E.lineaActiva(ls, NaN), -1);
});

test('fraccionLetra: proporción del avance con un margen de entrada y de salida, siempre entre 0 y 1', () => {
  assert.equal(E.fraccionLetra(0, 200), 0);
  assert.equal(E.fraccionLetra(5, 200), 0); /* intro: aún no empieza la letra */
  assert.equal(E.fraccionLetra(200, 200), 1);
  assert.equal(E.fraccionLetra(500, 200), 1);
  const mitad = E.fraccionLetra(100, 200);
  assert.ok(mitad > 0.45 && mitad < 0.55, String(mitad));
  assert.equal(E.fraccionLetra(50, 0), 0); /* sin duración no se mueve */
  assert.equal(E.fraccionLetra(NaN, 100), 0);
  assert.ok(E.fraccionLetra(60, 200) < E.fraccionLetra(120, 200)); /* crece con el tiempo */
});

test('lineaProporcional y desplazamientoProporcional: siguen la fracción y no se salen de los límites', () => {
  assert.equal(E.lineaProporcional(0, 200, 40), 0);
  assert.equal(E.lineaProporcional(200, 200, 40), 39);
  assert.equal(E.lineaProporcional(100, 200, 0), -1);
  const m = E.lineaProporcional(100, 200, 40);
  assert.ok(m >= 18 && m <= 21, String(m));
  assert.equal(E.desplazamientoProporcional(0, 200, 2000, 500), 0);
  assert.equal(E.desplazamientoProporcional(200, 200, 2000, 500), 1500);
  assert.equal(E.desplazamientoProporcional(100, 200, 300, 500), 0); /* cabe entera: no se desplaza */
  const d = E.desplazamientoProporcional(100, 200, 2000, 500);
  assert.ok(d > 650 && d < 850, String(d));
});

/* ───────────── visualizador ───────────── */
test('MODOS_VIS: 8 modos con id y nombre únicos', () => {
  assert.equal(E.MODOS_VIS.length, 8);
  assert.equal(new Set(E.MODOS_VIS.map((m) => m.id)).size, 8);
  for (const m of E.MODOS_VIS) assert.ok(m.nombre && typeof m.nombre === 'string');
  assert.equal(E.modoVisValido('nope'), E.MODOS_VIS[0].id);
  assert.equal(E.modoVisValido(E.MODOS_VIS[3].id), E.MODOS_VIS[3].id);
});

test('nivelesSinteticos: n valores entre 0 y 1, deterministas; casi quietos en pausa; más energía = más movimiento', () => {
  const a = E.nivelesSinteticos(12.3, 32, 0.5, true);
  assert.equal(a.length, 32);
  assert.ok(a.every((v) => v >= 0 && v <= 1));
  assert.deepEqual(a, E.nivelesSinteticos(12.3, 32, 0.5, true));
  const media = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  let pausa = 0, baja = 0, alta = 0;
  for (let t = 0; t < 20; t += 0.37) {
    pausa += media(E.nivelesSinteticos(t, 24, 0.9, false));
    baja += media(E.nivelesSinteticos(t, 24, 0.1, true));
    alta += media(E.nivelesSinteticos(t, 24, 0.95, true));
  }
  assert.ok(pausa < baja / 4, 'en pausa casi no se mueve');
  assert.ok(alta > baja, 'más energía, más nivel');
  assert.ok(E.nivelesSinteticos(1, 8, 'basura', true).every((v) => v >= 0 && v <= 1)); /* energía inválida: valor medio */
  assert.deepEqual(E.nivelesSinteticos(1, 0, 0.5, true), []);
});

test('dispositivoLento: con movimiento reducido o pocos núcleos/memoria, el visualizador arranca quieto', () => {
  assert.equal(E.dispositivoLento({ reducido: true, nucleos: 16, memoria: 16 }), true);
  assert.equal(E.dispositivoLento({ nucleos: 4, memoria: 4 }), true); /* Raspberry Pi 4B */
  assert.equal(E.dispositivoLento({ nucleos: 8, memoria: 2 }), true);
  assert.equal(E.dispositivoLento({ nucleos: 8, memoria: 8 }), false);
  assert.equal(E.dispositivoLento({ nucleos: 8 }), false); /* sin dato de memoria (Firefox/Safari) */
  assert.equal(E.dispositivoLento({}), true); /* sin datos: se asume lento (la Pi primero) */
});

/* ───────────── Naturaleza ───────────── */
test('SONIDOS y limpiarMezcla: solo sonidos conocidos con volumen entre 0 y 1', () => {
  const ids = E.SONIDOS.map((s) => s.id);
  for (const id of ['lluvia', 'olas', 'viento', 'bosque', 'rosa', 'marron']) assert.ok(ids.includes(id), id);
  assert.deepEqual(E.limpiarMezcla({ lluvia: 0.5, olas: 3, viento: -1, fuego: 0.4, bosque: 'x', __proto__: { rosa: 1 } }), { lluvia: 0.5, olas: 1, viento: 0 });
  assert.deepEqual(E.limpiarMezcla('basura'), {});
  assert.deepEqual(E.limpiarMezcla(null), {});
});

test('ruido: blanco/rosa/marrón dentro de [-1, 1]; el marrón cambia menos entre muestras que el blanco', () => {
  let s = 1;
  const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  const n = 4000;
  const blanco = E.ruido('blanco', n, rnd), rosa = E.ruido('rosa', n, rnd), marron = E.ruido('marron', n, rnd);
  for (const x of [blanco, rosa, marron]) { assert.equal(x.length, n); assert.ok(Array.from(x).every((v) => v >= -1 && v <= 1)); }
  const paso = (x) => { let d = 0; for (let i = 1; i < x.length; i++) d += Math.abs(x[i] - x[i - 1]); return d / x.length; };
  assert.ok(paso(marron) < paso(rosa) && paso(rosa) < paso(blanco));
  assert.throws(() => E.ruido('azul', 10, rnd));
});

test('impulsoReverb: decae (el final pesa menos que el principio) y no se sale de [-1, 1]', () => {
  const x = E.impulsoReverb(8000, 3, Math.random);
  assert.equal(x.length, 8000);
  const energia = (a, b) => { let e = 0; for (let i = a; i < b; i++) e += x[i] * x[i]; return e; };
  assert.ok(energia(0, 1000) > energia(7000, 8000) * 5);
  assert.ok(Array.from(x).every((v) => v >= -1 && v <= 1));
});

test('temporizador: segundos restantes (nunca negativos) y formato mm:ss', () => {
  assert.equal(E.restante(0, 1000), 0); /* sin temporizador */
  assert.equal(E.restante(10000, 4000), 6);
  assert.equal(E.restante(10000, 20000), 0);
  assert.equal(E.restante(10500, 10000), 1); /* redondea hacia arriba: no dice 0 antes de tiempo */
  assert.equal(E.fmtRestante(0), '0:00');
  assert.equal(E.fmtRestante(65), '1:05');
  assert.equal(E.fmtRestante(3600), '60:00');
  assert.deepEqual(E.MINUTOS_TEMPORIZADOR.slice(0, 1), [0]);
  assert.ok(E.MINUTOS_TEMPORIZADOR.every((m) => Number.isInteger(m) && m >= 0));
});

/* ───────────── atajos de teclado (logica.js: lo usa nucleo.js) ───────────── */
test('atajoDeTecla: espacio, N, L, K, /, 1–9 y ?; mayúsculas y minúsculas', () => {
  const k = (key, extra = {}) => L.atajoDeTecla({ key, tag: 'BODY', ...extra });
  assert.equal(k(' '), 'toggle');
  assert.equal(k('n'), 'next');
  assert.equal(k('N'), 'next');
  assert.equal(k('l'), 'letras');
  assert.equal(k('K'), 'karaoke');
  assert.equal(k('/'), 'buscar');
  assert.equal(k('?'), 'ayuda');
  assert.equal(k('?', { shift: true }), 'ayuda'); /* en muchos teclados "?" lleva Mayús */
  assert.equal(k('1'), 'pestana:1');
  assert.equal(k('9'), 'pestana:9');
  assert.equal(k('0'), null);
  assert.equal(k('x'), null);
  assert.equal(k('Enter'), null);
});

test('atajoDeTecla: nunca dentro de campos de texto ni con Ctrl/Alt/Meta; espacio no roba el clic de botones', () => {
  for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) assert.equal(L.atajoDeTecla({ key: 'n', tag }), null, tag);
  assert.equal(L.atajoDeTecla({ key: 'n', tag: 'DIV', editable: true }), null);
  assert.equal(L.atajoDeTecla({ key: 'n', tag: 'BODY', ctrl: true }), null);
  assert.equal(L.atajoDeTecla({ key: 'n', tag: 'BODY', alt: true }), null);
  assert.equal(L.atajoDeTecla({ key: 'n', tag: 'BODY', meta: true }), null);
  assert.equal(L.atajoDeTecla({ key: 'N', tag: 'BODY', shift: true }), 'next');
  assert.equal(L.atajoDeTecla({ key: ' ', tag: 'BUTTON' }), null);
  assert.equal(L.atajoDeTecla({ key: ' ', tag: 'A' }), null);
  assert.equal(L.atajoDeTecla({ key: ' ', tag: 'DIV', role: 'tab' }), null);
  assert.equal(L.atajoDeTecla({ key: ' ', tag: 'SUMMARY' }), null);
  assert.equal(L.atajoDeTecla({ key: 'n', tag: 'BUTTON' }), 'next'); /* letras sí funcionan con el foco en un botón */
  assert.equal(L.atajoDeTecla(null), null);
});
