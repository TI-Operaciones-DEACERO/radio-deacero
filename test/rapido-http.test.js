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
