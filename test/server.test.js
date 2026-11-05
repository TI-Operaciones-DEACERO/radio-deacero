'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createServer } = require('../src/server');
const { createControl } = require('../src/control');
const { createPodcasts } = require('../src/podcasts');
const { createClients } = require('../src/clients');
const { createHistory } = require('../src/history');

const ID = 'a'.repeat(11);

function setup(over = {}) {
  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'play-pub-'));
  fs.writeFileSync(path.join(publicDir, 'index.html'), '<h1>hola</h1>');
  fs.writeFileSync(path.join(publicDir, 'app.js'), 'x');
  fs.writeFileSync(path.join(publicDir, 'remote.html'), '<h1>control</h1>');
  const secret = path.join(path.dirname(publicDir), 'secreto.txt');
  fs.writeFileSync(secret, 'no');

  const calls = { resolve: [], play: [], next: [], episodes: [] };
  const deps = {
    publicDir,
    genres: [
      { id: 'jazz', label: 'Jazz', emoji: '🎷', color: '#f90', featured: true, queries: ['secreta'] },
      { id: 'rock', label: 'Rock', emoji: '🎸', color: '#f00', featured: false, queries: ['otra'] }
    ],
    ytdlp: { resolve: async (id, m) => { calls.resolve.push([id, m]); return {}; }, version: () => '2026.01.01' },
    radio: {
      next: async (o) => {
        calls.next.push(o);
        if (over.nextError) throw Object.assign(new Error('x'), { code: over.nextError });
        return { track: { id: ID, title: 'T', channel: 'C', duration: 100 }, genre: { id: 'jazz', label: 'Jazz', emoji: '🎷', color: '#f90' }, genreChanged: true, genreLeft: 3 };
      }
    },
    proxy: { handle: (req, res, id, mode) => { calls.play.push([id, mode]); res.writeHead(200); res.end('audio'); } },
    thumbs: { get: async (id) => (id === ID ? { type: 'image/jpeg', body: Buffer.from([1, 2]) } : null) },
    control: createControl({ keepAliveMs: 0 }),
    clients: createClients({ reverse: async () => null }),
    timesync: { current: () => 1_800_000_000_000, info: () => ({ offset: 5000, synced: true, source: 'https://x.example', at: 1 }) },
    history: createHistory({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'play-hist-')) }),
    podcasts: createPodcasts({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'play-pods-')) }),
    episodes: async (q, n) => { calls.episodes.push([q, n]); if (q === 'falla') throw new Error('sin red'); return q === 'nada' ? [] : [{ id: ID, title: 'Episodio muy largo del podcast', channel: 'Mi podcast', duration: 1800 }]; },
    lyrics: { get: async (q) => (q.title === 'Con letra' ? { synced: null, plain: 'la la', source: 'x' } : null) },
    ...over.deps
  };
  const server = createServer(deps);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve({ base: `http://127.0.0.1:${server.address().port}`, calls, close: () => { if (server.closeAllConnections) server.closeAllConnections(); server.close(); } });
  }));
}

async function run(over, fn) {
  const s = await setup(over);
  try { await fn(s); } finally { s.close(); }
}

test('GET /api/health', () => run({}, async ({ base }) => {
  const j = await (await fetch(`${base}/api/health`)).json();
  assert.equal(j.ok, true);
  assert.equal(j.ytdlp, '2026.01.01');
  assert.equal(typeof j.uptime, 'number');
}));

test('GET /api/genres: lista pública sin las consultas', () => run({}, async ({ base }) => {
  const j = await (await fetch(`${base}/api/genres`)).json();
  assert.deepEqual(j.map((g) => g.id), ['jazz', 'rock']);
  assert.deepEqual(Object.keys(j[0]).sort(), ['color', 'emoji', 'featured', 'id', 'label']);
}));

test('GET /api/next: devuelve pista + género y precalienta el audio', () => run({}, async ({ base, calls }) => {
  const r = await fetch(`${base}/api/next`);
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.track.id, ID);
  assert.equal(j.genre.id, 'jazz');
  assert.equal(j.genreChanged, true);
  assert.equal(j.genreLeft, 3);
  assert.deepEqual(calls.resolve, [[ID, 'audio']]);
}));

test('GET /api/next: pasa genre y change al radio', () => run({}, async ({ base, calls }) => {
  await fetch(`${base}/api/next?genre=rock`);
  await fetch(`${base}/api/next?change=1`);
  assert.deepEqual(calls.next, [
    { genre: 'rock', change: false, query: undefined },
    { genre: undefined, change: true, query: undefined }
  ]);
}));

test('GET /api/next: NO_SOURCE → 503, UNKNOWN_GENRE → 400', async () => {
  await run({ nextError: 'NO_SOURCE' }, async ({ base }) => {
    const r = await fetch(`${base}/api/next`);
    assert.equal(r.status, 503);
    assert.equal((await r.json()).error, 'NO_SOURCE');
  });
  await run({ nextError: 'UNKNOWN_GENRE' }, async ({ base }) => {
    assert.equal((await fetch(`${base}/api/next?genre=zzz`)).status, 400);
  });
});

test('GET /api/play/:id delega al proxy con el modo', () => run({}, async ({ base, calls }) => {
  assert.equal(await (await fetch(`${base}/api/play/${ID}`)).text(), 'audio');
  await fetch(`${base}/api/play/${ID}?mode=video`);
  assert.deepEqual(calls.play, [[ID, 'audio'], [ID, 'video']]);
}));

test('GET /api/play: id o modo inválidos → 400 sin tocar el proxy', () => run({}, async ({ base, calls }) => {
  assert.equal((await fetch(`${base}/api/play/corto`)).status, 400);
  assert.equal((await fetch(`${base}/api/play/${ID}?mode=raro`)).status, 400);
  assert.equal(calls.play.length, 0);
}));

test('GET /api/thumb/:id', () => run({}, async ({ base }) => {
  const r = await fetch(`${base}/api/thumb/${ID}`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/jpeg');
  assert.ok(r.headers.get('cache-control').includes('max-age'));
  assert.equal((await fetch(`${base}/api/thumb/${'b'.repeat(11)}`)).status, 404);
}));

test('GET /api/lyrics: encuentra, no encuentra (404) y exige title', () => run({}, async ({ base }) => {
  const ok = await fetch(`${base}/api/lyrics?title=${encodeURIComponent('Con letra')}&channel=x&duration=100`);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).plain, 'la la');
  assert.equal((await fetch(`${base}/api/lyrics?title=Sin&channel=x`)).status, 404);
  assert.equal((await fetch(`${base}/api/lyrics`)).status, 400);
}));

test('estáticos: "/" sirve index.html y los .js con no-cache', () => run({}, async ({ base }) => {
  const r = await fetch(`${base}/`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  assert.equal(await r.text(), '<h1>hola</h1>');
  const js = await fetch(`${base}/app.js`);
  assert.match(js.headers.get('content-type'), /javascript/);
  assert.equal(js.headers.get('cache-control'), 'no-cache');
}));

test('estáticos: no se sale de public/ (path traversal)', () => run({}, async ({ base }) => {
  for (const p of ['/..%2fsecreto.txt', '/%2e%2e/secreto.txt', '/../secreto.txt', '/..%5csecreto.txt']) {
    const r = await fetch(`${base}${p}`);
    assert.ok([400, 403, 404].includes(r.status), `${p} → ${r.status}`);
    assert.notEqual(await r.text(), 'no');
  }
}));

test('rutas /api desconocidas → 404 JSON; métodos no GET → 405', () => run({}, async ({ base }) => {
  const r = await fetch(`${base}/api/nada`);
  assert.equal(r.status, 404);
  assert.equal((await r.json()).error, 'Endpoint no encontrado');
  assert.equal((await fetch(`${base}/api/next`, { method: 'POST' })).status, 405);
}));

/* ── control remoto ─────────────────────────────────────────── */
function openEvents(base, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${base}/api/events`, { headers }, (res) => {
      const got = { status: res.statusCode, data: '', req };
      res.setEncoding('utf8');
      res.on('data', (d) => { got.data += d; });
      resolve(got);
    });
    req.on('error', reject);
  });
}
const post = (base, p, body, headers = {}) => fetch(`${base}${p}`, {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body)
});
const waitUntil = async (fn, ms = 1500) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await new Promise((r) => setTimeout(r, 20)); } return false; };

test('POST /api/cmd sin pantalla abierta → 409 NO_PLAYER', () => run({}, async ({ base }) => {
  const r = await post(base, '/api/cmd', { cmd: 'next' });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error, 'NO_PLAYER');
}));

test('POST /api/cmd llega a la pantalla por /api/events', () => run({}, async ({ base }) => {
  const ev = await openEvents(base);
  assert.equal(ev.status, 200);
  const r = await post(base, '/api/cmd', { cmd: 'genre', id: 'rock' });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, delivered: 1 });
  assert.ok(await waitUntil(() => ev.data.includes('data: {"cmd":"genre","id":"rock"}')), ev.data);
  ev.req.destroy();
}));

test('POST /api/cmd valida: orden inválida, género desconocido, JSON roto o enorme', () => run({}, async ({ base }) => {
  const ev = await openEvents(base);
  assert.equal((await post(base, '/api/cmd', { cmd: 'reiniciar' })).status, 400);
  assert.equal((await post(base, '/api/cmd', { cmd: 'genre', id: 'nope' })).status, 400);
  const bad = await fetch(`${base}/api/cmd`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{no es json' });
  assert.equal(bad.status, 400);
  const big = await post(base, '/api/cmd', { cmd: 'search', q: 'x'.repeat(5000) });
  assert.ok([400, 413].includes(big.status));
  ev.req.destroy();
}));

test('POST /api/state guarda lo que reporta la pantalla y GET lo devuelve', () => run({}, async ({ base }) => {
  const st = { paused: false, volume: 55, mode: 'audio', time: 12.5, track: { id: ID, title: 'T', channel: 'C', duration: 100 }, genre: { id: 'jazz', label: 'Jazz', emoji: '🎷' } };
  assert.equal((await post(base, '/api/state', st)).status, 204);
  const j = await (await fetch(`${base}/api/state`)).json();
  assert.equal(j.volume, 55);
  assert.equal(j.track.title, 'T');
  assert.equal(j.players, 0);
  assert.equal(typeof j.updated, 'number');
}));

test('POST /api/state ignora campos desconocidos', () => run({}, async ({ base }) => {
  await post(base, '/api/state', { paused: true, hack: '<script>', track: { id: ID, title: 'T', channel: 'C', duration: 1, evil: 1 } });
  const j = await (await fetch(`${base}/api/state`)).json();
  assert.equal(j.hack, undefined);
  assert.equal(j.track.evil, undefined);
}));

test('GET /api/search: géneros por texto', () => run({}, async ({ base }) => {
  const j = await (await fetch(`${base}/api/search?q=JAZ`)).json();
  assert.deepEqual(j.map((g) => g.id), ['jazz']);
  assert.deepEqual(await (await fetch(`${base}/api/search`)).json(), []);
}));

test('GET /api/next?q= pasa la búsqueda al radio', () => run({}, async ({ base, calls }) => {
  await fetch(`${base}/api/next?q=${encodeURIComponent('bad bunny')}`);
  assert.equal(calls.next[0].query, 'bad bunny');
}));

test('token: sin él, un cliente remoto recibe 401; con él (header o ?t=) pasa; /api/health siempre', () =>
  run({ deps: { token: 's3cret', trustLoopback: false } }, async ({ base }) => {
    assert.equal((await fetch(`${base}/api/state`)).status, 401);
    assert.equal((await fetch(`${base}/api/state?t=mal`)).status, 401);
    assert.equal((await fetch(`${base}/api/state?t=s3cret`)).status, 200);
    assert.equal((await fetch(`${base}/api/state`, { headers: { 'x-token': 's3cret' } })).status, 200);
    assert.equal((await post(base, '/api/cmd', { cmd: 'next' })).status, 401);
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
    assert.equal((await fetch(`${base}/`)).status, 200, 'la página en sí no es secreta');
  }));

test('token: la pantalla local (loopback) no necesita token', () => run({ deps: { token: 's3cret' } }, async ({ base }) => {
  assert.equal((await fetch(`${base}/api/genres`)).status, 200);
}));

test('/remote sirve la página de control (sin .html)', () => run({}, async ({ base }) => {
  const r = await fetch(`${base}/remote`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  assert.equal(await r.text(), '<h1>control</h1>');
}));

/* ── /panel sin clave: solo lo que usa un oyente; nada que controle pantallas ── */
const CERRADO = { token: 's3cret', trustLoopback: false };
const SID_OK = 'panel-abc12345';

test('/panel sin clave: lo que necesita un oyente es libre', () => run({ deps: CERRADO }, async ({ base, calls }) => {
  assert.equal((await fetch(`${base}/api/genres`)).status, 200);
  assert.equal((await fetch(`${base}/api/thumb/${ID}`)).status, 200);
  assert.equal((await fetch(`${base}/api/play/${ID}?mode=audio`)).status, 200);
  assert.equal((await fetch(`${base}/api/podcast/search?q=radio`)).status, 200);
  assert.equal((await fetch(`${base}/api/podcasts`)).status, 200);
  const r = await fetch(`${base}/api/next?sid=${SID_OK}`);
  assert.equal(r.status, 200);
  assert.deepEqual(calls.next, [{ genre: undefined, change: false, query: undefined, session: SID_OK }], 'la sesión llega al radio');
}));

test('/panel sin clave: lo que controla pantallas o muestra equipos sigue cerrado', () => run({ deps: CERRADO }, async ({ base }) => {
  for (const p of ['/api/next', `/api/next?sid=corto`, '/api/next?genre=rock', '/api/state', '/api/events', '/api/clients', '/api/history', '/api/time', '/api/lyrics?title=x', '/api/search?q=a']) {
    assert.equal((await fetch(`${base}${p}`)).status, 401, p);
  }
  assert.equal((await post(base, '/api/cmd', { cmd: 'next' })).status, 401);
  assert.equal((await post(base, '/api/state', {})).status, 401);
  assert.equal((await post(base, '/api/podcasts', { name: 'a', q: 'a' })).status, 401);
  assert.equal((await del(base, '/api/podcasts/abc123')).status, 401);
  assert.equal((await del(base, '/api/history')).status, 401);
}));

test('/panel sin clave: el interruptor panelOpen:false lo vuelve a cerrar', () => run({ deps: { ...CERRADO, panelOpen: false } }, async ({ base }) => {
  for (const p of ['/api/genres', `/api/next?sid=${SID_OK}`, `/api/play/${ID}`, `/api/thumb/${ID}`, '/api/podcasts']) assert.equal((await fetch(`${base}${p}`)).status, 401, p);
  assert.equal((await fetch(`${base}/api/genres?t=s3cret`)).status, 200, 'con clave sigue funcionando');
}));

test('/api/next: un id de sesión mal formado → 400 (con clave); sin sesión no se manda "session"', () => run({ deps: CERRADO }, async ({ base, calls }) => {
  for (const sid of ['', 'corto', 'x'.repeat(41), 'con espacio 123', 'a/b/c/d/e/f/g']) {
    assert.equal((await fetch(`${base}/api/next?sid=${encodeURIComponent(sid)}&t=s3cret`)).status, 400, JSON.stringify(sid));
  }
  assert.equal(calls.next.length, 0);
  await fetch(`${base}/api/next?t=s3cret`);
  assert.deepEqual(calls.next, [{ genre: undefined, change: false, query: undefined }]);
}));

test('/panel sirve la misma página que /remote (la app decide por la ruta si reproduce aquí)', () => run({}, async ({ base }) => {
  for (const p of ['/panel', '/panel/']) {
    const r = await fetch(`${base}${p}`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/html/);
    assert.equal(await r.text(), '<h1>control</h1>');
  }
}));

/* ── podcasts ───────────────────────────────────────────────── */
const del =(base, p) => fetch(`${base}${p}`, { method: 'DELETE' });

test('podcasts: guardar, listar y quitar', () => run({}, async ({ base }) => {
  assert.deepEqual(await (await fetch(`${base}/api/podcasts`)).json(), []);
  const r = await post(base, '/api/podcasts', { name: 'Radio Ambulante', q: 'radio ambulante' });
  assert.equal(r.status, 201);
  const item = await r.json();
  assert.equal(item.name, 'Radio Ambulante');
  assert.deepEqual((await (await fetch(`${base}/api/podcasts`)).json()).map((p) => p.id), [item.id]);

  const dup = await post(base, '/api/podcasts', { name: 'otro', q: 'RADIO AMBULANTE' });
  assert.equal(dup.status, 200, 'la misma consulta no se duplica');
  assert.equal((await dup.json()).id, item.id);

  assert.equal((await del(base, `/api/podcasts/${item.id}`)).status, 204);
  assert.equal((await del(base, `/api/podcasts/${item.id}`)).status, 404);
  assert.deepEqual(await (await fetch(`${base}/api/podcasts`)).json(), []);
}));

test('podcasts: datos inválidos → 400', () => run({}, async ({ base }) => {
  assert.equal((await post(base, '/api/podcasts', { name: '', q: 'x' })).status, 400);
  assert.equal((await post(base, '/api/podcasts', { q: 'x' })).status, 400);
  const bad = await fetch(`${base}/api/podcasts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{roto' });
  assert.equal(bad.status, 400);
}));

test('GET /api/podcast/search: episodios (por fecha) o errores claros', () => run({}, async ({ base, calls }) => {
  const r = await fetch(`${base}/api/podcast/search?q=${encodeURIComponent('radio ambulante')}`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j[0].title, 'Episodio muy largo del podcast');
  assert.deepEqual(calls.episodes[0], ['radio ambulante', 15]);
  assert.equal((await fetch(`${base}/api/podcast/search`)).status, 400);
  assert.equal((await fetch(`${base}/api/podcast/search?q=falla`)).status, 503);
  assert.deepEqual(await (await fetch(`${base}/api/podcast/search?q=nada`)).json(), []);
}));

test('podcasts: con token y cliente remoto sin clave, leer es libre (/panel) pero guardar y quitar → 401', () => run({ deps: { token: 's3cret', trustLoopback: false } }, async ({ base }) => {
  assert.equal((await fetch(`${base}/api/podcasts`)).status, 200);
  assert.equal((await post(base, '/api/podcasts', { name: 'a', q: 'a' })).status, 401);
  assert.equal((await del(base, '/api/podcasts/abc123')).status, 401);
  assert.equal((await post(base, '/api/podcasts', { name: 'a', q: 'a' }, { 'x-token': 's3cret' })).status, 201);
}));

test('PUT sigue prohibido (405)', () => run({}, async ({ base }) => {
  assert.equal((await fetch(`${base}/api/podcasts`, { method: 'PUT' })).status, 405);
}));

test('GET /api/health informa las direcciones IP del servidor', () => run({}, async ({ base }) => {
  const j = await (await fetch(`${base}/api/health`)).json();
  assert.ok(Array.isArray(j.ips));
  for (const ip of j.ips) assert.match(ip, /^\d+\.\d+\.\d+\.\d+$/);
}));

test('orden track llega a la pantalla', () => run({}, async ({ base }) => {
  const ev = await openEvents(base);
  const track = { id: ID, title: 'Episodio', channel: 'P', duration: 3600 };
  const r = await post(base, '/api/cmd', { cmd: 'track', kind: 'podcast', track });
  assert.equal(r.status, 200);
  assert.ok(await waitUntil(() => ev.data.includes('"cmd":"track"') && ev.data.includes('"kind":"podcast"')), ev.data);
  assert.equal((await post(base, '/api/cmd', { cmd: 'track', track: { ...track, id: 'x' } })).status, 400);
  ev.req.destroy();
}));

/* ── equipos conectados ─────────────────────────────────────── */
const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

test('GET /api/clients: pantallas (SSE) y controles (quien consulta o manda órdenes)', () => run({}, async ({ base }) => {
  const ev = await openEvents(base, { 'user-agent': 'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 Chrome/151.0 Safari/537.36' });
  await fetch(`${base}/api/state`, { headers: { 'user-agent': UA_IPHONE } });
  await post(base, '/api/cmd', { cmd: 'next' }, { 'user-agent': UA_IPHONE });

  const j = await (await fetch(`${base}/api/clients`, { headers: { 'user-agent': UA_IPHONE } })).json();
  assert.equal(j.screens.length, 1);
  assert.equal(j.screens[0].agent, 'Pantalla de la Pi (Chrome)', 'una pantalla local es la de la Pi (Chromium oculta que es ARM)');
  assert.equal(j.screens[0].host, 'esta Pi');
  assert.match(j.screens[0].ip, /^127\.0\.0\.1$/);
  assert.equal(typeof j.screens[0].seconds, 'number');

  const phone = j.controllers.find((c) => c.agent === 'iPhone (Safari)');
  assert.ok(phone, JSON.stringify(j.controllers));
  assert.equal(phone.lastCmd, 'next');
  assert.equal(phone.online, true);
  assert.equal(phone.via, 'web');
  assert.equal(j.you.agent, 'iPhone (Safari)');
  ev.req.destroy();
}));

test('la propia pantalla (que consulta /api/next, /api/play…) no aparece como control', () => run({}, async ({ base }) => {
  await fetch(`${base}/api/next`, { headers: { 'user-agent': UA_IPHONE } });
  await fetch(`${base}/api/genres`, { headers: { 'user-agent': UA_IPHONE } });
  await post(base, '/api/state', { paused: false }, { 'user-agent': UA_IPHONE });
  const j = await (await fetch(`${base}/api/clients`, { headers: { 'user-agent': 'otro/1' } })).json();
  assert.ok(!j.controllers.some((c) => c.agent === 'iPhone (Safari)'));
}));

test('GET /api/clients exige la clave a clientes remotos', () => run({ deps: { token: 's3cret', trustLoopback: false } }, async ({ base }) => {
  assert.equal((await fetch(`${base}/api/clients`)).status, 401);
  assert.equal((await fetch(`${base}/api/clients?t=s3cret`)).status, 200);
}));

/* ── historial de búsquedas y usuario ───────────────────────── */
const U = (n) => encodeURIComponent(n);

test('historial: una búsqueda de canción queda con quién la hizo, desde qué IP y cuándo', () => run({}, async ({ base }) => {
  await post(base, '/api/cmd', { cmd: 'search', q: 'dua lipa' }, { 'x-user': U('José'), 'x-client-time': '1800000000000' });
  const j = await (await fetch(`${base}/api/history`)).json();
  assert.equal(j.length, 1);
  assert.deepEqual({ kind: j[0].kind, text: j[0].text, user: j[0].user, ip: j[0].ip, at: j[0].at, host: j[0].host },
    { kind: 'song', text: 'dua lipa', user: 'José', ip: '127.0.0.1', at: 1800000000000, host: 'esta Pi' });
}));

test('historial: también búsquedas de podcast, géneros elegidos y episodios tocados; lo nuevo primero', () => run({}, async ({ base }) => {
  const h = { 'x-user': U('Ana') };
  await fetch(`${base}/api/podcast/search?q=radio%20ambulante`, { headers: h });
  await post(base, '/api/cmd', { cmd: 'genre', id: 'jazz' }, h);
  await post(base, '/api/cmd', { cmd: 'track', kind: 'podcast', track: { id: ID, title: 'Episodio 56', channel: 'RA', duration: 3000 } }, h);
  const j = await (await fetch(`${base}/api/history`)).json();
  assert.deepEqual(j.map((x) => [x.kind, x.text]), [['episode', 'Episodio 56'], ['genre', 'Jazz'], ['podcast', 'radio ambulante']]);
  assert.ok(j.every((x) => x.user === 'Ana'));
}));

test('historial: no registra búsquedas vacías, órdenes que no son búsqueda, ni lo inválido', () => run({}, async ({ base }) => {
  await fetch(`${base}/api/search`);
  await fetch(`${base}/api/search?q=jazz`); // filtrar la lista no es una búsqueda: se registra al ELEGIR el género
  await fetch(`${base}/api/search?q=`);
  await fetch(`${base}/api/podcast/search`);
  await post(base, '/api/cmd', { cmd: 'next' });
  await post(base, '/api/cmd', { cmd: 'search', q: '' });
  await post(base, '/api/cmd', { cmd: 'reiniciar' });
  assert.deepEqual(await (await fetch(`${base}/api/history`)).json(), []);
}));

test('historial: usuario ausente → null; hora del cliente inválida se ignora', () => run({}, async ({ base }) => {
  await post(base, '/api/cmd', { cmd: 'search', q: 'sin nombre' }, { 'x-client-time': 'mañana' });
  const j = await (await fetch(`${base}/api/history`)).json();
  assert.equal(j[0].user, null);
  assert.ok(Math.abs(j[0].at - Date.now()) < 10000);
}));

test('historial: limit, y DELETE lo borra', () => run({}, async ({ base }) => {
  for (const t of ['uno', 'dos', 'tres']) await post(base, '/api/cmd', { cmd: 'search', q: t });
  assert.equal((await (await fetch(`${base}/api/history?limit=2`)).json()).length, 2);
  assert.equal((await del(base, '/api/history')).status, 204);
  assert.deepEqual(await (await fetch(`${base}/api/history`)).json(), []);
}));

test('historial: con clave, un cliente remoto sin ella → 401 (lectura y borrado)', () => run({ deps: { token: 's3cret', trustLoopback: false } }, async ({ base }) => {
  assert.equal((await fetch(`${base}/api/history`)).status, 401);
  assert.equal((await del(base, '/api/history')).status, 401);
  assert.equal((await fetch(`${base}/api/history?t=s3cret`)).status, 200);
}));

test('/api/clients muestra el usuario declarado de cada control', () => run({}, async ({ base }) => {
  await fetch(`${base}/api/state`, { headers: { 'user-agent': UA_IPHONE, 'x-user': U('María') } });
  const j = await (await fetch(`${base}/api/clients`, { headers: { 'user-agent': 'otro/1', 'x-user': U('Pedro') } })).json();
  assert.equal(j.controllers.find((c) => c.agent === 'iPhone (Safari)').user, 'María');
  assert.equal(j.you.user, 'Pedro');
}));

/* ── hora corregida y vista kiosco ──────────────────────────── */
test('GET /api/time: hora real corregida, desfase y si está sincronizada', () => run({}, async ({ base }) => {
  const j = await (await fetch(`${base}/api/time`)).json();
  assert.deepEqual(j, { now: 1_800_000_000_000, offset: 5000, synced: true });
}));

test('GET /api/time exige la clave a clientes remotos', () => run({ deps: { token: 's3cret', trustLoopback: false } }, async ({ base }) => {
  assert.equal((await fetch(`${base}/api/time`)).status, 401);
  assert.equal((await fetch(`${base}/api/time?t=s3cret`)).status, 200);
}));

test('/kiosco sirve la misma página del reproductor (la vista se elige por la ruta)', () => run({}, async ({ base }) => {
  const r = await fetch(`${base}/kiosco`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  assert.equal(await r.text(), '<h1>hola</h1>');
  assert.equal(await (await fetch(`${base}/kiosco/`)).text(), '<h1>hola</h1>');
}));
