'use strict';
/* Orden 'anuncio' del motor (app.js): solo en pantallas (no en /panel), baja la música, suena el mp3 y la regresa; sin encimarse. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const U = require('../public/js/util');

/* DOM mínimo: cualquier elemento acepta cualquier propiedad; getElementById devuelve SIEMPRE el mismo por id (para leer media.volume). */
function fakeEl() {
  const store = { classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, style: { setProperty() {} }, dataset: {}, children: [] };
  return new Proxy(function () {}, {
    get(_, k) {
      if (k in store) return store[k];
      if (k === 'paused') return store.paused !== false;
      if (k === 'currentTime') return store.currentTime || 0;
      if (k === 'duration') return NaN;
      if (k === 'hidden') return true;
      if (k === 'value') return store.value || '0';
      if (k === 'firstElementChild') return fakeEl();
      if (k === 'play') return () => { store.paused = false; return Promise.resolve(); };
      if (k === 'pause') return () => { store.paused = true; };
      if (k === 'getAttribute') return () => null;
      if (k === 'querySelector') return () => fakeEl();
      if (k === 'querySelectorAll') return () => [];
      if (k === 'getContext') return () => fakeEl();
      return typeof k === 'string' ? () => undefined : undefined;
    },
    set(_, k, v) { store[k] = v; return true; },
    apply() { return undefined; }
  });
}

/* Audio de mentira: registra cada clip y deja terminarlo a mano. */
function audios() {
  const lista = [];
  function Audio(src) {
    const h = {};
    const a = { src, volume: 1, play: () => Promise.resolve(), pause() {}, addEventListener: (ev, fn) => { h[ev] = fn; }, terminar: () => h.ended && h.ended(), fallar: () => h.error && h.error() };
    lista.push(a);
    return a;
  }
  return { Audio, lista };
}

const reales = new Set();
function cargarMotor(search) {
  const els = new Map();
  const { Audio, lista } = audios();
  const fetchImpl = async () => ({ ok: false, status: 503, json: async () => ({}) });
  const sandbox = {
    console, URLSearchParams, URL, Date, Math, JSON, Promise, Number, Array, Object, String, Error,
    /* solo el desvanecimiento (cada 40 ms) corre de verdad; el resto de los temporizadores del motor no hace falta aquí */
    setTimeout: () => 0, clearTimeout() {},
    setInterval: (fn, ms) => { if (ms !== 40) return 0; const id = setInterval(fn, 5); id.unref(); reales.add(id); return id; },
    clearInterval: (id) => { if (id) clearInterval(id); },
    requestAnimationFrame: () => 0,
    performance: { now: () => Date.now() * 8 }, /* el tiempo corre 8× más rápido: el desvanecimiento dura poco */
    fetch: fetchImpl,
    location: { search, pathname: '/', origin: 'http://x', hostname: 'x', port: '' },
    document: { getElementById: (id) => { if (!els.has(id)) els.set(id, fakeEl()); return els.get(id); }, querySelectorAll: () => [], querySelector: () => fakeEl(), createElement: () => fakeEl(), addEventListener() {}, body: fakeEl(), documentElement: fakeEl(), title: '', hidden: false },
    navigator: {}, localStorage: { getItem: () => null, setItem() {} },
    addEventListener() {}, parent: { postMessage() {} },
    Audio, MediaMetadata: function () {}
  };
  sandbox.window = sandbox; sandbox.Util = { ...U, setEmoji() {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8'), sandbox, { filename: 'app.js' });
  return { player: sandbox.__player, clips: lista, media: () => els.get('media') };
}

const esperar = async (cond, ms = 3000) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error('tiempo agotado'); await new Promise((r) => setTimeout(r, 5)); } };
const anuncios = (clips) => clips.filter((a) => /\/api\/anuncio\//.test(a.src));

test("anuncio: en una pantalla baja la música, suena /api/anuncio/:id y después la regresa", async () => {
  const m = cargarMotor('');
  const vol0 = m.media().volume;
  assert.ok(vol0 > 0.5, 'arranca con el volumen normal: ' + vol0);
  m.player.handleCommand({ cmd: 'anuncio', id: 'abcdef12', nombre: 'Pausa activa' });
  await esperar(() => anuncios(m.clips).length === 1);
  const clip = anuncios(m.clips)[0];
  assert.equal(clip.src, '/api/anuncio/abcdef12');
  assert.ok(m.media().volume < vol0 * 0.2, 'la música está abajo mientras suena: ' + m.media().volume);
  clip.terminar();
  await esperar(() => Math.abs(m.media().volume - vol0) < 1e-9);
});

test('anuncio: no se encima con otro; el segundo que llega mientras suena el primero se descarta', async () => {
  const m = cargarMotor('');
  m.player.handleCommand({ cmd: 'anuncio', id: 'abcdef12' });
  await esperar(() => anuncios(m.clips).length === 1);
  m.player.handleCommand({ cmd: 'anuncio', id: '0000ffff' });
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(anuncios(m.clips).length, 1);
  anuncios(m.clips)[0].fallar(); /* si el audio falla también se libera (cuando la música ya regresó del todo) */
  await esperar(() => Math.abs(m.media().volume - 0.8) < 1e-9);
  await new Promise((r) => setTimeout(r, 10));
  m.player.handleCommand({ cmd: 'anuncio', id: '0000ffff' });
  await esperar(() => anuncios(m.clips).length === 2);
  assert.equal(anuncios(m.clips)[1].src, '/api/anuncio/0000ffff');
  anuncios(m.clips)[1].terminar();
});

test('anuncio: con ?t= la clave viaja en la dirección del audio', async () => {
  const m = cargarMotor('?t=secreto');
  m.player.handleCommand({ cmd: 'anuncio', id: 'abcdef12' });
  await esperar(() => anuncios(m.clips).length === 1);
  assert.equal(anuncios(m.clips)[0].src, '/api/anuncio/abcdef12?t=secreto');
  anuncios(m.clips)[0].terminar();
});

test('anuncio: el motor de /panel (oyente) NO lo reproduce, ni se aceptan ids inválidos', async () => {
  const local = cargarMotor('?view=local&sid=sesionprueba1');
  local.player.handleCommand({ cmd: 'anuncio', id: 'abcdef12' });
  const pantalla = cargarMotor('');
  for (const id of ['../../etc', 'ABCDEF12', 'abc', '', undefined]) pantalla.player.handleCommand({ cmd: 'anuncio', id });
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(anuncios(local.clips).length, 0);
  assert.equal(anuncios(pantalla.clips).length, 0);
  assert.ok(local.media().volume > 0.5 && pantalla.media().volume > 0.5, 'la música no se tocó');
});
