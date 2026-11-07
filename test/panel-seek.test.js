'use strict';
/* Orden { cmd:'seek', t } del motor (app.js) para la barra de progreso de /panel, y la duración en getState().
   Corre app.js de verdad con un DOM de mentira (mismo arnés que test/panel-cola.test.js). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const U = require('../public/js/util');

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

function cargarMotor(search) {
  const els = new Map();
  const fetchImpl = async (url) => {
    const u = new URL(String(url), 'http://x');
    if (!u.pathname.startsWith('/api/next')) return { ok: true, json: async () => ({}) };
    return { ok: true, json: async () => ({ track: { id: 'aaaaaaaaa01', title: 'Tema', channel: 'c', duration: 200 }, genre: { id: 'jazz', label: 'Jazz', emoji: '🎷', color: '#fff' }, genreChanged: true }) };
  };
  const sandbox = {
    console, URLSearchParams, URL, Date, Math, JSON, Promise, Number, Array, Object, String, Error,
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, requestAnimationFrame: () => 0,
    performance: { now: () => 0 },
    fetch: fetchImpl,
    location: { search, pathname: '/', origin: 'http://x', hostname: 'x', port: '' },
    document: { getElementById: (id) => { if (!els.has(id)) els.set(id, fakeEl()); return els.get(id); }, querySelectorAll: () => [], querySelector: () => fakeEl(), createElement: () => fakeEl(), addEventListener() {}, body: fakeEl(), documentElement: fakeEl(), title: '', hidden: false },
    navigator: {}, localStorage: { getItem: () => null, setItem() {} },
    addEventListener() {}, parent: { postMessage() {} },
    Audio: function () { return fakeEl(); }, MediaMetadata: function () {}
  };
  sandbox.window = sandbox; sandbox.Util = { ...U, setEmoji() {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8'), sandbox, { filename: 'app.js' });
  return { player: sandbox.__player, media: () => els.get('media') };
}
const esperar = async (cond, ms = 2000) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error('tiempo agotado'); await new Promise((r) => setTimeout(r, 5)); } };

test("seek: mueve la canción al segundo pedido y getState() trae la duración", async () => {
  const m = cargarMotor('?view=local&sid=sesionprueba1');
  assert.equal(m.player.getState().duration, 0, 'sin canción, duración 0');
  m.player.handleCommand({ cmd: 'random' });
  await esperar(() => m.player.getState().track);
  assert.equal(m.player.getState().duration, 200);
  m.player.handleCommand({ cmd: 'seek', t: 80 });
  assert.equal(m.media().currentTime, 80);
  assert.equal(m.player.getState().time, 80);
});

test('seek: valida el número (texto, NaN, negativos, Infinity) y no pasa del final', async () => {
  const m = cargarMotor('?view=local&sid=sesionprueba1');
  m.player.handleCommand({ cmd: 'random' });
  await esperar(() => m.player.getState().track);
  m.player.handleCommand({ cmd: 'seek', t: 50 });
  for (const t of ['120', NaN, -1, Infinity, null, undefined, {}]) {
    m.player.handleCommand({ cmd: 'seek', t });
    assert.equal(m.media().currentTime, 50, 'ignora t=' + String(t));
  }
  m.player.handleCommand({ cmd: 'seek', t: 5000 });
  assert.ok(m.media().currentTime < 200 && m.media().currentTime >= 199, 'se queda justo antes del final: ' + m.media().currentTime);
});

test('seek: sin canción no hace nada', () => {
  const m = cargarMotor('?view=local&sid=sesionprueba1');
  m.player.handleCommand({ cmd: 'seek', t: 30 });
  assert.equal(m.media().currentTime, 0);
});
