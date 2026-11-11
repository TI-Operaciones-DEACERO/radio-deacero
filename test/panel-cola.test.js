'use strict';
/* Cola del motor (orden 'queue' de /panel/completo): limpieza de la lista (util.js) y comportamiento real de app.js con un DOM de mentira. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const U = require('../public/js/util');

const ID = (n) => String(n).padStart(11, 'a');
const song = (n) => ({ track: { id: ID(n), title: 'Tema ' + n, channel: 'Canal', duration: 100 } });

test('cleanQueueItems: deja canciones válidas y consultas; descarta lo demás; recorta y topa en 200', () => {
  assert.deepEqual(U.cleanQueueItems(undefined), []);
  assert.deepEqual(U.cleanQueueItems('x'), []);
  const out = U.cleanQueueItems([song(1), { track: { id: 'mal', title: 'x' } }, { track: { id: ID(2), title: '  ' } }, { q: '  Soda Stereo  ' }, { q: '' }, null, 7, { q: 'y'.repeat(300) }, { track: { id: ID(3), title: 't', channel: 5, duration: -1 } }]);
  assert.equal(out.length, 4);
  assert.deepEqual(out[0], song(1));
  assert.deepEqual(out[1], { q: 'Soda Stereo' });
  assert.equal(out[2].q.length, 100);
  assert.deepEqual(out[3].track, { id: ID(3), title: 't', channel: '', duration: 0 });
  assert.equal(U.cleanQueueItems(Array.from({ length: 500 }, (_, i) => song(i))).length, 200);
});

/* — app.js corriendo con un DOM mínimo: cualquier elemento acepta cualquier propiedad — */
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

function cargarMotor(fetchImpl) {
  const posted = [];
  const sandbox = {
    console, URLSearchParams, URL, Date, Math, JSON, Promise, Number, Array, Object, String, Error,
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, requestAnimationFrame: () => 0,
    performance: { now: () => 0 },
    fetch: fetchImpl,
    location: { search: '?view=local&sid=sesionprueba1', pathname: '/', origin: 'http://x', hostname: 'x', port: '' },
    document: { getElementById: () => fakeEl(), querySelectorAll: () => [], querySelector: () => fakeEl(), createElement: () => fakeEl(), addEventListener() {}, body: fakeEl(), documentElement: fakeEl(), title: '', hidden: false },
    navigator: {}, localStorage: { getItem: () => null, setItem() {} },
    addEventListener() {}, parent: { postMessage: (m) => posted.push(m) },
    Audio: function () { return fakeEl(); }, MediaMetadata: function () {}
  };
  sandbox.window = sandbox; sandbox.Util = { ...U, setEmoji() {} }; /* setEmoji toca el document real */
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8'), sandbox, { filename: 'app.js' });
  return { player: sandbox.__player, posted };
}

/* lo que sale del motor viene de otro contexto de vm: se pasa por JSON para comparar */
const plano = (x) => JSON.parse(JSON.stringify(x));
const esperar = async (cond, ms = 2000) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error('tiempo agotado'); await new Promise((r) => setTimeout(r, 5)); } };

/* /api/next de mentira: cada consulta resuelve a una canción; el resto, al azar con su "viaje" si se pidió. */
function servidorFalso({ viaje = null } = {}) {
  const pedidos = [];
  let n = 100;
  const fetchImpl = async (url) => {
    pedidos.push(String(url));
    const u = new URL(String(url), 'http://x');
    if (!u.pathname.startsWith('/api/next')) return { ok: true, json: async () => ({}) };
    const q = u.searchParams.get('q');
    if (q === 'sin-resultados') return { ok: false, status: 503, json: async () => ({}) };
    const i = q ? Number(q.replace(/\D/g, '')) || 7 : n++;
    const item = { track: { id: ID(i), title: q ? 'Resultado de ' + q : 'Radio ' + i, channel: 'c', duration: 90 }, genre: { id: q ? 'search' : 'jazz', label: 'G', emoji: '🎵', color: '#fff' }, genreChanged: true };
    if (!q && viaje) item.viaje = viaje;
    return { ok: true, json: async () => item };
  };
  return { fetchImpl, pedidos };
}

test('getState: trae el viaje de la pista que suena (de /api/next) y null si no hay', async () => {
  const viaje = { fase: 2, tema: 1, porFase: 3, continuando: false, energia: 0.6, nombre: 'Despertar' };
  const { fetchImpl } = servidorFalso({ viaje });
  const { player } = cargarMotor(fetchImpl);
  assert.equal(player.getState().viaje, null);
  assert.equal(player.getState().cola, null);
  player.handleCommand({ cmd: 'random' });
  await esperar(() => player.getState().track);
  assert.deepEqual(plano(player.getState().viaje), viaje);
  const sin = cargarMotor(servidorFalso().fetchImpl);
  sin.player.handleCommand({ cmd: 'random' });
  await esperar(() => sin.player.getState().track);
  assert.equal(sin.player.getState().viaje, null);
});

test("queue: reproduce en orden, 'next' avanza por la lista y al terminar vuelve la radio", async () => {
  const { fetchImpl, pedidos } = servidorFalso();
  const { player } = cargarMotor(fetchImpl);
  player.handleCommand({ cmd: 'queue', items: [song(1), { q: 'consulta 22' }, song(3)] });
  await esperar(() => player.getState().track);
  assert.equal(player.getState().track.id, ID(1));
  assert.deepEqual(plano(player.getState().cola), { i: 0, total: 3 });
  assert.equal(pedidos.filter((p) => p.includes('/api/next')).length, 0, 'mientras dura la lista no se precarga la radio');

  player.handleCommand({ cmd: 'next' });
  await esperar(() => player.getState().track.id === ID(22));
  assert.equal(player.getState().track.title, 'Resultado de consulta 22'); /* la consulta se resolvió con la búsqueda existente */
  assert.ok(pedidos.some((p) => /q=consulta/.test(p)));
  assert.deepEqual(plano(player.getState().cola), { i: 1, total: 3 });

  player.handleCommand({ cmd: 'next' });
  await esperar(() => player.getState().track.id === ID(3));
  player.handleCommand({ cmd: 'next' }); /* se acabó la lista: sigue la radio normal */
  await esperar(() => /^a+1\d\d$/.test(player.getState().track.id));
  assert.equal(player.getState().cola, null);
});

test('queue: index empieza en esa posición; consultas sin resultado se saltan', async () => {
  const { fetchImpl } = servidorFalso();
  const { player } = cargarMotor(fetchImpl);
  player.handleCommand({ cmd: 'queue', items: [song(1), { q: 'sin-resultados' }, song(3), song(4)], index: 1 });
  await esperar(() => player.getState().track);
  assert.equal(player.getState().track.id, ID(3)); /* la 2.ª no se pudo resolver: pasa a la siguiente */
  assert.deepEqual(plano(player.getState().cola), { i: 2, total: 4 });
});

for (const cancela of [{ cmd: 'genre', id: 'jazz' }, { cmd: 'search', q: 'algo 9' }, { cmd: 'random' }, { cmd: 'track', kind: 'song', track: song(9).track }]) {
  test("queue: se cancela con '" + cancela.cmd + "' y no vuelve a la lista", async () => {
    const { fetchImpl } = servidorFalso();
    const { player } = cargarMotor(fetchImpl);
    player.handleCommand({ cmd: 'queue', items: [song(1), song(2), song(3)] });
    await esperar(() => player.getState().track);
    assert.ok(player.getState().cola);
    player.handleCommand(cancela);
    assert.equal(player.getState().cola, null);
    await esperar(() => player.getState().track.id !== ID(1));
    player.handleCommand({ cmd: 'next' });
    await new Promise((r) => setTimeout(r, 30));
    assert.notEqual(player.getState().track && player.getState().track.id, ID(2), 'no se retoma la lista');
  });
}

test('queue: una lista vacía o inválida cancela la que estaba en curso sin cortar lo que suena', async () => {
  const { player } = cargarMotor(servidorFalso().fetchImpl);
  player.handleCommand({ cmd: 'queue', items: [song(1), song(2)] });
  await esperar(() => player.getState().track);
  player.handleCommand({ cmd: 'queue', items: [] });
  assert.equal(player.getState().cola, null);
  assert.equal(player.getState().track.id, ID(1));
  player.handleCommand({ cmd: 'queue', items: 'basura' });
  player.handleCommand({ cmd: 'queue' });
  assert.equal(player.getState().cola, null);
});

test('queue: "anterior" dentro de la lista vuelve a la pista previa de la lista', async () => {
  const { player } = cargarMotor(servidorFalso().fetchImpl);
  player.handleCommand({ cmd: 'queue', items: [song(1), song(2), song(3)] });
  await esperar(() => player.getState().track);
  player.handleCommand({ cmd: 'next' });
  await esperar(() => player.getState().track.id === ID(2));
  player.handleCommand({ cmd: 'prev' });
  await esperar(() => player.getState().track.id === ID(1));
  assert.deepEqual(plano(player.getState().cola), { i: 0, total: 3 });
});

/* — Lo que elige la persona NO se pierde si el motor sigue con la precarga del arranque (red lenta o sin YouTube): antes
   'track', 'genre', 'search' y 'queue' se descartaban en silencio mientras state.loading estaba encendido. — */
function servidorRadioColgada() {
  const base = servidorFalso();
  let soltar = null;
  const fetchImpl = (url) => {
    const u = new URL(String(url), 'http://x');
    const esRadio = u.pathname.startsWith('/api/next') && !u.searchParams.get('q') && !u.searchParams.get('genre') && !u.searchParams.get('semilla');
    if (esRadio && !soltar) return new Promise((r) => { soltar = () => r({ ok: true, json: async () => ({ track: { id: ID(500), title: 'Radio del arranque', channel: 'c', duration: 90 }, genre: { id: 'jazz', label: 'G', emoji: '🎵', color: '#fff' } }) }); });
    return base.fetchImpl(url);
  };
  return { fetchImpl, pedidos: base.pedidos, soltar: () => soltar && soltar() };
}
const arrancando = async (player) => { await esperar(() => player.getState().loading); assert.equal(player.getState().track, null); };

for (const orden of [
  { c: { cmd: 'track', kind: 'song', track: song(9).track }, id: ID(9) },
  { c: { cmd: 'genre', id: 'jazz' }, id: null },
  { c: { cmd: 'search', q: 'algo 33' }, id: ID(33) },
  { c: { cmd: 'queue', items: [song(4), song(5)] }, id: ID(4) }
]) {
  test("arranque lento: '" + orden.c.cmd + "' suena aunque la precarga del arranque no haya vuelto, y esta no la pisa", async () => {
    const srv = servidorRadioColgada();
    const { player } = cargarMotor(srv.fetchImpl);
    await arrancando(player);
    player.handleCommand(orden.c);
    await esperar(() => player.getState().track);
    const elegida = player.getState().track.id;
    if (orden.id) assert.equal(elegida, orden.id);
    await esperar(() => !player.getState().loading);
    srv.soltar(); /* ahora vuelve la precarga del arranque */
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(player.getState().track.id, elegida, 'la radio del arranque no reemplaza lo que eligió la persona');
    assert.equal(player.getState().loading, false);
  });
}

test("arranque lento: 'next' dos veces seguidas no salta dos canciones (sigue habiendo una sola carga a la vez)", async () => {
  const { fetchImpl, pedidos } = servidorFalso();
  const { player } = cargarMotor(fetchImpl);
  await esperar(() => player.getState().track);
  await new Promise((r) => setTimeout(r, 20));
  const antes = pedidos.length;
  player.handleCommand({ cmd: 'next' });
  player.handleCommand({ cmd: 'next' });
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(pedidos.length - antes <= 2, 'una pista nueva + su precarga, no dos saltos');
});

test("409 «superada» en la primera canción: el motor vuelve a pedir y no se queda sin música (el kiosco quedaba en pausa para siempre)", async () => {
  const base = servidorFalso();
  let rechazos = 0;
  const fetchImpl = (url) => {
    const u = new URL(String(url), 'http://x');
    if (u.pathname.startsWith('/api/next') && !u.searchParams.get('q') && rechazos < 2) { rechazos++; return Promise.resolve({ ok: false, status: 409, json: async () => ({ error: 'STALE' }) }); }
    return base.fetchImpl(url);
  };
  const { player } = cargarMotor(fetchImpl);
  await esperar(() => player.getState().track);
  assert.equal(rechazos, 2);
  assert.ok(player.getState().track.id);
});

test("emisora: suena en vivo sin pedir canciones; un id raro se ignora; 'next' vuelve a la radio de canciones", async () => {
  const { fetchImpl, pedidos } = servidorFalso();
  const { player } = cargarMotor(fetchImpl);
  player.handleCommand({ cmd: 'queue', items: [song(1), song(2)] });
  await esperar(() => player.getState().track);
  const antes = pedidos.filter((p) => p.includes('/api/next')).length;
  player.handleCommand({ cmd: 'emisora', emisora: { id: 'la-lupe', nombre: 'La Lupe', frecuencia: '105.3 FM', estilo: 'Clásicos' } });
  await esperar(() => player.getState().track.live);
  const st = plano(player.getState());
  assert.deepEqual({ id: st.track.emisora, t: st.track.title, c: st.track.channel, g: st.genre.id }, { id: 'la-lupe', t: 'La Lupe', c: '105.3 FM · Clásicos', g: 'envivo' });
  assert.equal(st.cola, null, 'la emisora cancela la lista');
  assert.equal(pedidos.filter((p) => p.includes('/api/next')).length, antes, 'en vivo no se precargan canciones');

  for (const mal of [{ id: '../x', nombre: 'x' }, { id: 'ok', nombre: '' }, null, { id: 'a'.repeat(41), nombre: 'x' }]) player.handleCommand({ cmd: 'emisora', emisora: mal });
  assert.equal(player.getState().track.emisora, 'la-lupe');

  player.handleCommand({ cmd: 'next' });
  await esperar(() => !player.getState().track.live);
  assert.equal(player.getState().genre.id, 'jazz');
});
