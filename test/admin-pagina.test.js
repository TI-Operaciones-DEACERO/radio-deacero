'use strict';
/* /admin: Administración en su propia página (pide la clave de /remote). Y comprobación de que el panel ya no la trae. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { withServer, TOKEN } = require('./helpers/servidor');

const PUB = path.join(__dirname, '..', 'public');
const leer = (f) => fs.readFileSync(path.join(PUB, f), 'utf8');

test('/admin y /admin/ sirven la página, con la misma política de seguridad (CSP) que el panel', async () => {
  await withServer({}, async (s) => {
    for (const p of ['/admin', '/admin/']) {
      const r = await fetch(s.base + p);
      assert.equal(r.status, 200, p);
      assert.match(r.headers.get('content-type'), /text\/html/);
      assert.equal(await r.text(), '<h1>admin</h1>');
      assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
    }
  });
});

test('la página no abre nada por sí sola: sus datos siguen pidiendo la clave (la de /remote)', async () => {
  await withServer({}, async (s, c) => {
    assert.equal((await c.call('GET', '/api/admin/estado')).status, 401);
    assert.equal((await c.call('GET', '/api/admin/usuarios')).status, 401);
    assert.equal((await c.call('GET', '/api/admin/estado', { headers: { 'x-token': 'otra' } })).status, 401);
    assert.equal((await c.call('GET', '/api/admin/estado', { headers: { 'x-token': TOKEN } })).status, 200);
  });
});

test('admin.html: todo lo que carga existe, nada viene de fuera y la clave se pide en la propia página', () => {
  const html = leer('admin.html');
  assert.ok(!/https?:\/\//.test(html.replace(/<!--[\s\S]*?-->/g, '')), 'sin CDN');
  const recursos = [...html.matchAll(/(?:src|href)="(\/[^"#?]+)"/g)].map((m) => m[1]).filter((u) => !/^\/(panel|admin)\/?$/.test(u));
  assert.ok(recursos.length >= 8);
  for (const u of recursos) assert.ok(fs.existsSync(path.join(PUB, u)), 'no existe ' + u);
  assert.match(html, /id="claveForm"/);
  assert.match(html, /type="password"/);
  /* admin-pagina.js (Panel mínimo) debe cargar ANTES que admin.js, y admin-logica antes también */
  const orden = (n) => html.indexOf('/js/panel/' + n);
  assert.ok(orden('admin-logica.js') < orden('admin.js') && orden('admin-pagina.js') < orden('admin.js') && orden('admin.js') < orden('admin-arranque.js'));
  assert.ok(html.indexOf('/js/panel/api.js') < orden('admin-pagina.js'));
});

test('el panel de música ya no trae Administración: ni pestaña, ni sección, ni formulario de clave; solo un enlace a /admin', () => {
  const html = leer('panel-completo.html');
  assert.ok(!/id="tab-admin"|id="p-admin"|id="claveForm"|id="claveIn"|data-vista="admin"/.test(html));
  assert.match(html, /href="\/admin"/);
  const nucleo = leer('js/panel/nucleo.js');
  assert.ok(!/revisarAdmin|tabAdmin|claveOlvidar/.test(nucleo));
  assert.match(nucleo, /location\.replace\('\/admin'\)/, 'un #admin viejo lleva a /admin');
});

test('todo el JavaScript del navegador compila (no hay un navegador en las pruebas: es la red de seguridad contra un error de sintaxis)', () => {
  const dir = path.join(PUB, 'js');
  const archivos = [path.join(dir, 'app.js'), ...fs.readdirSync(path.join(dir, 'panel')).map((f) => path.join(dir, 'panel', f))].filter((f) => f.endsWith('.js'));
  assert.ok(archivos.length > 20);
  for (const f of archivos) assert.doesNotThrow(() => new vm.Script(fs.readFileSync(f, 'utf8'), { filename: f }), path.basename(f));
});
