'use strict';
/* Rutas /api/auth/* y /api/admin/usuarios por HTTP, y la aplicación de la tabla de permisos en el servidor. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { createUsers } = require('../src/users');
const { createSessions } = require('../src/sessions');
const { TOKEN, setup, client, withServer } = require('./helpers/servidor');

test('login: crea la cuenta con la nómina, pone cookie HttpOnly y no devuelve el token', async () => {
  await withServer({}, async (s, c) => {
    const r = await c.call('POST', '/api/auth/login', { body: { nomina: '123456', nombre: 'Ana' } });
    assert.equal(r.status, 200);
    assert.equal(r.json.user.nombre, 'Ana');
    assert.equal(r.json.user.nomina, '123456');
    assert.equal(r.json.nuevo, true);
    const sc = r.setCookie.find((x) => x.startsWith('pl_user='));
    assert.match(sc, /HttpOnly/i);
    assert.match(sc, /SameSite=Lax/i);
    assert.match(sc, /Path=\//);
    assert.match(sc, /Max-Age=604800/);
    assert.ok(!/Secure/i.test(sc));
    const token = sc.split(';')[0].slice('pl_user='.length);
    assert.ok(!r.text.includes(token), 'el token solo va en la cookie');
  });
});

test('me: sin sesión → user null; con sesión → la cuenta; sigue al recargar', async () => {
  await withServer({}, async (s, c) => {
    assert.deepEqual((await c.call('GET', '/api/auth/me')).json, { user: null });
    await c.call('POST', '/api/auth/login', { body: { nomina: '123456' } });
    const me = await c.call('GET', '/api/auth/me');
    assert.equal(me.json.user.nomina, '123456');
    assert.equal((await c.call('GET', '/api/auth/me')).json.user.nomina, '123456');
  });
});

test('reiniciar el servidor (mismos archivos) no cierra la sesión', async () => {
  const s1 = await setup();
  const r = await client(s1.port).call('POST', '/api/auth/login', { body: { nomina: '123456' } });
  const cookie = r.setCookie.find((x) => x.startsWith('pl_user=')).split(';')[0];
  s1.close();
  const s2 = await setup({ users: createUsers({ dir: s1.dir }), sessions: createSessions({ dir: s1.dir }) });
  try {
    const me = await client(s2.port).call('GET', '/api/auth/me', { headers: { cookie } });
    assert.equal(me.json.user.nomina, '123456');
  } finally { s2.close(); }
});

test('logout: borra la sesión en el servidor y la cookie', async () => {
  await withServer({}, async (s, c) => {
    await c.call('POST', '/api/auth/login', { body: { nomina: '123456' } });
    const r = await c.call('POST', '/api/auth/logout', { body: {} });
    assert.equal(r.status, 200);
    assert.match(r.setCookie.find((x) => x.startsWith('pl_user=')), /Max-Age=0/);
    assert.deepEqual((await c.call('GET', '/api/auth/me')).json, { user: null });
  });
});

test('logout sin sesión no falla', async () => {
  await withServer({}, async (s, c) => assert.equal((await c.call('POST', '/api/auth/logout', { body: {} })).status, 200));
});

test('un token robado deja de servir tras salir', async () => {
  await withServer({}, async (s, c) => {
    const r = await c.call('POST', '/api/auth/login', { body: { nomina: '123456' } });
    const cookie = r.setCookie.find((x) => x.startsWith('pl_user=')).split(';')[0];
    await c.call('POST', '/api/auth/logout', { body: {} });
    const c2 = client(s.port);
    assert.deepEqual((await c2.call('GET', '/api/auth/me', { headers: { cookie } })).json, { user: null });
  });
});

test('login con la sesión ya iniciada rota el token (el anterior deja de valer)', async () => {
  await withServer({}, async (s, c) => {
    const r1 = await c.call('POST', '/api/auth/login', { body: { nomina: '123456' } });
    const old = r1.setCookie.find((x) => x.startsWith('pl_user=')).split(';')[0];
    const r2 = await c.call('POST', '/api/auth/login', { body: { nomina: '123456' } });
    const nuevo = r2.setCookie.find((x) => x.startsWith('pl_user=')).split(';')[0];
    assert.notEqual(old, nuevo);
    const c2 = client(s.port);
    assert.deepEqual((await c2.call('GET', '/api/auth/me', { headers: { cookie: old } })).json, { user: null });
  });
});

test('login: nómina inválida → 400 sin cookie', async () => {
  await withServer({}, async (s, c) => {
    for (const nomina of ['abc', '12', '', null, 123456789012, { a: 1 }, ['123456']]) {
      const r = await c.call('POST', '/api/auth/login', { body: { nomina } });
      assert.equal(r.status, 400, JSON.stringify(nomina));
      assert.equal(r.json.error, 'NOMINA_INVALIDA');
      assert.equal(r.setCookie, undefined);
    }
    assert.equal((await c.call('POST', '/api/auth/login', { raw: '{no json' })).status, 400);
  });
});

test('login: nómina fuera de la lista permitida → 403', async () => {
  await withServer({}, async (s, c) => {
    fs.writeFileSync(path.join(s.dir, 'nominas-permitidas.txt'), '111111\n');
    assert.equal((await c.call('POST', '/api/auth/login', { body: { nomina: '111111' } })).status, 200);
    const r = await client(s.port).call('POST', '/api/auth/login', { body: { nomina: '222222' } });
    assert.equal(r.status, 403);
    assert.equal(r.json.error, 'ACCESO_DENEGADO');
  });
});

test('cuenta desactivada: no entra y la sesión que tenía deja de valer', async () => {
  await withServer({}, async (s, c) => {
    const r = await c.call('POST', '/api/auth/login', { body: { nomina: '123456' } });
    s.users.setEstado(r.json.user.id, 'desactivado');
    assert.deepEqual((await c.call('GET', '/api/auth/me')).json, { user: null });
    assert.equal((await client(s.port).call('POST', '/api/auth/login', { body: { nomina: '123456' } })).status, 403);
  });
});

test('límite: 6.º intento seguido desde la misma IP → 429 con Retry-After', async () => {
  await withServer({ loginMax: 5 }, async (s, c) => {
    for (let i = 0; i < 5; i++) assert.equal((await c.call('POST', '/api/auth/login', { body: { nomina: 'x' } })).status, 400);
    const r = await c.call('POST', '/api/auth/login', { body: { nomina: '123456' } });
    assert.equal(r.status, 429);
    assert.ok(Number(r.headers['retry-after']) >= 1);
  });
});

test('profile: cambia el nombre; sin sesión → 401', async () => {
  await withServer({}, async (s, c) => {
    assert.equal((await c.call('POST', '/api/auth/profile', { body: { nombre: 'X' } })).status, 401);
    await c.call('POST', '/api/auth/login', { body: { nomina: '123456', nombre: 'Ana' } });
    const r = await c.call('POST', '/api/auth/profile', { body: { nombre: '  Beto  ' } });
    assert.equal(r.json.user.nombre, 'Beto');
    assert.equal((await c.call('GET', '/api/auth/me')).json.user.nombre, 'Beto');
  });
});

test('export: descarga mis datos; sin sesión → 401', async () => {
  await withServer({}, async (s, c) => {
    assert.equal((await c.call('GET', '/api/auth/export')).status, 401);
    await c.call('POST', '/api/auth/login', { body: { nomina: '123456' } });
    const r = await c.call('GET', '/api/auth/export');
    assert.equal(r.status, 200);
    assert.match(r.headers['content-disposition'], /attachment/);
    assert.equal(r.json.user.nomina, '123456');
  });
});

test('la cuenta NO se puede borrar: no hay ruta para hacerlo y la cuenta y su sesión siguen', async () => {
  await withServer({}, async (s, c) => {
    const r = await c.call('POST', '/api/auth/login', { body: { nomina: '123456' } });
    for (const ruta of ['/api/auth/account', '/api/auth/delete', '/api/auth/borrar']) {
      for (const m of ['DELETE', 'POST', 'GET']) {
        const x = await c.call(m, ruta, { body: m === 'POST' ? {} : undefined });
        assert.ok([401, 404, 405].includes(x.status), `${m} ${ruta} → ${x.status}`);
      }
    }
    assert.equal((await c.call('DELETE', '/api/auth/account')).status, 405);
    assert.ok(s.users.get(r.json.user.id), 'la cuenta sigue');
    assert.equal((await c.call('GET', '/api/auth/me')).json.user.nomina, '123456', 'y la sesión también');
  });
});

test('la interfaz ya no ofrece borrar la cuenta', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
  assert.ok(!/borrar mi cuenta/i.test(read('panel-completo.html')));
  assert.ok(!/borrarCuenta|\/api\/auth\/account/.test(read('js/panel/api.js')));
  assert.ok(!/borrarCuenta|\/api\/auth\/account/.test(read('js/panel/cuenta.js')));
});

test('nada sensible sale en las respuestas: ni hash, ni token, ni datos de otros', async () => {
  await withServer({}, async (s, c) => {
    const r = await c.call('POST', '/api/auth/login', { body: { nomina: '123456' } });
    assert.deepEqual(Object.keys(r.json.user).sort(), ['id', 'nombre', 'nomina']);
  });
});

test('CSRF: otra página no puede mandar acciones con la cookie (Origin distinto → 403)', async () => {
  await withServer({}, async (s, c) => {
    await c.call('POST', '/api/auth/login', { body: { nomina: '123456' } });
    const r = await c.call('POST', '/api/auth/logout', { body: {}, headers: { origin: 'http://malo.example' } });
    assert.equal(r.status, 403);
    assert.equal((await c.call('GET', '/api/auth/me')).json.user.nomina, '123456', 'la sesión sigue viva');
    const ok = await c.call('POST', '/api/auth/logout', { body: {}, headers: { origin: `http://127.0.0.1:${s.port}` } });
    assert.equal(ok.status, 200);
  });
});

test('CSRF: el cuerpo de una acción debe ser application/json', async () => {
  await withServer({}, async (s, c) => {
    const r = await c.call('POST', '/api/auth/login', { raw: 'nomina=123456', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    assert.equal(r.status, 415);
  });
});

test('cuerpo demasiado grande → 413', async () => {
  await withServer({}, async (s, c) => {
    const r = await c.call('POST', '/api/auth/login', { raw: JSON.stringify({ nomina: '123456', nombre: 'x'.repeat(10000) }) });
    assert.equal(r.status, 413);
  });
});

/* — administración de usuarios: solo con la clave — */
const adm = { 'x-token': TOKEN };

test('admin: sin clave no responde nada', async () => {
  await withServer({}, async (s, c) => {
    for (const [m, u] of [['GET', '/api/admin/usuarios'], ['PATCH', '/api/admin/usuarios/0123456789abcdef'], ['DELETE', '/api/admin/usuarios/0123456789abcdef']]) {
      const r = await c.call(m, u, { body: m === 'PATCH' ? { estado: 'desactivado' } : undefined });
      assert.equal(r.status, 401, `${m} ${u}`);
      assert.ok(!r.text.includes('nomina'));
    }
  });
});

test('admin: una sesión de cuenta NO da acceso a administración', async () => {
  await withServer({}, async (s, c) => {
    await c.call('POST', '/api/auth/login', { body: { nomina: '123456' } });
    assert.equal((await c.call('GET', '/api/admin/usuarios')).status, 401);
  });
});

test('admin: listar, desactivar, reactivar y borrar', async () => {
  await withServer({}, async (s, c) => {
    const r = await client(s.port).call('POST', '/api/auth/login', { body: { nomina: '123456', nombre: 'Ana' } });
    const id = r.json.user.id;
    const list = await c.call('GET', '/api/admin/usuarios', { headers: adm });
    assert.equal(list.status, 200);
    assert.equal(list.json.length, 1);
    assert.equal(list.json[0].estado, 'activo');
    assert.equal((await c.call('PATCH', `/api/admin/usuarios/${id}`, { body: { estado: 'desactivado' }, headers: adm })).json.estado, 'desactivado');
    assert.equal((await c.call('PATCH', `/api/admin/usuarios/${id}`, { body: { estado: 'raro' }, headers: adm })).status, 400);
    assert.equal((await c.call('PATCH', '/api/admin/usuarios/ffffffffffffffff', { body: { estado: 'activo' }, headers: adm })).status, 404);
    assert.equal((await c.call('DELETE', `/api/admin/usuarios/${id}`, { headers: adm })).status, 204);
    assert.equal((await c.call('DELETE', `/api/admin/usuarios/${id}`, { headers: adm })).status, 404);
  });
});

test('admin: desactivar cierra sus sesiones al instante', async () => {
  await withServer({}, async (s, c) => {
    const u = client(s.port);
    const r = await u.call('POST', '/api/auth/login', { body: { nomina: '123456' } });
    await c.call('PATCH', `/api/admin/usuarios/${r.json.user.id}`, { body: { estado: 'desactivado' }, headers: adm });
    assert.deepEqual((await u.call('GET', '/api/auth/me')).json, { user: null });
  });
});

/* — la tabla de permisos manda — */
test('permisos: un método que la tabla no permite → 405, y PUT/PATCH/DELETE ya no se cuelan', async () => {
  await withServer({}, async (s, c) => {
    for (const [m, u] of [['PUT', '/api/cmd'], ['PATCH', '/api/genres'], ['DELETE', '/api/genres'], ['POST', '/api/auth/me'], ['GET', '/api/auth/login'], ['POST', '/']]) {
      assert.equal((await c.call(m, u, { headers: adm, body: m === 'GET' ? undefined : {} })).status, 405, `${m} ${u}`);
    }
  });
});

test('permisos: las rutas de siempre conservan su comportamiento', async () => {
  await withServer({}, async (s, c) => {
    assert.equal((await c.call('GET', '/api/health')).status, 200);
    assert.equal((await c.call('GET', '/api/genres')).status, 200, 'oyente: sin clave');
    assert.equal((await c.call('GET', '/api/state')).status, 401);
    assert.equal((await c.call('GET', '/api/state', { headers: adm })).status, 200);
    assert.equal((await c.call('GET', '/api/next')).status, 401, 'sin sid pide clave');
    assert.equal((await c.call('GET', '/api/inventada', { headers: adm })).status, 404);
    assert.equal((await c.call('GET', '/api/inventada')).status, 401);
  });
});

test('permisos: PANEL_PUBLICO=0 vuelve a pedir clave en las rutas de oyente', async () => {
  await withServer({ panelOpen: false }, async (s, c) => {
    assert.equal((await c.call('GET', '/api/genres')).status, 401);
    assert.equal((await c.call('GET', '/api/genres', { headers: adm })).status, 200);
  });
});

test('/api/genres: añade desc, mood y energy sin quitar ningún campo anterior', async () => {
  const genres = [{ id: 'jazz', label: 'Jazz', emoji: '🎷', color: '#f90', featured: true, desc: 'Clásico', mood: 'calm', energy: 0.3, queries: ['secreta'] }];
  await withServer({ genres }, async (s, c) => {
    const [g] = (await c.call('GET', '/api/genres')).json;
    assert.deepEqual(g, { id: 'jazz', label: 'Jazz', emoji: '🎷', color: '#f90', featured: true, desc: 'Clásico', mood: 'calm', energy: 0.3 });
    assert.ok(!('queries' in g), 'las consultas siguen sin salir');
  });
});

test('/panel/completo: detrás de la bandera; /panel y /remote siguen igual', async () => {
  await withServer({ panelV2: true }, async (s, c) => {
    assert.match((await c.call('GET', '/panel/completo')).text, /completo/);
    assert.match((await c.call('GET', '/panel/completo/')).text, /completo/);
    assert.match((await c.call('GET', '/panel')).text, /control/, '/panel sigue siendo el de hoy');
    assert.match((await c.call('GET', '/remote')).text, /control/);
  });
  await withServer({ panelV2: false }, async (s, c) => {
    assert.equal((await c.call('GET', '/panel/completo')).status, 404);
    assert.match((await c.call('GET', '/panel')).text, /control/);
  });
  await withServer({}, async (s, c) => {
    assert.equal((await c.call('GET', '/panel/completo')).status, 404, 'apagado por defecto en el servidor (el arranque lo enciende)');
  });
});

test('Fase 8: con panelPrincipal "completo", /panel es el panel completo y el de siempre queda en /panel/simple', async () => {
  await withServer({ panelV2: true, panelPrincipal: 'completo' }, async (s, c) => {
    for (const p of ['/panel', '/panel/', '/panel/completo']) assert.match((await c.call('GET', p)).text, /completo/, p);
    for (const p of ['/panel/simple', '/panel/simple/', '/remote']) assert.match((await c.call('GET', p)).text, /control/, p);
    const r = await c.call('GET', '/panel');
    assert.ok(r.headers['content-security-policy'], 'el panel completo lleva su CSP también en /panel');
  });
  await withServer({ panelV2: false, panelPrincipal: 'completo' }, async (s, c) => {
    assert.match((await c.call('GET', '/panel')).text, /control/, 'sin PANEL_V2 no hay panel completo: /panel sigue siendo el de siempre');
  });
  await withServer({ panelV2: true }, async (s, c) => {
    assert.match((await c.call('GET', '/panel/simple')).text, /control/, '/panel/simple existe siempre (marcadores nuevos)');
  });
});

/* — correcciones de la auditoría de seguridad — */
function crudo(port, texto) {
  return new Promise((resolve) => {
    const sock = net.connect(port, '127.0.0.1', () => sock.write(texto));
    let out = '';
    sock.on('data', (d) => { out += d; });
    sock.on('close', () => resolve(out));
    sock.on('error', () => resolve(out));
    setTimeout(() => { sock.destroy(); }, 600);
  });
}

test('una URL rara (GET //) no tumba el servidor: 400 y sigue vivo', async () => {
  await withServer({}, async (s, c) => {
    for (const ruta of ['//', '///x', 'http://']) {
      const out = await crudo(s.port, 'GET ' + ruta + ' HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n');
      assert.match(out, ruta === '//' ? /^HTTP\/1\.1 400/ : /^HTTP\/1\.1 \d{3}/, ruta);
    }
    assert.equal((await c.call('GET', '/api/health')).status, 200, 'sigue respondiendo');
  });
});

test('admin sin REMOTE_TOKEN: solo desde la propia máquina, nunca abierto a la red', async () => {
  await withServer({ token: '', trustLoopback: false }, async (s, c) => {
    assert.equal((await c.call('GET', '/api/admin/usuarios')).status, 401);
    assert.equal((await c.call('DELETE', '/api/admin/usuarios/0123456789abcdef')).status, 401);
  });
  await withServer({ token: '', trustLoopback: true }, async (s, c) => {
    assert.equal((await c.call('GET', '/api/admin/usuarios')).status, 200, 'desde la propia máquina sí');
  });
});

test('Host ajeno en cuenta/administración → 421 (DNS rebinding); IP, localhost y el nombre del equipo sí', async () => {
  await withServer({}, async (s, c) => {
    for (const host of ['malo.example', 'malo.example:8000', 'api.deacero.com.malo.example']) {
      assert.equal((await c.call('GET', '/api/auth/me', { headers: { host } })).status, 421, host);
      assert.equal((await c.call('GET', '/api/admin/usuarios', { headers: { host, ...adm } })).status, 421, host);
    }
    for (const host of [`127.0.0.1:${s.port}`, `localhost:${s.port}`, `[::1]:${s.port}`, `${os.hostname()}:${s.port}`, `${os.hostname()}.corp.local:${s.port}`, '172.23.6.40:8000']) {
      assert.equal((await c.call('GET', '/api/auth/me', { headers: { host } })).status, 200, host);
    }
  });
  await withServer({ hostsPermitidos: ['play.interno'] }, async (s, c) => {
    assert.equal((await c.call('GET', '/api/auth/me', { headers: { host: 'play.interno' } })).status, 200);
  });
});

/* La pantalla se sirve por el nombre DNS de SU máquina (nombre + dominio): eso sigue funcionando. Un nombre que no es de esta máquina
 * se rechaza SOLO cuando la petición viene de la propia máquina (ahí es donde el rebinding abusaría de la confianza de loopback);
 * desde otros equipos no cambia nada (ver seguridad2.test.js). */
test('las rutas de siempre se sirven por el nombre DNS de la propia máquina', async () => {
  await withServer({}, async (s, c) => {
    assert.equal((await c.call('GET', '/api/genres', { headers: { host: `${os.hostname()}.gpodeacero.corp:8000` } })).status, 200);
    assert.equal((await c.call('GET', '/api/genres', { headers: { host: `${os.hostname()}:8000` } })).status, 200);
  });
});

test('profile y account también pasan por el límite de peticiones', async () => {
  await withServer({ loginMax: 3 }, async (s, c) => {
    await c.call('POST', '/api/auth/login', { body: { nomina: '123456' } });
    let ultimo;
    for (let i = 0; i < 80; i++) ultimo = await c.call('POST', '/api/auth/profile', { body: { nombre: 'n' + i } });
    assert.equal(ultimo.status, 429);
  });
});

test('nómina no autorizada y cuenta desactivada responden igual (no se puede saber cuál es cuál)', async () => {
  await withServer({}, async (s, c) => {
    fs.writeFileSync(path.join(s.dir, 'nominas-permitidas.txt'), '111111\n222222\n');
    const u = await client(s.port).call('POST', '/api/auth/login', { body: { nomina: '222222' } });
    s.users.setEstado(u.json.user.id, 'desactivado');
    const a = await client(s.port).call('POST', '/api/auth/login', { body: { nomina: '999999' } });
    const b = await client(s.port).call('POST', '/api/auth/login', { body: { nomina: '222222' } });
    assert.equal(a.status, 403);
    assert.deepEqual([b.status, b.json], [a.status, a.json]);
  });
});

test('cabeceras de seguridad: nosniff y no se puede enmarcar desde otro sitio', async () => {
  await withServer({}, async (s, c) => {
    for (const ruta of ['/api/health', '/', '/panel/completo']) {
      const r = await c.call('GET', ruta);
      assert.equal(r.headers['x-content-type-options'], 'nosniff', ruta);
      assert.equal(r.headers['x-frame-options'], 'SAMEORIGIN', ruta);
    }
  });
});

test('el tipo de contenido se exige también con Transfer-Encoding: chunked', async () => {
  await withServer({}, async (s) => {
    const r = await new Promise((resolve) => {
      const req = http.request({ host: '127.0.0.1', port: s.port, path: '/api/auth/login', method: 'POST', headers: { 'content-type': 'text/plain', 'transfer-encoding': 'chunked' } }, (res) => { res.resume(); resolve(res.statusCode); });
      req.write('{"nomina":"123456"}');
      req.end();
    });
    assert.equal(r, 415);
  });
});

test('hay un tope global de sesiones (se descartan las más viejas)', async () => {
  const { createSessions } = require('../src/sessions');
  const ses = createSessions({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'play-s-')), maxTotal: 5, maxPerUser: 10 });
  const tokens = Array.from({ length: 8 }, (_, i) => ses.create('u' + i));
  assert.equal(tokens.filter((t) => ses.verify(t)).length, 5);
  assert.equal(ses.verify(tokens[0]), null);
  assert.ok(ses.verify(tokens[7]));
});

test('IPv6: todas las direcciones de un mismo /64 comparten límite', async () => {
  const { ipKey } = require('../src/http');
  assert.equal(ipKey('::ffff:10.1.2.3'), '10.1.2.3');
  assert.equal(ipKey('10.1.2.3'), '10.1.2.3');
  assert.equal(ipKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), ipKey('2001:db8:1:2::1'));
  assert.notEqual(ipKey('2001:db8:1:2::1'), ipKey('2001:db8:1:3::1'));
  assert.equal(ipKey(undefined), '?');
});
