'use strict';
/* Radio en vivo: lista curada de emisoras y proxy del flujo (src/emisoras.js). Sin red: el «origen» es un servidor local de mentira. */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createEmisoras } = require('../src/emisoras');
const SEED = require('../data/seed/emisoras.json');

/* Origen falso: /audio manda audio sin fin hasta que lo cierran; /html responde una página; /cae responde 500. */
function origen() {
  const abiertas = new Set();
  const srv = http.createServer((req, res) => {
    if (req.url === '/audio') {
      res.writeHead(200, { 'content-type': 'audio/mpeg' });
      const t = setInterval(() => res.write(Buffer.alloc(512, 7)), 10);
      abiertas.add(req);
      req.on('close', () => { clearInterval(t); abiertas.delete(req); });
      return;
    }
    if (req.url === '/html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<h1>no</h1>'); }
    res.writeHead(500); res.end();
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ base: 'http://127.0.0.1:' + srv.address().port, abiertas, cerrar: () => { srv.closeAllConnections(); srv.close(); } })));
}

/* Servidor que solo atiende /e/<id> con emisoras.escuchar (como lo hará src/server.js). */
function frente(em) {
  const srv = http.createServer((req, res) => em.escuchar(req.url.slice(3), req, res));
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ base: 'http://127.0.0.1:' + srv.address().port, cerrar: () => { srv.closeAllConnections(); srv.close(); } })));
}
const lista = (o) => [
  { id: 'buena', nombre: 'Buena', frecuencia: '100.1 FM', banda: 'FM', estilo: 'Pop', url: o.base + '/audio' },
  { id: 'pagina', nombre: 'Página', frecuencia: '900 AM', banda: 'AM', estilo: 'x', url: o.base + '/html' },
  { id: 'caida', nombre: 'Caída', frecuencia: 'En línea', banda: 'Internet', estilo: 'x', url: o.base + '/cae' }
];
const esperar = async (cond, ms = 3000) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error('tiempo agotado'); await new Promise((r) => setTimeout(r, 10)); } };

test('la lista curada es válida: ids únicos y seguros, banda FM/AM/Internet, URL http(s) pública y sin IPs', () => {
  const es = SEED.emisoras;
  assert.ok(es.length >= 20);
  assert.equal(new Set(es.map((e) => e.id)).size, es.length, 'ids únicos');
  for (const e of es) {
    assert.match(e.id, /^[a-z0-9-]{1,40}$/, e.id);
    assert.ok(e.nombre && e.frecuencia && e.estilo, e.id);
    assert.ok(['FM', 'AM', 'Internet'].includes(e.banda), e.id);
    const u = new URL(e.url);
    assert.ok(['http:', 'https:'].includes(u.protocol), e.id);
    assert.ok(!/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname), 'sin IPs sueltas: ' + e.id);
  }
});

test('list: solo datos públicos (nunca la URL del flujo) y descarta entradas inválidas', () => {
  const em = createEmisoras({ lista: [...lista({ base: 'https://x.example' }), { id: 'MAL ID', nombre: 'x', url: 'https://x' }, { id: 'sin-url', nombre: 'x' }, { id: 'ftp', nombre: 'x', url: 'ftp://x' }, null] });
  const l = em.list();
  assert.deepEqual(l.map((e) => e.id), ['buena', 'pagina', 'caida']);
  assert.deepEqual(Object.keys(l[0]).sort(), ['banda', 'estilo', 'frecuencia', 'id', 'nombre']);
  assert.ok(!JSON.stringify(l).includes('x.example'));
});

test('escuchar: reenvía el audio de la emisora con su tipo y sin caché; al cerrar el oyente se corta el origen', async () => {
  const o = await origen();
  const em = createEmisoras({ lista: lista(o) });
  const f = await frente(em);
  try {
    const ac = new AbortController();
    const r = await fetch(f.base + '/e/buena', { signal: ac.signal });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'audio/mpeg');
    assert.equal(r.headers.get('cache-control'), 'no-store');
    const lector = r.body.getReader();
    const { value } = await lector.read();
    assert.ok(value.length > 0);
    assert.equal(o.abiertas.size, 1);
    ac.abort();
    await esperar(() => o.abiertas.size === 0); /* no queda una conexión colgando hacia la emisora */
    await esperar(() => em.activas() === 0);
  } finally { f.cerrar(); o.cerrar(); }
});

test('escuchar: id desconocido → 404; origen caído o que no es audio → 502 (no se reenvía una página)', async () => {
  const o = await origen();
  const em = createEmisoras({ lista: lista(o) });
  const f = await frente(em);
  try {
    assert.equal((await fetch(f.base + '/e/no-existe')).status, 404);
    const p = await fetch(f.base + '/e/pagina');
    assert.equal(p.status, 502);
    assert.ok(!(await p.text()).includes('<h1>'));
    assert.equal((await fetch(f.base + '/e/caida')).status, 502);
    assert.equal(em.activas(), 0);
  } finally { f.cerrar(); o.cerrar(); }
});

test('escuchar: con el tope de conexiones lleno responde 503 y no abre otra hacia la emisora', async () => {
  const o = await origen();
  const em = createEmisoras({ lista: lista(o), max: 1 });
  const f = await frente(em);
  try {
    const ac = new AbortController();
    const r1 = await fetch(f.base + '/e/buena', { signal: ac.signal });
    await r1.body.getReader().read();
    assert.equal((await fetch(f.base + '/e/buena')).status, 503);
    assert.equal(o.abiertas.size, 1);
    ac.abort();
    await esperar(() => em.activas() === 0);
  } finally { f.cerrar(); o.cerrar(); }
});

test('escuchar: si la emisora no contesta a tiempo → 504 y se libera el lugar', async () => {
  const lenta = http.createServer(() => { /* nunca responde */ });
  await new Promise((ok) => lenta.listen(0, '127.0.0.1', ok));
  const em = createEmisoras({ lista: [{ id: 'lenta', nombre: 'Lenta', frecuencia: '1 AM', banda: 'AM', estilo: 'x', url: 'http://127.0.0.1:' + lenta.address().port + '/' }], conectarMs: 150 });
  const f = await frente(em);
  try {
    assert.equal((await fetch(f.base + '/e/lenta')).status, 504);
    assert.equal(em.activas(), 0);
  } finally { f.cerrar(); lenta.closeAllConnections(); lenta.close(); }
});
