'use strict';
/* /api/next avisa qué género está sonando (para que el calentador lo mantenga listo) y no espera al precalentado. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { withServer } = require('./helpers/servidor');

test('/api/next: avisa el género que salió (onGenero) y responde sin esperar a resolver la URL', async () => {
  const avisados = [];
  let resolver;
  const over = {
    radio: { next: async () => ({ track: { id: 'abcdefghijk', title: 't' }, genre: { id: 'jazz' } }) },
    ytdlp: { resolve: () => new Promise((r) => { resolver = r; }), version: () => '1' }, /* nunca termina sola */
    onGenero: (id) => avisados.push(id)
  };
  await withServer(over, async (s, c) => {
    const r = await c.call('GET', '/api/next?sid=oyente-12345');
    assert.equal(r.status, 200, 'respondió aunque resolver siga pendiente');
    assert.deepEqual(avisados, ['jazz']);
    resolver({});
  });
});

test('/api/next: pasa la semilla (más como esto) al radio y una precarga superada responde 409 sin ruido', async () => {
  const vistas = [];
  const over = {
    radio: { next: async (o) => { vistas.push(o); if (o.genre === 'viejo') throw Object.assign(new Error('x'), { code: 'STALE' }); return { track: { id: 'abcdefghijk', title: 't' }, genre: { id: 'search' } }; } },
    ytdlp: { resolve: async () => ({}), version: () => '1' }
  };
  await withServer(over, async (s, c) => {
    assert.equal((await c.call('GET', '/api/next?sid=oyente-12345&semilla=' + encodeURIComponent('  Selena Gomez  '))).status, 200);
    assert.equal(vistas[0].semilla, 'Selena Gomez');
    assert.equal((await c.call('GET', '/api/next?sid=oyente-12345&semilla=' + 'x'.repeat(300))).status, 200);
    assert.equal(vistas[1].semilla.length, 100, 'con tope');
    assert.equal((await c.call('GET', '/api/next?sid=oyente-12345&genre=viejo')).status, 409);
  });
});
