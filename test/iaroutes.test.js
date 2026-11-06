'use strict';
/* /api/ia/* por HTTP: abiertas al oyente (como /panel), con límite de ritmo, personalizadas si hay cuenta. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { withServer, client } = require('./helpers/servidor');

const crear = () => {
  const llamadas = [];
  const rec = (nombre, extra = {}) => async (o) => { llamadas.push({ nombre, ...o }); return { fuente: 'local', items: [], generos: [], consultas: [], ...extra }; };
  return {
    llamadas,
    ia: { ahora: rec('ahora'), podcasts: rec('podcasts'), artistas: rec('artistas'), paraTi: rec('paraTi'), descubrir: rec('descubrir'), playlist: rec('playlist'), gemini: () => ({ enabled: true, model: 'm', cooling: false }) }
  };
};

test('las rutas de IA no piden clave ni cuenta (igual que /panel)', async () => {
  const { ia } = crear();
  await withServer({ ia }, async (s, c) => {
    for (const u of ['/api/ia/ahora', '/api/ia/podcasts', '/api/ia/artistas?genero=jazz', '/api/ia/playlist?q=jazz', '/api/ia/para-ti?sid=abcdefgh1234', '/api/ia/descubrir?sid=abcdefgh1234']) {
      assert.equal((await c.call('GET', u)).status, 200, u);
    }
  });
});

test('para-ti y descubrir exigen id de sesión; sin él piden clave como cualquier ruta cerrada', async () => {
  const { ia } = crear();
  await withServer({ ia }, async (s, c) => {
    assert.equal((await c.call('GET', '/api/ia/para-ti')).status, 401);
    assert.equal((await c.call('GET', '/api/ia/descubrir?sid=x')).status, 401);
    assert.equal((await c.call('GET', '/api/ia/para-ti', { headers: { 'x-token': 'clave-de-prueba' } })).status, 200, 'con la clave se abre');
  });
});

test('PANEL_PUBLICO=0 también cierra la IA', async () => {
  const { ia } = crear();
  await withServer({ ia, panelOpen: false }, async (s, c) => {
    assert.equal((await c.call('GET', '/api/ia/ahora')).status, 401);
  });
});

test('solo GET: lo demás da 405', async () => {
  const { ia } = crear();
  await withServer({ ia }, async (s, c) => {
    assert.equal((await c.call('POST', '/api/ia/ahora', { body: {} })).status, 405);
    assert.equal((await c.call('DELETE', '/api/ia/playlist')).status, 405);
  });
});

test('la hora sale del reloj del servidor (corregido), no de lo que mande el navegador', async () => {
  const { ia, llamadas } = crear();
  await withServer({ ia }, async (s, c) => {
    await c.call('GET', '/api/ia/ahora?hour=3&h=3');
    const esperada = new Date(s.now.t).getHours();
    assert.equal(llamadas.at(-1).hour, esperada);
  });
});

test('sin cuenta: gustos vacíos; con cuenta: sus gustos reales', async () => {
  const { ia, llamadas } = crear();
  await withServer({ ia }, async (s) => {
    const anon = client(s.port);
    await anon.call('GET', '/api/ia/ahora');
    assert.equal(llamadas.at(-1).taste.total, 0);
    const c = client(s.port);
    await c.call('POST', '/api/auth/login', { body: { nomina: '123456' } });
    await c.call('POST', '/api/me/reactions', { body: { track: { id: 'x'.repeat(11), title: 't', channel: 'c', duration: 1, genre: 'jazz' }, r: 'like' } });
    await c.call('GET', '/api/ia/ahora');
    assert.deepEqual(llamadas.at(-1).taste.generos.gustan, ['jazz']);
  });
});

test('parámetros: se acotan y se validan', async () => {
  const { ia, llamadas } = crear();
  await withServer({ ia }, async (s, c) => {
    await c.call('GET', '/api/ia/playlist?q=' + encodeURIComponent('x'.repeat(500)));
    assert.equal(llamadas.at(-1).texto.length, 200);
    assert.equal((await c.call('GET', '/api/ia/playlist')).status, 400, 'sin q');
    assert.equal((await c.call('GET', '/api/ia/artistas')).status, 400, 'sin genero');
    assert.equal((await c.call('GET', '/api/ia/artistas?genero=' + encodeURIComponent('../x'))).status, 400);
    await c.call('GET', '/api/ia/descubrir?sid=abcdefgh1234&prefer=banda,pop&avoid=rock');
    assert.deepEqual(llamadas.at(-1).prefer, ['banda', 'pop']);
    assert.deepEqual(llamadas.at(-1).avoid, ['rock']);
    await c.call('GET', '/api/ia/ahora?recientes=jazz,rock,' + 'x'.repeat(100));
    assert.deepEqual(llamadas.at(-1).recientes, ['jazz', 'rock']);
    assert.equal((await c.call('GET', '/api/ia/para-ti?sid=' + encodeURIComponent('mal sid'))).status, 401, 'sid inválido no abre la ruta');
  });
});

test('límite de ritmo por IP: pasado el máximo → 429', async () => {
  const { ia } = crear();
  await withServer({ ia, iaMax: 5 }, async (s, c) => {
    for (let i = 0; i < 5; i++) assert.equal((await c.call('GET', '/api/ia/ahora')).status, 200);
    const r = await c.call('GET', '/api/ia/ahora');
    assert.equal(r.status, 429);
    assert.ok(Number(r.headers['retry-after']) >= 1);
  });
});

test('si la IA lanza un error inesperado, se responde 503 sin detalles internos', async () => {
  const ia = { ahora: async () => { throw new Error('secreto interno ' + 'AIzaXYZ'); }, gemini: () => ({}) };
  await withServer({ ia }, async (s, c) => {
    const r = await c.call('GET', '/api/ia/ahora');
    assert.equal(r.status, 503);
    assert.ok(!r.text.includes('AIza') && !r.text.includes('secreto'));
  });
});

test('estado de la IA: solo con clave de administración y sin exponer la clave de Gemini', async () => {
  const { ia } = crear();
  await withServer({ ia }, async (s, c) => {
    assert.equal((await c.call('GET', '/api/ia/estado')).status, 401);
    const r = await c.call('GET', '/api/ia/estado', { headers: { 'x-token': 'clave-de-prueba' } });
    assert.equal(r.status, 200);
    assert.equal(r.json.gemini.enabled, true);
    assert.ok(!('key' in r.json.gemini));
  });
});

test('sin motor de IA configurado: 404', async () => {
  await withServer({}, async (s, c) => {
    assert.equal((await c.call('GET', '/api/ia/ahora')).status, 404);
  });
});
