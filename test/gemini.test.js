'use strict';
/* Adaptador de Gemini: la clave solo por cabecera, con tope de tiempo, de ritmo y cortacircuitos. Todo con fetch simulado. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGemini } = require('../src/gemini');

const KEY = 'AIzaSy-CLAVE-SECRETA-DE-PRUEBA';
const ok = (obj) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: typeof obj === 'string' ? obj : JSON.stringify(obj) }] } }] }) });

test('sin clave: no está disponible y no hace ninguna petición', async () => {
  let llamadas = 0;
  const g = createGemini({ key: '', fetch: async () => { llamadas++; return ok([]); } });
  assert.equal(g.enabled, false);
  await assert.rejects(g.json({ prompt: 'hola' }), /GEMINI_OFF/);
  assert.equal(llamadas, 0);
});

test('la clave va en la cabecera x-goog-api-key y NUNCA en la URL', async () => {
  let visto;
  const g = createGemini({ key: KEY, fetch: async (url, init) => { visto = { url, init }; return ok({ a: 1 }); } });
  await g.json({ prompt: 'hola' });
  assert.ok(!String(visto.url).includes(KEY), 'la URL no lleva la clave');
  assert.ok(!String(visto.url).includes('key='));
  assert.equal(visto.init.headers['x-goog-api-key'], KEY);
  assert.match(String(visto.url), /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/[\w.-]+:generateContent$/);
  assert.equal(visto.init.method, 'POST');
});

test('el cuerpo pide JSON, sin razonamiento largo, con tope de salida', async () => {
  let body;
  const g = createGemini({ key: KEY, fetch: async (u, init) => { body = JSON.parse(init.body); return ok([]); } });
  await g.json({ prompt: 'dame algo', system: 'eres un DJ', temperature: 1.1, maxTokens: 700 });
  assert.equal(body.contents[0].parts[0].text, 'dame algo');
  assert.equal(body.systemInstruction.parts[0].text, 'eres un DJ');
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.equal(body.generationConfig.maxOutputTokens, 700);
  assert.equal(body.generationConfig.temperature, 1.1);
  assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingBudget: 0 });
});

test('el modelo se puede cambiar (GEMINI_MODEL) y por defecto hay uno', async () => {
  const urls = [];
  const f = async (u) => { urls.push(String(u)); return ok([]); };
  await createGemini({ key: KEY, fetch: f }).json({ prompt: 'x' });
  await createGemini({ key: KEY, model: 'otro-modelo', fetch: f }).json({ prompt: 'x' });
  assert.match(urls[0], /models\/gemini-[\w.-]+:generateContent/);
  assert.match(urls[1], /models\/otro-modelo:generateContent/);
});

test('respuesta con ```json y texto alrededor: se extrae el JSON', async () => {
  const g = createGemini({ key: KEY, fetch: async () => ok('Aquí va:\n```json\n[{"name":"A"}]\n```\nlisto') });
  assert.deepEqual(await g.json({ prompt: 'x' }), [{ name: 'A' }]);
});

test('respuesta que no es JSON → error GEMINI_BAD', async () => {
  const g = createGemini({ key: KEY, fetch: async () => ok('no hay nada útil') });
  await assert.rejects(g.json({ prompt: 'x' }), /GEMINI_BAD/);
});

test('respuesta vacía o bloqueada → error, no se cuelga', async () => {
  const g = createGemini({ key: KEY, fetch: async () => ({ ok: true, status: 200, json: async () => ({ candidates: [] }) }) });
  await assert.rejects(g.json({ prompt: 'x' }), /GEMINI_BAD/);
});

test('HTTP de error: el mensaje no contiene la clave ni el cuerpo del proveedor', async () => {
  const g = createGemini({ key: KEY, fetch: async () => ({ ok: false, status: 403, json: async () => ({ error: { message: 'API key ' + KEY + ' inválida' } }), text: async () => KEY }) });
  await assert.rejects(g.json({ prompt: 'x' }), (e) => { assert.match(e.message, /GEMINI_HTTP_403/); assert.ok(!e.message.includes(KEY)); assert.ok(!JSON.stringify(e).includes(KEY)); return true; });
});

test('error de red: el mensaje no filtra la clave', async () => {
  const g = createGemini({ key: KEY, fetch: async () => { throw new Error('fallo conectando con ' + KEY); } });
  await assert.rejects(g.json({ prompt: 'x' }), (e) => { assert.ok(!e.message.includes(KEY)); return true; });
});

test('tiempo máximo: se corta y falla en vez de colgar la petición', async () => {
  const g = createGemini({ key: KEY, timeoutMs: 30, fetch: (u, init) => new Promise((res, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('abortado'), { name: 'AbortError' })))) });
  const t0 = Date.now();
  await assert.rejects(g.json({ prompt: 'x' }), /GEMINI_TIMEOUT/);
  assert.ok(Date.now() - t0 < 1000);
});

test('ritmo: no más de N llamadas por minuto (las demás fallan sin salir a la red)', async () => {
  let t = 0, llamadas = 0;
  const g = createGemini({ key: KEY, perMinute: 3, now: () => t, fetch: async () => { llamadas++; return ok([]); } });
  for (let i = 0; i < 3; i++) await g.json({ prompt: 'x' });
  await assert.rejects(g.json({ prompt: 'x' }), /GEMINI_LIMIT/);
  assert.equal(llamadas, 3);
  t += 61_000;
  await g.json({ prompt: 'x' });
  assert.equal(llamadas, 4);
});

test('cortacircuitos: tras varios fallos seguidos deja de intentar un rato y luego reintenta', async () => {
  let t = 0, llamadas = 0, falla = true;
  const g = createGemini({ key: KEY, failMax: 3, coolMs: 60_000, now: () => t, fetch: async () => { llamadas++; if (falla) throw new Error('x'); return ok([]); } });
  for (let i = 0; i < 3; i++) await assert.rejects(g.json({ prompt: 'x' }));
  assert.equal(llamadas, 3);
  await assert.rejects(g.json({ prompt: 'x' }), /GEMINI_COOLING/);
  assert.equal(llamadas, 3, 'no sale a la red mientras enfría');
  t += 61_000; falla = false;
  assert.deepEqual(await g.json({ prompt: 'x' }), []);
  assert.equal(g.status().cooling, false);
});

test('un éxito reinicia la cuenta de fallos', async () => {
  let n = 0;
  const g = createGemini({ key: KEY, failMax: 3, fetch: async () => { n++; if (n % 3 !== 0) throw new Error('x'); return ok([]); } });
  for (let i = 0; i < 9; i++) await g.json({ prompt: 'x' }).catch(() => {});
  assert.equal(n, 9, 'nunca llegó a 3 fallos seguidos');
});

test('status: no expone la clave', () => {
  const s = createGemini({ key: KEY, fetch: async () => ok([]) }).status();
  assert.equal(s.enabled, true);
  assert.ok(!JSON.stringify(s).includes(KEY));
});

test('el prompt se acota (tope de caracteres) para no mandar textos enormes', async () => {
  let body;
  const g = createGemini({ key: KEY, fetch: async (u, init) => { body = JSON.parse(init.body); return ok([]); } });
  await g.json({ prompt: 'x'.repeat(50000) });
  assert.ok(body.contents[0].parts[0].text.length <= 8000);
});
