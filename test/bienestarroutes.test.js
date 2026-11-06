'use strict';
/* /api/bienestar/*: planear el viaje de ESTE oyente (su sesión) y detenerlo. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { withServer, client } = require('./helpers/servidor');

const genres = require('../data/genres.json');
const SID = 'oyente-prueba-01';

const crear = () => {
  const calls = [];
  return { calls, radio: { next: async () => ({}), startViaje: (...a) => { calls.push(['start', ...a]); return true; }, stopViaje: (id) => { calls.push(['stop', id]); return true; } } };
};

test('opciones: públicas, con los 18 ánimos', async () => {
  const { radio } = crear();
  await withServer({ radio, genres }, async (s, c) => {
    const r = await c.call('GET', '/api/bienestar/opciones');
    assert.equal(r.status, 200);
    assert.equal(r.json.animos.length, 18);
    assert.equal(r.json.estilos.length, 11);
  });
});

test('viaje: sin id de sesión pide clave (como cualquier ruta cerrada); con id funciona sin clave', async () => {
  const { radio, calls } = crear();
  await withServer({ radio, genres }, async (s, c) => {
    assert.equal((await c.call('POST', '/api/bienestar/viaje', { body: { estado: 'estresado' } })).status, 401);
    assert.equal((await c.call('POST', '/api/bienestar/viaje?sid=mal%20sid', { body: { estado: 'estresado' } })).status, 401);
    const r = await c.call('POST', `/api/bienestar/viaje?sid=${SID}`, { body: { estado: 'estresado', destino: 'relajar', duracion: 'corta' } });
    assert.equal(r.status, 200);
    assert.equal(r.json.fases.length, 5);
    assert.equal(r.json.temasPorFase, 2);
    assert.deepEqual(calls.at(-1).slice(0, 2), ['start', SID]);
    assert.equal(calls.at(-1)[2].fases.length, 5);
  });
});

test('viaje: el texto libre se interpreta y se acota', async () => {
  const { radio } = crear();
  await withServer({ radio, genres }, async (s, c) => {
    const r = await c.call('POST', `/api/bienestar/viaje?sid=${SID}`, { body: { texto: 'me siento agotado ' + 'x'.repeat(2000) } });
    assert.equal(r.status, 200);
    assert.equal(r.json.animo.id, 'agotado');
  });
});

test('viaje: datos raros no rompen (se usan valores por defecto)', async () => {
  const { radio } = crear();
  await withServer({ radio, genres }, async (s, c) => {
    const r = await c.call('POST', `/api/bienestar/viaje?sid=${SID}`, { body: { estado: 5, destino: { a: 1 }, intensidad: [], duracion: 'infinita', estilo: '__proto__' } });
    assert.equal(r.status, 200);
    assert.equal(r.json.temasPorFase, 3);
    assert.equal((await c.call('POST', `/api/bienestar/viaje?sid=${SID}`, { raw: '{no json' })).status, 400);
  });
});

test('viaje: con cuenta se evitan los géneros que rechaza', async () => {
  const { radio } = crear();
  await withServer({ radio, genres }, async (s) => {
    const c = client(s.port);
    await c.call('POST', '/api/auth/login', { body: { nomina: '123456' } });
    for (const g of ['jazz', 'lofi', 'classical']) await c.call('POST', '/api/me/reactions', { body: { track: { id: ('d' + g).padEnd(11, 'x').slice(0, 11), title: 't', channel: 'c', duration: 1, genre: g }, r: 'dislike' } });
    for (let i = 0; i < 6; i++) {
      const r = await c.call('POST', `/api/bienestar/viaje?sid=${SID}`, { body: { estado: 'estresado', destino: 'relajar' } });
      for (const f of r.json.fases) for (const g of f.generos) assert.ok(!['jazz', 'lofi', 'classical'].includes(g.id), g.id);
    }
  });
});

test('detener: DELETE con sid → 204 y avisa al radio; sin sid pide clave', async () => {
  const { radio, calls } = crear();
  await withServer({ radio, genres }, async (s, c) => {
    assert.equal((await c.call('DELETE', '/api/bienestar/viaje')).status, 401);
    assert.equal((await c.call('DELETE', `/api/bienestar/viaje?sid=${SID}`)).status, 204);
    assert.deepEqual(calls.at(-1), ['stop', SID]);
  });
});

test('PANEL_PUBLICO=0 cierra Bienestar', async () => {
  const { radio } = crear();
  await withServer({ radio, genres, panelOpen: false }, async (s, c) => {
    assert.equal((await c.call('GET', '/api/bienestar/opciones')).status, 401);
    assert.equal((await c.call('POST', `/api/bienestar/viaje?sid=${SID}`, { body: {} })).status, 401);
  });
});

test('viaje: otra página no puede iniciarlo (Origin ajeno → 403) y exige JSON', async () => {
  const { radio } = crear();
  await withServer({ radio, genres }, async (s, c) => {
    assert.equal((await c.call('POST', `/api/bienestar/viaje?sid=${SID}`, { body: {}, headers: { origin: 'http://malo.example' } })).status, 403);
    assert.equal((await c.call('POST', `/api/bienestar/viaje?sid=${SID}`, { raw: 'estado=x', headers: { 'content-type': 'text/plain' } })).status, 415);
  });
});

test('viaje: límite de ritmo por IP', async () => {
  const { radio } = crear();
  await withServer({ radio, genres, bienestarMax: 3 }, async (s, c) => {
    for (let i = 0; i < 3; i++) assert.equal((await c.call('POST', `/api/bienestar/viaje?sid=${SID}`, { body: {} })).status, 200);
    assert.equal((await c.call('POST', `/api/bienestar/viaje?sid=${SID}`, { body: {} })).status, 429);
  });
});

test('si el radio no soporta viajes o falla → 503 sin detalles', async () => {
  await withServer({ radio: { next: async () => ({}), startViaje: () => { throw new Error('interno'); } }, genres }, async (s, c) => {
    const r = await c.call('POST', `/api/bienestar/viaje?sid=${SID}`, { body: {} });
    assert.equal(r.status, 503);
    assert.ok(!r.text.includes('interno'));
  });
});
