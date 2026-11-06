'use strict';
/* /api/me/*: la biblioteca de cada cuenta por HTTP. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { withServer, client } = require('./helpers/servidor');

const id = (n) => String(n).padStart(11, 'x');
const T = (n, extra = {}) => ({ id: id(n), title: 'Canción ' + n, channel: 'Canal ' + n, duration: 200, ...extra });

async function conCuenta(fn, nomina = '123456') {
  await withServer({}, async (s, c) => {
    await c.call('POST', '/api/auth/login', { body: { nomina } });
    await fn(s, c);
  });
}

test('sin sesión, todo /api/me/* da 401', async () => {
  await withServer({}, async (s, c) => {
    for (const [m, u] of [['GET', '/api/me/reactions'], ['POST', '/api/me/reactions'], ['POST', '/api/me/reactions/merge'], ['GET', '/api/me/playlists'],
      ['POST', '/api/me/playlists'], ['GET', '/api/me/playlists/abcdef12'], ['PATCH', '/api/me/playlists/abcdef12'], ['DELETE', '/api/me/playlists/abcdef12'],
      ['POST', '/api/me/playlists/abcdef12/tracks'], ['DELETE', '/api/me/playlists/abcdef12/tracks/' + id(1)], ['GET', '/api/me/history'],
      ['POST', '/api/me/history'], ['DELETE', '/api/me/history'], ['GET', '/api/me/taste'], ['GET', '/api/me/prefs'], ['POST', '/api/me/prefs']]) {
      const r = await c.call(m, u, { body: m === 'GET' || m === 'DELETE' ? undefined : {} });
      assert.equal(r.status, 401, `${m} ${u}`);
    }
  });
});

test('la clave de administración tampoco sirve para /api/me/* (es de la cuenta, no del admin)', async () => {
  await withServer({}, async (s, c) => {
    assert.equal((await c.call('GET', '/api/me/reactions', { headers: { 'x-token': 'clave-de-prueba' } })).status, 401);
  });
});

test('reacciones: poner, leer, cambiar y quitar', async () => {
  await conCuenta(async (s, c) => {
    assert.deepEqual((await c.call('GET', '/api/me/reactions')).json, []);
    assert.equal((await c.call('POST', '/api/me/reactions', { body: { track: T(1, { genre: 'jazz' }), r: 'like' } })).status, 200);
    assert.equal((await c.call('POST', '/api/me/reactions', { body: { track: T(2), r: 'dislike' } })).status, 200);
    const l = (await c.call('GET', '/api/me/reactions')).json;
    assert.equal(l.length, 2);
    assert.equal(l[0].track.id, id(2));
    assert.equal((await c.call('POST', '/api/me/reactions', { body: { track: T(1), r: null } })).status, 200);
    assert.equal((await c.call('GET', '/api/me/reactions')).json.length, 1);
  });
});

test('reacciones: datos inválidos → 400', async () => {
  await conCuenta(async (s, c) => {
    for (const body of [{ track: { id: 'mal' }, r: 'like' }, { track: T(1), r: 'raro' }, { r: 'like' }, { track: T(1) }]) {
      assert.equal((await c.call('POST', '/api/me/reactions', { body })).status, 400, JSON.stringify(body));
    }
  });
});

test('merge: acepta una lista grande (más que el límite normal de cuerpo)', async () => {
  await conCuenta(async (s, c) => {
    const items = Array.from({ length: 200 }, (_, i) => ({ track: T(i + 1, { title: 'x'.repeat(250) }), r: 'like' }));
    const r = await c.call('POST', '/api/me/reactions/merge', { body: { items } });
    assert.equal(r.status, 200);
    assert.equal(r.json.added, 200);
    assert.equal((await c.call('GET', '/api/me/reactions')).json.length, 200);
  });
});

test('merge: pasarse del tope de cuerpo → 413', async () => {
  await conCuenta(async (s, c) => {
    const r = await c.call('POST', '/api/me/reactions/merge', { raw: JSON.stringify({ items: [], relleno: 'x'.repeat(300000) }) });
    assert.equal(r.status, 413);
  });
});

test('playlists: ciclo completo por HTTP', async () => {
  await conCuenta(async (s, c) => {
    const crear = await c.call('POST', '/api/me/playlists', { body: { name: 'Mis favoritas' } });
    assert.equal(crear.status, 201);
    const pid = crear.json.playlist.id;
    assert.equal((await c.call('POST', `/api/me/playlists/${pid}/tracks`, { body: { track: T(1) } })).status, 200);
    assert.equal((await c.call('POST', `/api/me/playlists/${pid}/tracks`, { body: { track: T(2) } })).status, 200);
    assert.equal((await c.call('GET', '/api/me/playlists')).json[0].count, 2);
    const una = (await c.call('GET', `/api/me/playlists/${pid}`)).json;
    assert.deepEqual(una.tracks.map((t) => t.id), [id(1), id(2)]);
    assert.equal((await c.call('PATCH', `/api/me/playlists/${pid}`, { body: { name: 'Otro nombre' } })).json.playlist.name, 'Otro nombre');
    assert.equal((await c.call('DELETE', `/api/me/playlists/${pid}/tracks/${id(1)}`)).status, 204);
    assert.equal((await c.call('DELETE', `/api/me/playlists/${pid}/tracks/${id(1)}`)).status, 404);
    assert.equal((await c.call('DELETE', `/api/me/playlists/${pid}`)).status, 204);
    assert.equal((await c.call('GET', `/api/me/playlists/${pid}`)).status, 404);
  });
});

test('playlists: sin nombre → 400; pista inválida → 400', async () => {
  await conCuenta(async (s, c) => {
    assert.equal((await c.call('POST', '/api/me/playlists', { body: { name: '  ' } })).status, 400);
    const pid = (await c.call('POST', '/api/me/playlists', { body: { name: 'a' } })).json.playlist.id;
    assert.equal((await c.call('POST', `/api/me/playlists/${pid}/tracks`, { body: { track: { id: 'x' } } })).status, 400);
  });
});

test('IDOR: otra cuenta no puede leer, cambiar ni borrar mis playlists ni mis Me gusta', async () => {
  await withServer({}, async (s) => {
    const ana = client(s.port), beto = client(s.port);
    await ana.call('POST', '/api/auth/login', { body: { nomina: '111111' } });
    await beto.call('POST', '/api/auth/login', { body: { nomina: '222222' } });
    const pid = (await ana.call('POST', '/api/me/playlists', { body: { name: 'privada' } })).json.playlist.id;
    await ana.call('POST', `/api/me/playlists/${pid}/tracks`, { body: { track: T(1) } });
    await ana.call('POST', '/api/me/reactions', { body: { track: T(1), r: 'like' } });
    await ana.call('POST', '/api/me/history', { body: { track: T(1) } });

    assert.equal((await beto.call('GET', `/api/me/playlists/${pid}`)).status, 404);
    assert.equal((await beto.call('PATCH', `/api/me/playlists/${pid}`, { body: { name: 'hackeada' } })).status, 404);
    assert.equal((await beto.call('POST', `/api/me/playlists/${pid}/tracks`, { body: { track: T(2) } })).status, 404);
    assert.equal((await beto.call('DELETE', `/api/me/playlists/${pid}/tracks/${id(1)}`)).status, 404);
    assert.equal((await beto.call('DELETE', `/api/me/playlists/${pid}`)).status, 404);
    assert.deepEqual((await beto.call('GET', '/api/me/playlists')).json, []);
    assert.deepEqual((await beto.call('GET', '/api/me/reactions')).json, []);
    assert.deepEqual((await beto.call('GET', '/api/me/history')).json, []);
    assert.equal((await ana.call('GET', `/api/me/playlists/${pid}`)).json.tracks.length, 1, 'lo de Ana intacto');
    assert.equal((await ana.call('GET', '/api/me/playlists')).json[0].name, 'privada');
  });
});

test('el id de la cuenta no se puede mandar en la petición: lo que venga en el cuerpo se ignora', async () => {
  await withServer({}, async (s) => {
    const ana = client(s.port), beto = client(s.port);
    const a = await ana.call('POST', '/api/auth/login', { body: { nomina: '111111' } });
    await beto.call('POST', '/api/auth/login', { body: { nomina: '222222' } });
    await beto.call('POST', '/api/me/reactions', { body: { track: T(1), r: 'like', uid: a.json.user.id, user: a.json.user.id } });
    assert.equal((await ana.call('GET', '/api/me/reactions')).json.length, 0);
    assert.equal((await beto.call('GET', '/api/me/reactions')).json.length, 1);
  });
});

test('historial: registrar, leer y borrar', async () => {
  await conCuenta(async (s, c) => {
    await c.call('POST', '/api/me/history', { body: { track: T(1) } });
    await c.call('POST', '/api/me/history', { body: { track: T(2) } });
    assert.deepEqual((await c.call('GET', '/api/me/history')).json.map((h) => h.track.id), [id(2), id(1)]);
    assert.equal((await c.call('DELETE', '/api/me/history')).status, 204);
    assert.deepEqual((await c.call('GET', '/api/me/history')).json, []);
  });
});

test('gustos y preferencias', async () => {
  await conCuenta(async (s, c) => {
    await c.call('POST', '/api/me/reactions', { body: { track: T(1, { genre: 'jazz' }), r: 'like' } });
    assert.deepEqual((await c.call('GET', '/api/me/taste')).json.generos.gustan, ['jazz']);
    assert.equal((await c.call('POST', '/api/me/prefs', { body: { bienestar: { estado: 'cansado' } } })).status, 200);
    assert.deepEqual((await c.call('GET', '/api/me/prefs')).json, { bienestar: { estado: 'cansado' } });
    assert.equal((await c.call('POST', '/api/me/prefs', { body: { bienestar: 'x'.repeat(3000) } })).status, 400);
  });
});

test('mis datos se conservan: salir y volver a entrar con la misma nómina los devuelve', async () => {
  await withServer({}, async (s, c) => {
    await c.call('POST', '/api/auth/login', { body: { nomina: '123456' } });
    await c.call('POST', '/api/me/reactions', { body: { track: T(1), r: 'like' } });
    assert.equal((await c.call('DELETE', '/api/auth/account')).status, 405, 'no hay borrado de cuenta');
    await c.call('POST', '/api/auth/logout', { body: {} });
    await c.call('POST', '/api/auth/login', { body: { nomina: '123456' } });
    assert.equal((await c.call('GET', '/api/me/reactions')).json.length, 1);
  });
});

test('exportar mis datos incluye mi biblioteca', async () => {
  await conCuenta(async (s, c) => {
    await c.call('POST', '/api/me/reactions', { body: { track: T(1), r: 'like' } });
    const e = (await c.call('GET', '/api/auth/export')).json;
    assert.equal(e.datos.reactions.length, 1);
  });
});

test('/api/next con cuenta: lo que no me gusta se evita en la rotación de esa sesión', async () => {
  const llamadas = [];
  await withServer({ radio: { next: async (o) => { llamadas.push(o); return { track: { id: id(9) } }; } } }, async (s, c) => {
    await c.call('POST', '/api/auth/login', { body: { nomina: '123456' } });
    for (const n of [1, 2, 3]) await c.call('POST', '/api/me/reactions', { body: { track: T(n, { genre: 'pop' }), r: 'dislike' } });
    await c.call('POST', '/api/me/reactions', { body: { track: T(4, { genre: 'jazz' }), r: 'like' } });
    await c.call('GET', '/api/next?sid=abcdefgh1234');
    assert.deepEqual(llamadas.at(-1).avoidGenres, ['pop']);
    await client(s.port).call('GET', '/api/next?sid=abcdefgh5678');
    assert.equal(llamadas.at(-1).avoidGenres, undefined, 'sin cuenta no hay filtro');
  });
});
