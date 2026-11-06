'use strict';
/* Fase 6 por HTTP: administración (horario, anuncios, ajustes, diagnóstico) con clave; búsqueda y letras de oyente. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { withServer, TOKEN } = require('./helpers/servidor');
const { createPrograma } = require('../src/horario');
const { createAnuncios } = require('../src/anuncios');
const { createAjustes } = require('../src/ajustes');
const { createDiagnostico } = require('../src/diagnostico');
const { createControl } = require('../src/control');

const GENRES = [
  { id: 'jazz', label: 'Jazz', emoji: '🎷', color: '#f90', featured: true, queries: ['x'], mood: 'focus' },
  { id: 'salsa', label: 'Salsa', emoji: '💃', color: '#f00', featured: true, queries: ['y'], mood: 'uplift' }
];
const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(400, 1)]);
const K = { 'x-token': TOKEN };
const SID = 'sid=oyente-12345';
const at = (dia, hh, mm = 0) => new Date(2026, 10, 1 + dia, hh, mm).getTime();

function piezas(reloj = { t: at(1, 9) }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'play-adm-'));
  const control = createControl({ keepAliveMs: 0 });
  const enviados = [];
  const send = control.send;
  control.send = (c) => { enviados.push(c); return send(c); };
  const llamadas = [];
  const diag = createDiagnostico();
  return {
    enviados, llamadas, reloj, diag,
    over: {
      genres: GENRES, control, diag,
      programa: createPrograma({ dir, genres: GENRES, clock: () => reloj.t }),
      anuncios: createAnuncios({ dir, send: (c) => control.send(c), clock: () => reloj.t }),
      ajustes: createAjustes({ dir }),
      radio: { next: async (o) => { llamadas.push(o); return { track: { id: 'abcdefghijk', title: 't' }, genre: { id: 'jazz' } }; }, sessionCount: () => 3 },
      ytdlp: {
        resolve: async () => ({}), version: () => '2026.01.01',
        search: async () => [{ id: 'aaaaaaaaaaa', title: 'Limpia', channel: 'c', duration: 200 }, { id: 'bbbbbbbbbbb', title: 'Otra (Explicit)', channel: 'c', duration: 200 }]
      },
      lyrics: { get: async () => ({ synced: null, plain: 'la la la' }) }
    }
  };
}

const RUTAS_ADMIN = [
  ['GET', '/api/admin/estado'], ['GET', '/api/admin/horario'], ['PUT', '/api/admin/horario'], ['POST', '/api/admin/horario/generar'],
  ['GET', '/api/admin/horario/ahora'], ['GET', '/api/admin/anuncios'], ['POST', '/api/admin/anuncios'], ['PATCH', '/api/admin/anuncios/abcd1234'],
  ['DELETE', '/api/admin/anuncios/abcd1234'], ['POST', '/api/admin/anuncios/abcd1234/probar'], ['GET', '/api/admin/ajustes'], ['PUT', '/api/admin/ajustes'],
  ['GET', '/api/admin/diagnostico'], ['GET', '/api/anuncio/abcd1234']
];

test('sin la clave, NINGUNA ruta de administración responde datos', async () => {
  const p = piezas();
  await withServer(p.over, async (s, c) => {
    for (const [m, u] of RUTAS_ADMIN) {
      const r = await c.call(m, u, m === 'GET' || m === 'DELETE' ? {} : { body: {} });
      assert.equal(r.status, 401, `${m} ${u}`);
    }
  });
});

test('estado y horario: leer, guardar (validado), generar semana y ver qué toca ahora', async () => {
  const p = piezas();
  await withServer(p.over, async (s, c) => {
    assert.equal((await c.call('GET', '/api/admin/estado', { headers: K })).status, 200);
    assert.equal((await c.call('GET', '/api/admin/horario', { headers: K })).json.modo, 'rotacion');
    const malo = await c.call('PUT', '/api/admin/horario', { headers: K, body: { modo: 'horario', bloques: [{ dias: [1], desde: '09:00', hasta: '08:00', generos: ['jazz'] }] } });
    assert.equal(malo.status, 400);
    assert.equal(malo.json.error, 'HORARIO_INVALIDO');
    assert.ok(malo.json.detalle);
    const h = { modo: 'horario', bloques: [{ dias: [1], desde: '08:00', hasta: '10:00', generos: ['salsa'] }] };
    const ok = await c.call('PUT', '/api/admin/horario', { headers: K, body: h });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.bloques[0].generos[0], 'salsa');
    const ahora = await c.call('GET', '/api/admin/horario/ahora', { headers: K });
    assert.deepEqual(ahora.json.generos, ['salsa']);
    const gen = await c.call('POST', '/api/admin/horario/generar', { headers: K, body: {} });
    assert.equal(gen.status, 200);
    assert.ok(Array.isArray(gen.json.bloques));
    assert.equal((await c.call('GET', '/api/admin/horario', { headers: K })).json.bloques.length, 1, 'generar NO guarda');
  });
});

test('el horario cambia el género de las PANTALLAS a la hora indicada, sin afectar a los oyentes del panel', async () => {
  const p = piezas();
  await withServer(p.over, async (s, c) => {
    await c.call('PUT', '/api/admin/horario', { headers: K, body: { modo: 'horario', bloques: [{ dias: [1], desde: '08:00', hasta: '10:00', generos: ['salsa'] }] } });
    await c.call('GET', '/api/next', { headers: K });
    assert.deepEqual(p.llamadas.at(-1).onlyGenres, ['salsa'], 'pantallas (sin sid) siguen el horario');
    await c.call('GET', '/api/next?sid=oyente-12345');
    assert.equal(p.llamadas.at(-1).onlyGenres, undefined, 'el oyente del panel no');
    p.reloj.t = at(1, 11);
    await c.call('GET', '/api/next', { headers: K });
    assert.equal(p.llamadas.at(-1).onlyGenres, undefined, 'fuera del bloque: rotación normal');
  });
});

test('anuncios: subir, servir el mp3 solo con clave, programar, probar y borrar', async () => {
  const p = piezas();
  await withServer(p.over, async (s, c) => {
    const alta = await c.call('POST', '/api/admin/anuncios', { headers: K, body: { nombre: 'Pausa', dias: [1], desde: '09:00', hasta: '17:00', cadaMin: 60, audio: MP3.toString('base64') } });
    assert.equal(alta.status, 201, alta.text);
    const id = alta.json.id;
    const malo = await c.call('POST', '/api/admin/anuncios', { headers: K, body: { nombre: 'X', dias: [1], desde: '09:00', hasta: '17:00', cadaMin: 60, audio: Buffer.from('<script>' + 'x'.repeat(300)).toString('base64') } });
    assert.equal(malo.status, 400);
    assert.equal(malo.json.error, 'AUDIO_INVALIDO');
    assert.equal((await c.call('GET', '/api/admin/anuncios', { headers: K })).json.length, 1);
    const audio = await c.call('GET', `/api/anuncio/${id}`, { headers: K });
    assert.equal(audio.status, 200);
    assert.equal(audio.headers['content-type'], 'audio/mpeg');
    assert.equal(Number(audio.headers['content-length']), MP3.length);
    assert.equal((await c.call('GET', '/api/anuncio/00000000', { headers: K })).status, 404);
    const pa = await c.call('PATCH', `/api/admin/anuncios/${id}`, { headers: K, body: { activo: false } });
    assert.equal(pa.json.activo, false);
    const pr = await c.call('POST', `/api/admin/anuncios/${id}/probar`, { headers: K, body: {} });
    assert.equal(pr.status, 200);
    assert.deepEqual(p.enviados.at(-1), { cmd: 'anuncio', id, nombre: 'Pausa' });
    assert.equal((await c.call('DELETE', `/api/admin/anuncios/${id}`, { headers: K })).status, 204);
    assert.equal((await c.call('DELETE', `/api/admin/anuncios/${id}`, { headers: K })).status, 404);
  });
});

test('ajustes: con el filtro encendido, la búsqueda de oyente no muestra títulos explícitos', async () => {
  const p = piezas();
  await withServer(p.over, async (s, c) => {
    assert.equal((await c.call('GET', `/api/buscar?q=hola&${SID}`)).json.length, 2, 'apagado por defecto');
    const r = await c.call('PUT', '/api/admin/ajustes', { headers: K, body: { filtroExplicito: true, palabras: [] } });
    assert.equal(r.status, 200);
    assert.deepEqual((await c.call('GET', '/api/admin/ajustes', { headers: K })).json, { filtroExplicito: true, palabras: [] });
    const b = await c.call('GET', `/api/buscar?q=hola&${SID}`);
    assert.deepEqual(b.json.map((t) => t.id), ['aaaaaaaaaaa']);
    assert.equal((await c.call('PUT', '/api/admin/ajustes', { headers: K, body: { filtroExplicito: 'si' } })).status, 400);
  });
});

test('buscar y letras: abiertos al oyente (sin clave), con validación', async () => {
  const p = piezas();
  await withServer(p.over, async (s, c) => {
    const b = await c.call('GET', `/api/buscar?q=salsa&${SID}`);
    assert.equal(b.status, 200);
    assert.deepEqual(Object.keys(b.json[0]).sort(), ['channel', 'duration', 'id', 'title']);
    assert.equal((await c.call('GET', `/api/buscar?${SID}`)).status, 400);
    const l = await c.call('GET', `/api/lyrics?title=x&${SID}`);
    assert.equal(l.status, 200);
    assert.equal(l.json.plain, 'la la la');
    assert.equal((await c.call('GET', '/api/buscar?q=x')).status, 401, 'sin id de sesión pide clave');
    assert.equal((await c.call('GET', '/api/lyrics?title=x')).status, 401, 'sin id de sesión pide clave (como antes)');
  });
  await withServer({ ...piezas().over, panelOpen: false }, async (s, c) => {
    assert.equal((await c.call('GET', `/api/buscar?q=x&${SID}`)).status, 401, 'PANEL_PUBLICO=0 lo cierra');
  });
});

test('las búsquedas del oyente NO entran al historial de administración (no lo pueden desplazar)', async () => {
  const p = piezas();
  await withServer(p.over, async (s, c) => {
    for (let i = 0; i < 3; i++) await c.call('GET', `/api/buscar?q=oyente${i}&${SID}`);
    const h = await c.call('GET', '/api/history', { headers: K });
    assert.deepEqual(h.json, []);
  });
});

test('diagnóstico: servicios, eventos y estado del sistema; los errores de búsqueda quedan registrados', async () => {
  const p = piezas();
  p.over.ytdlp.search = async () => { throw new Error('yt-dlp: HTTP Error 403'); };
  await withServer(p.over, async (s, c) => {
    assert.equal((await c.call('GET', `/api/buscar?q=x&${SID}`)).status, 503);
    const d = await c.call('GET', '/api/admin/diagnostico', { headers: K });
    assert.equal(d.status, 200);
    assert.ok(d.json.eventos.some((e) => e.servicio === 'yt-dlp' && e.nivel === 'error'));
    assert.ok(d.json.servicios.find((x) => x.servicio === 'yt-dlp').errores1h >= 1);
    const sis = d.json.sistema;
    for (const k of ['uptime', 'ytdlp', 'relojSincronizado', 'gemini', 'pantallas', 'sesionesRadio', 'cuentas']) assert.ok(k in sis, k);
    assert.equal(sis.sesionesRadio, 3);
  });
});

test('escrituras de administración: otro origen → 403; sin JSON → 415', async () => {
  const p = piezas();
  await withServer(p.over, async (s, c) => {
    const o = await c.call('PUT', '/api/admin/ajustes', { headers: { ...K, origin: 'http://malo.example' }, body: { filtroExplicito: true } });
    assert.equal(o.status, 403);
    const t = await c.call('PUT', '/api/admin/ajustes', { headers: { ...K, 'content-type': 'text/plain' }, raw: '{"filtroExplicito":true}' });
    assert.equal(t.status, 415);
  });
});
