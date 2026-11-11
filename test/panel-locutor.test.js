'use strict';
/* Locutor «Estás escuchando…» y espera amable (public/js/panel/locutor-logica.js): lógica pura, sin DOM ni voz real. */
const test = require('node:test');
const assert = require('node:assert/strict');
const LO = require('../public/js/panel/locutor-logica');

test('primerSonido: el primer momento en que SUENA música nueva tras la petición', () => {
  const suena = (id, extra = {}) => ({ track: { id }, loading: false, paused: false, time: 0.8, ...extra });
  assert.equal(LO.primerSonido('viejo', suena('nuevo')), true);
  assert.equal(LO.primerSonido('viejo', suena('viejo')), false, 'sigue la canción anterior: aún no es la pedida');
  assert.equal(LO.primerSonido('', suena('nuevo')), true, 'no sonaba nada antes');
  assert.equal(LO.primerSonido('viejo', suena('nuevo', { loading: true })), false, 'todavía carga');
  assert.equal(LO.primerSonido('viejo', suena('nuevo', { paused: true })), false, 'en pausa no suena');
  assert.equal(LO.primerSonido('viejo', suena('nuevo', { time: 0 })), false, 'aún no avanza el tiempo');
  assert.equal(LO.primerSonido('viejo', null), false);
  assert.equal(LO.primerSonido('viejo', { loading: false }), false);
});

test('nivelDuck: la música baja solo mientras habla la voz', () => {
  assert.equal(LO.nivelDuck(true), LO.DUCK);
  assert.equal(LO.nivelDuck(false), 1);
  assert.ok(LO.DUCK > 0 && LO.DUCK < 0.5);
});

test('mensajeEspera: cada vez más claro según pasa el tiempo; nunca vacío y sin tecnicismos', () => {
  const base = 'Buscando canciones que sí se pueden reproducir…';
  assert.equal(LO.mensajeEspera(base, 0), base, 'al inicio, el texto de quien pidió');
  assert.equal(LO.mensajeEspera(base, 2), base);
  assert.notEqual(LO.mensajeEspera(base, 5), base);
  assert.notEqual(LO.mensajeEspera(base, 5), LO.mensajeEspera(base, 12));
  assert.notEqual(LO.mensajeEspera(base, 12), LO.mensajeEspera(base, 25));
  for (const s of [0, 1, 4, 8, 15, 30, 90, 1000]) {
    const m = LO.mensajeEspera(base, s);
    assert.ok(typeof m === 'string' && m.length > 5, 's=' + s);
    assert.ok(!/yt-dlp|sondeo|timeout|error/i.test(m), m);
  }
  assert.match(LO.mensajeEspera('', 1), /un momento/i, 'sin texto propio hay uno por defecto');
  assert.match(LO.mensajeEspera(base, 25), /ocultar/i, 'tras mucho tiempo se recuerda que se puede ocultar');
  assert.equal(LO.mensajeEspera(base, NaN), base);
  assert.equal(LO.mensajeEspera(base, -3), base);
});

test('miniclip: solo con ratón, sin «reducir movimiento» ni ahorro de datos', () => {
  const ok = { hover: true, reducido: false, ahorro: false };
  assert.equal(LO.puedeMiniclip(ok), true);
  assert.equal(LO.puedeMiniclip({ ...ok, hover: false }), false, 'táctil: solo carátula');
  assert.equal(LO.puedeMiniclip({ ...ok, reducido: true }), false);
  assert.equal(LO.puedeMiniclip({ ...ok, ahorro: true }), false);
  assert.equal(LO.puedeMiniclip(null), false);
});

test('inicioClip: arranca a ~25 % (máx. 30 s) y deja margen para el clip; clips cortos desde el principio', () => {
  assert.equal(LO.inicioClip(240), 30);
  assert.equal(LO.inicioClip(60), 15);
  assert.equal(LO.inicioClip(8), 0, 'casi tan corto como el clip (5 s): desde el inicio');
  assert.equal(LO.inicioClip(0), 0);
  assert.equal(LO.inicioClip(NaN), 0);
  assert.equal(LO.inicioClip(undefined), 0);
  assert.equal(LO.CLIP_SEG, 5, 'WCAG 2.2.2: un movimiento automático de más de 5 s necesita control');
});

test('debeHablar: el locutor respeta el silencio de la persona (mute, volumen 0, apagado en Apariencia)', () => {
  assert.equal(LO.debeHablar({ activo: true, silenciado: false, volumen: 85 }), true);
  assert.equal(LO.debeHablar({ activo: false, silenciado: false, volumen: 85 }), false, 'apagado');
  assert.equal(LO.debeHablar({ activo: true, silenciado: true, volumen: 85 }), false, 'silenciado');
  assert.equal(LO.debeHablar({ activo: true, silenciado: false, volumen: 0 }), false, 'volumen 0');
  assert.equal(LO.debeHablar({ activo: true, silenciado: false, volumen: NaN }), false);
  assert.equal(LO.debeHablar(null), false);
});

test('volumenVoz: sigue al volumen de la persona (sin el mínimo de 50 % de antes)', () => {
  assert.equal(LO.volumenVoz(85), 0.85);
  assert.equal(LO.volumenVoz(20), 0.2);
  assert.equal(LO.volumenVoz(150), 1);
  assert.equal(LO.volumenVoz(-5), 0);
  assert.equal(LO.volumenVoz('x'), 0);
});

test('debeJingle: «Estás escuchando Radio Deacero» suena solo al empezar (una vez) y respeta el silencio de la persona', () => {
  const base = { activo: true, silenciado: false, volumen: 70, yaSono: false };
  assert.equal(LO.debeJingle(base), true);
  assert.equal(LO.debeJingle({ ...base, yaSono: true }), false, 'solo la primera vez');
  assert.equal(LO.debeJingle({ ...base, activo: false }), false);
  assert.equal(LO.debeJingle({ ...base, silenciado: true }), false);
  assert.equal(LO.debeJingle({ ...base, volumen: 0 }), false);
  assert.equal(LO.debeJingle(null), false);
});
