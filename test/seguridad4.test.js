'use strict';
/* Endurecimiento tras la revisión de seguridad: límite de intentos de clave, /api/muestra acotada y /entrar sin firma menos abusable. */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createMuestras } = require('../src/muestras');
const { createLimiter } = require('../src/ratelimit');
const { withServer, TOKEN } = require('./helpers/servidor');

const SECRETO = 'secreto-largo-de-prueba-0123456789';
const firmar = (nomina, nombre, ts) => crypto.createHmac('sha256', SECRETO).update(`${nomina}|${nombre}|${ts}`).digest('hex');
const cookieDe = (r) => { const c = (r.setCookie || []).find((x) => x.startsWith('pl_user=')); return c ? c.split(';')[0] : ''; };
const T = (id) => ({ id, title: 'T ' + id, channel: 'C', duration: 200 });

test('limiter.peek: mira sin contar', () => {
  const l = createLimiter({ max: 2, windowMs: 1000 });
  assert.equal(l.peek('a').ok, true);
  l.hit('a'); l.hit('a');
  assert.equal(l.peek('a').ok, false);
  assert.ok(l.peek('a').retryAfter >= 1);
  assert.equal(l.peek('b').ok, true);
});

test('clave de administración: tras varios intentos MALOS esa IP recibe 429 (aun con la clave buena); sin clave no gasta el cupo', async () => {
  await withServer({ claveMax: 3 }, async (s, c) => {
    for (let i = 0; i < 5; i++) assert.equal((await c.call('GET', '/api/admin/estado')).status, 401, 'sin clave: solo 401, sin gastar intentos');
    for (let i = 0; i < 3; i++) assert.equal((await c.call('GET', '/api/admin/estado', { headers: { 'x-token': 'mala' + i } })).status, 401);
    const r = await c.call('GET', '/api/admin/estado', { headers: { 'x-token': 'mala' } });
    assert.equal(r.status, 429);
    assert.ok(r.headers['retry-after']);
    assert.equal((await c.call('GET', '/api/admin/estado', { headers: { 'x-token': TOKEN } })).status, 429, 'bloqueada: ni la buena entra hasta que pase la ventana');
  });
  await withServer({ claveMax: 3 }, async (s, c) => {
    for (let i = 0; i < 6; i++) assert.equal((await c.call('GET', '/api/admin/estado', { headers: { 'x-token': TOKEN } })).status, 200, 'la clave buena no gasta intentos');
  });
});

test('muestras: la cola de espera tiene tope; lo rechazado por tope NO se guarda como «sin muestra»', async () => {
  let n = 0;
  const m = createMuestras({ radio: {}, simultaneas: 1, maxEspera: 2, search: async () => { n++; await new Promise((r) => setTimeout(r, 15)); return [T('aaaaaaaaaaa')]; } });
  const res = await Promise.all(['a1', 'a2', 'a3', 'a4', 'a5', 'a6'].map((x) => m.artista(x)));
  assert.ok(res.filter(Boolean).length <= 3, 'una en curso + 2 en espera');
  assert.ok(n <= 3);
  assert.ok(await m.artista('a6'), 'la rechazada por tope se puede pedir de nuevo y sí busca');
});

test('/api/muestra?a= tiene su propio límite (corto); ?g= no lo gasta', async () => {
  const muestras = { genero: async () => ({ id: 'aaaaaaaaaaa', title: 'T', duration: 1 }), artista: async () => ({ id: 'bbbbbbbbbbb', title: 'U', duration: 1 }) };
  await withServer({ muestras, muestraArtistaMax: 3 }, async (s, c) => {
    const sid = 'abcdefgh1234';
    for (let i = 0; i < 3; i++) assert.equal((await c.call('GET', '/api/muestra?a=x' + i + '&sid=' + sid)).status, 200);
    assert.equal((await c.call('GET', '/api/muestra?a=otro&sid=' + sid)).status, 429);
    assert.equal((await c.call('GET', '/api/muestra?g=jazz')).status, 200, 'los géneros (con caché) siguen');
  });
});

test('/entrar sin firma: los subrecursos (img, iframe…) no inician sesión ni tocan cuentas', async () => {
  await withServer({}, async (s, c) => {
    for (const dest of ['image', 'iframe', 'script', 'empty']) {
      const r = await c.call('GET', '/entrar?nomina=123456&nombre=X', { headers: { 'sec-fetch-dest': dest } });
      assert.equal(r.headers.location, '/panel?entrada=no', dest);
      assert.equal(cookieDe(r), '');
    }
    assert.equal(s.users.list().length, 0, 'ni siquiera se crea la cuenta');
    const ok = await c.call('GET', '/entrar?nomina=123456', { headers: { 'sec-fetch-dest': 'document' } });
    assert.equal(ok.headers.location, '/panel');
  });
});

test('/entrar sin firma: el nombre solo se pone al CREAR la cuenta; en una existente no la renombra', async () => {
  await withServer({}, async (s, c) => {
    await c.call('GET', '/entrar?nomina=123456&nombre=Ana');
    assert.equal((await c.call('GET', '/api/auth/me')).json.user.nombre, 'Ana', 'cuenta nueva: toma el nombre');
    c.clearCookie();
    await c.call('GET', '/entrar?nomina=123456&nombre=Intruso');
    assert.equal((await c.call('GET', '/api/auth/me')).json.user.nombre, 'Ana', 'cuenta existente: no se renombra por un enlace sin firmar');
  });
  await withServer({ entradaSecreto: SECRETO }, async (s, c) => {
    const ts = Math.floor(s.now.t / 1000);
    await c.call('GET', `/entrar?nomina=123456&nombre=Ana&ts=${ts}&firma=${firmar('123456', 'Ana', ts)}`);
    c.clearCookie();
    await c.call('GET', `/entrar?nomina=123456&nombre=Ana%20Maria&ts=${ts}&firma=${firmar('123456', 'Ana Maria', ts)}`);
    assert.equal((await c.call('GET', '/api/auth/me')).json.user.nombre, 'Ana Maria', 'con firma el otro sistema sí puede actualizar el nombre');
  });
});

test('/entrar: cuenta desactivada, firmas mal formadas, HEAD y cookie Secure', async () => {
  await withServer({ cookieSecure: true }, async (s, c) => {
    const ok = await c.call('GET', '/entrar?nomina=777777');
    assert.match(ok.setCookie.find((x) => x.startsWith('pl_user=')), /; Secure/);
    const u = s.users.list().find((x) => x.nomina === '777777');
    s.users.setEstado(u.id, 'desactivado');
    c.clearCookie();
    const r = await c.call('GET', '/entrar?nomina=777777');
    assert.equal(r.headers.location, '/panel?entrada=no');
    assert.equal(cookieDe(r), '');
    assert.equal((await c.call('HEAD', '/entrar?nomina=888888')).status, 405);
  });
  await withServer({ entradaSecreto: SECRETO }, async (s, c) => {
    const ts = Math.floor(s.now.t / 1000), buena = firmar('123456', '', ts);
    for (const f of [buena.slice(1), buena + 'a', 'z'.repeat(64), '']) {
      const r = await c.call('GET', `/entrar?nomina=123456&ts=${ts}&firma=${f}`);
      assert.equal(r.status, 302);
      assert.equal(r.headers.location, '/panel?entrada=no');
    }
    for (const dt of [-299, 299]) {
      const t2 = ts + dt;
      assert.equal((await c.call('GET', `/entrar?nomina=123456&ts=${t2}&firma=${firmar('123456', '', t2)}`)).headers.location, '/panel', 'dentro de ±5 min');
    }
    const mayus = await c.call('GET', `/entrar?nomina=123456&ts=${ts}&firma=${buena.toUpperCase()}`);
    assert.equal(mayus.headers.location, '/panel');
    const pipe = await c.call('GET', `/entrar?nomina=123456&nombre=${encodeURIComponent('a|b')}&ts=${ts}&firma=${firmar('123456', 'a|b', ts)}`);
    assert.equal(pipe.headers.location, '/panel');
  });
});

test('/entrar: el reloj de la firma puede ser el corregido por la red (la Pi suele tener el reloj atrasado)', async () => {
  await withServer({ entradaSecreto: SECRETO, now: () => 1_000_000_000_000, relojEntrada: () => 1_800_000_000_000 }, async (s, c) => {
    const ts = 1_800_000_000;
    const r = await c.call('GET', `/entrar?nomina=123456&ts=${ts}&firma=${firmar('123456', '', ts)}`);
    assert.equal(r.headers.location, '/panel');
  });
});
