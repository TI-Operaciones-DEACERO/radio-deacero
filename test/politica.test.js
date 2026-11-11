'use strict';
/* Fase 0: la tabla de permisos es la ÚNICA fuente de qué rutas existen y quién puede usarlas. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROUTES, LEVELS, resolve } = require('../src/policy');

test('cada ruta de la tabla tiene nivel válido, método y límite de cuerpo', () => {
  assert.ok(ROUTES.length >= 15);
  for (const r of ROUTES) {
    assert.ok(LEVELS.includes(r.level), `${r.re}: nivel ${r.level}`);
    assert.ok(r.re instanceof RegExp && r.methods.length, String(r.re));
    for (const m of r.methods) assert.ok(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(m), `${r.re}: ${m}`);
    assert.ok(Number.isInteger(r.bodyLimit) && r.bodyLimit > 0, `${r.re}: bodyLimit`);
  }
});

test('resolve: conserva los niveles que ya tenían las rutas actuales', () => {
  const casos = [
    ['GET', '/api/health', 'publico'],
    ['GET', '/api/genres', 'oyente'], ['GET', '/api/podcasts', 'oyente'], ['GET', '/api/podcast/search', 'oyente'],
    ['GET', '/api/next', 'oyente'], ['GET', '/api/play/abcdefghijk', 'oyente'], ['GET', '/api/thumb/abcdefghijk', 'oyente'],
    ['POST', '/api/podcasts', 'clave'], ['DELETE', '/api/podcasts/abc1', 'clave'], ['DELETE', '/api/history', 'clave'],
    ['GET', '/api/history', 'clave'], ['POST', '/api/cmd', 'clave'], ['GET', '/api/state', 'clave'], ['POST', '/api/state', 'clave'],
    ['GET', '/api/events', 'clave'], ['GET', '/api/clients', 'clave'], ['GET', '/api/time', 'clave'],
    ['GET', '/api/search', 'clave'],
    /* Decisión de la Fase 5: las letras pasan a oyente CON id de sesión (needs:'sid'); sin ?sid= siguen pidiendo clave (server.test.js). */
    ['GET', '/api/lyrics', 'oyente']
  ];
  for (const [m, p, nivel] of casos) {
    const r = resolve(m, p);
    assert.ok(r, `${m} ${p} debería existir`);
    assert.equal(r.level, nivel, `${m} ${p}`);
  }
});

test('resolve: lo que no está en la tabla no existe (se responde 405/404, nunca se deja pasar)', () => {
  assert.equal(resolve('POST', '/api/genres'), null);
  assert.equal(resolve('PUT', '/api/cmd'), null);
  assert.equal(resolve('GET', '/api/inventada'), null);
  assert.equal(resolve('DELETE', '/api/podcasts'), null);
  assert.equal(resolve('GET', '/api/play/a/b'), null);
});

test('resolve: /api/next, /api/lyrics y /api/buscar solo son de oyente con id de sesión', () => {
  for (const p of ['/api/next', '/api/lyrics', '/api/buscar']) assert.equal(resolve('GET', p).needs, 'sid', p);
});

test('rutas nuevas: auth, me y admin tienen el nivel que dice el plan', () => {
  assert.equal(resolve('POST', '/api/auth/login').level, 'publico');
  assert.equal(resolve('POST', '/api/auth/logout').level, 'publico');
  assert.equal(resolve('GET', '/api/auth/me').level, 'publico');
  for (const [m, p] of [['POST', '/api/auth/profile'], ['GET', '/api/auth/export']]) {
    assert.equal(resolve(m, p).level, 'usuario', `${m} ${p}`);
  }
  assert.equal(resolve('DELETE', '/api/auth/account'), null, 'la cuenta no se puede borrar');
  assert.equal(resolve('GET', '/api/admin/usuarios').level, 'clave');
  assert.equal(resolve('PATCH', '/api/admin/usuarios/abc12345').level, 'clave');
  assert.equal(resolve('DELETE', '/api/admin/usuarios/abc12345').level, 'clave');
});

test('todo prefijo /api/admin/ exige clave', () => {
  for (const r of ROUTES) if (r.re.source.includes('admin')) assert.equal(r.level, 'clave', String(r.re));
});

/* Cobertura: toda ruta escrita en un manejador debe existir en la tabla. Si alguien añade una ruta sin darle nivel, esto falla. */
test('cobertura: cada ruta /api/... citada en el código aparece en la tabla', () => {
  const dirs = [path.join(__dirname, '..', 'src')];
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (f.endsWith('.js')) files.push(f); } };
  dirs.forEach(walk);
  const sin = [];
  for (const f of files) {
    if (f.endsWith('policy.js')) continue;
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/['"`](\/api\/[a-z][a-z0-9/_-]*)/g)) {
      const ruta = m[1].replace(/\/$/, '');
      /* se prueba la ruta tal cual y con un id al final (/api/play/:id, /api/podcasts/:id...) */
      const ok = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].some((met) => resolve(met, ruta) || resolve(met, ruta + '/abcdefghijk'));
      /* o es un prefijo (startsWith('/api/auth/')) bajo el que la tabla sí tiene rutas */
      const prefijo = ROUTES.some((r) => r.re.source.startsWith('^' + ruta.replace(/\//g, '\\/') + '\\/'));
      if (!ok && !prefijo) sin.push(`${path.basename(f)}: ${ruta}`);
    }
  }
  assert.deepEqual([...new Set(sin)], []);
});

test('radio en vivo: la lista y el flujo de una emisora son de oyente (como /api/play) y solo con id de la lista', () => {
  assert.equal(resolve('GET', '/api/emisoras').level, 'oyente');
  assert.equal(resolve('GET', '/api/emisora/la-lupe').level, 'oyente');
  assert.equal(resolve('GET', '/api/emisora/../../etc'), null);
  assert.equal(resolve('GET', '/api/emisora/https:%2F%2Fx'), null, 'nunca una URL: solo ids');
  assert.equal(resolve('POST', '/api/emisora/la-lupe'), null);
});
