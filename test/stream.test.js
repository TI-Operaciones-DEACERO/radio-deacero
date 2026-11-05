'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createProxy } = require('../src/stream');

const ID = 'a'.repeat(11);
const BODY = Buffer.from('0123456789'.repeat(10)); // 100 bytes

/* CDN falso: soporta Range, registra peticiones */
function startCdn(handler) {
  const seen = [];
  const srv = http.createServer((req, res) => {
    seen.push({ url: req.url, range: req.headers.range });
    if (handler && handler(req, res, seen.length)) return;
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    if (m) {
      const a = Number(m[1]);
      const b = m[2] ? Number(m[2]) : BODY.length - 1;
      res.writeHead(206, {
        'content-type': 'audio/mp4', 'accept-ranges': 'bytes',
        'content-range': `bytes ${a}-${b}/${BODY.length}`, 'content-length': b - a + 1
      });
      res.end(BODY.subarray(a, b + 1));
    } else {
      res.writeHead(200, { 'content-type': 'audio/mp4', 'content-length': BODY.length });
      res.end(BODY);
    }
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, seen, base: `http://127.0.0.1:${srv.address().port}` })));
}

async function withProxy(opts, fn) {
  const cdn = await startCdn(opts.cdnHandler);
  const resolved = [];
  const invalidated = [];
  const proxy = createProxy({
    resolve: async (id, mode) => { resolved.push([id, mode]); return { url: opts.url ? opts.url(cdn.base, resolved.length) : `${cdn.base}/v`, duration: 1 }; },
    invalidate: (id) => invalidated.push(id),
    allowHost: opts.allowHost || (() => true)
  });
  const app = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    proxy.handle(req, res, u.searchParams.get('id'), u.searchParams.get('mode') || 'audio');
  });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.address().port}`;
  try { await fn({ base, cdn, resolved, invalidated }); }
  finally { app.close(); cdn.srv.close(); }
}

test('sin Range: 200 con el cuerpo completo y cabeceras del origen', async () => {
  await withProxy({}, async ({ base }) => {
    const r = await fetch(`${base}/?id=${ID}`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'audio/mp4');
    assert.equal(r.headers.get('accept-ranges'), 'bytes');
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), BODY);
  });
});

test('con Range: reenvía el rango y responde 206 con content-range', async () => {
  await withProxy({}, async ({ base, cdn }) => {
    const r = await fetch(`${base}/?id=${ID}`, { headers: { range: 'bytes=10-19' } });
    assert.equal(r.status, 206);
    assert.equal(r.headers.get('content-range'), 'bytes 10-19/100');
    assert.equal(Buffer.from(await r.arrayBuffer()).toString(), '0123456789');
    assert.equal(cdn.seen[0].range, 'bytes=10-19');
  });
});

test('modo video sin content-type del origen usa video/mp4', async () => {
  await withProxy({ cdnHandler: (req, res) => { res.writeHead(200, { 'content-length': 3 }); res.end('abc'); return true; } }, async ({ base, resolved }) => {
    const r = await fetch(`${base}/?id=${ID}&mode=video`);
    assert.equal(r.headers.get('content-type'), 'video/mp4');
    assert.deepEqual(resolved[0], [ID, 'video']);
  });
});

test('403 del CDN: invalida la URL, resuelve otra vez y reintenta una vez', async () => {
  await withProxy({
    cdnHandler: (req, res, n) => { if (n === 1) { res.writeHead(403); res.end(); return true; } return false; }
  }, async ({ base, resolved, invalidated }) => {
    const r = await fetch(`${base}/?id=${ID}`);
    assert.equal(r.status, 200);
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), BODY);
    assert.deepEqual(invalidated, [ID]);
    assert.equal(resolved.length, 2);
  });
});

test('si el CDN sigue fallando responde 502 (no reintenta sin fin)', async () => {
  await withProxy({ cdnHandler: (req, res) => { res.writeHead(403); res.end(); return true; } }, async ({ base, resolved }) => {
    const r = await fetch(`${base}/?id=${ID}`);
    assert.equal(r.status, 502);
    assert.equal(resolved.length, 2);
  });
});

test('host no permitido → 502 y no se conecta', async () => {
  await withProxy({ allowHost: () => false }, async ({ base, cdn }) => {
    const r = await fetch(`${base}/?id=${ID}`);
    assert.equal(r.status, 502);
    assert.equal(cdn.seen.length, 0);
  });
});

test('id inválido → 400 sin resolver', async () => {
  await withProxy({}, async ({ base, resolved }) => {
    const r = await fetch(`${base}/?id=corto`);
    assert.equal(r.status, 400);
    assert.equal(resolved.length, 0);
  });
});

test('allowHost por defecto solo acepta googlevideo.com', () => {
  const { isYoutubeCdn } = require('../src/stream');
  assert.equal(isYoutubeCdn('rr4---sn-abc.googlevideo.com'), true);
  assert.equal(isYoutubeCdn('googlevideo.com'), true);
  assert.equal(isYoutubeCdn('evilgooglevideo.com'), false);
  assert.equal(isYoutubeCdn('googlevideo.com.evil.io'), false);
  assert.equal(isYoutubeCdn('127.0.0.1'), false);
});

/* probe: ¿se puede reproducir esta pista? (se usa ANTES de ofrecerla, para no entregar canciones que van a fallar) */
async function withProbe(opts, fn) {
  const cdn = await startCdn(opts.cdnHandler);
  const resolved = [];
  const invalidated = [];
  const proxy = createProxy({
    resolve: async (id, mode) => { resolved.push([id, mode]); if (opts.resolveError) throw new Error('no disponible'); return { url: `${cdn.base}/v`, duration: 1 }; },
    invalidate: (id) => invalidated.push(id),
    allowHost: opts.allowHost || (() => true),
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {})
  });
  try { await fn({ proxy, cdn, resolved, invalidated }); }
  finally { cdn.srv.close(); }
}

test('probe: true si el CDN responde y pide solo 1 byte', async () => {
  await withProbe({}, async ({ proxy, cdn, resolved }) => {
    assert.equal(await proxy.probe(ID), true);
    assert.deepEqual(resolved, [[ID, 'audio']]);
    assert.equal(cdn.seen[0].range, 'bytes=0-0');
  });
});

test('probe: false si el CDN no se puede alcanzar (certificado, red)', async () => {
  const fetchImpl = async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'CERT_NOT_YET_VALID' } }); };
  await withProbe({ fetchImpl }, async ({ proxy }) => {
    assert.equal(await proxy.probe(ID), false);
  });
});

test('probe: false si no se puede resolver la pista', async () => {
  await withProbe({ resolveError: true }, async ({ proxy, cdn }) => {
    assert.equal(await proxy.probe(ID), false);
    assert.equal(cdn.seen.length, 0);
  });
});

test('probe: 403 invalida la URL y reintenta una vez', async () => {
  await withProbe({ cdnHandler: (req, res, n) => { if (n === 1) { res.writeHead(403); res.end(); return true; } return false; } }, async ({ proxy, invalidated, resolved }) => {
    assert.equal(await proxy.probe(ID), true);
    assert.deepEqual(invalidated, [ID]);
    assert.equal(resolved.length, 2);
  });
});

test('probe: si el CDN sigue respondiendo 403 es false (sin reintentar sin fin)', async () => {
  await withProbe({ cdnHandler: (req, res) => { res.writeHead(403); res.end(); return true; } }, async ({ proxy, resolved }) => {
    assert.equal(await proxy.probe(ID), false);
    assert.equal(resolved.length, 2);
  });
});

test('probe: host no permitido → false y no se conecta; id inválido → false sin resolver', async () => {
  await withProbe({ allowHost: () => false }, async ({ proxy, cdn }) => {
    assert.equal(await proxy.probe(ID), false);
    assert.equal(cdn.seen.length, 0);
  });
  await withProbe({}, async ({ proxy, resolved }) => {
    assert.equal(await proxy.probe('corto'), false);
    assert.equal(resolved.length, 0);
  });
});
