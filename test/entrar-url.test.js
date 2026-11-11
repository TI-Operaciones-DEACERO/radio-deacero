'use strict';
/* /entrar: otro sistema redirige a la radio con la nómina y el nombre en la URL y la persona llega con la sesión iniciada. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { withServer } = require('./helpers/servidor');

const SECRETO = 'secreto-de-prueba-para-firmar';
const firmar = (nomina, nombre, ts, secreto = SECRETO) => crypto.createHmac('sha256', secreto).update(`${nomina}|${nombre}|${ts}`).digest('hex');
const cookieDe = (r) => { const c = (r.setCookie || []).find((x) => x.startsWith('pl_user=')); return c ? c.split(';')[0] : ''; };

test('con nómina y nombre: redirige al panel, abre la sesión y no deja la nómina en la URL de destino', async () => {
  await withServer({}, async (s, c) => {
    const r = await c.call('GET', '/entrar?nomina=123456&nombre=Ana%20P%C3%A9rez');
    assert.equal(r.status, 302);
    assert.equal(r.headers.location, '/panel');
    assert.ok(!/123456|Ana/.test(r.headers.location), 'ni la nómina ni el nombre quedan en la dirección');
    const sc = r.setCookie.find((x) => x.startsWith('pl_user='));
    assert.match(sc, /HttpOnly/i); assert.match(sc, /SameSite=Lax/i);
    assert.equal(r.headers['referrer-policy'], 'no-referrer');
    assert.match(r.headers['cache-control'], /no-store/);
    const me = await c.call('GET', '/api/auth/me');
    assert.equal(me.json.user.nomina, '123456');
    assert.equal(me.json.user.nombre, 'Ana Pérez');
  });
});

test('el nombre es opcional y se limpia como en el login normal', async () => {
  await withServer({}, async (s, c) => {
    await c.call('GET', '/entrar?nomina=654321');
    assert.equal((await c.call('GET', '/api/auth/me')).json.user.nomina, '654321');
    c.clearCookie();
    await c.call('GET', '/entrar?nomina=654322&nombre=' + encodeURIComponent('  Luis‮   Gómez\n ')); /* cuenta nueva: sin firma el nombre solo se usa al crearla */
    assert.equal((await c.call('GET', '/api/auth/me')).json.user.nombre, 'Luis Gómez');
  });
});

test('nómina inválida, no permitida o cuenta desactivada: misma respuesta, sin sesión y sin pistas', async () => {
  await withServer({}, async (s, c) => {
    fs.writeFileSync(path.join(s.dir, 'nominas-permitidas.txt'), '111111\n');
    const invalida = await c.call('GET', '/entrar?nomina=abc');
    const noPermitida = await c.call('GET', '/entrar?nomina=222222');
    const sinDatos = await c.call('GET', '/entrar');
    for (const r of [invalida, noPermitida, sinDatos]) {
      assert.equal(r.status, 302);
      assert.equal(r.headers.location, '/panel?entrada=no');
      assert.equal(cookieDe(r), '');
    }
    assert.equal((await c.call('GET', '/api/auth/me')).json.user, null);
    assert.equal((await c.call('GET', '/entrar?nomina=111111')).headers.location, '/panel');
  });
});

test('solo GET; POST → 405', async () => {
  await withServer({}, async (s, c) => {
    assert.equal((await c.call('POST', '/entrar?nomina=123456', { body: {} })).status, 405);
    assert.equal((await c.call('GET', '/api/auth/me')).json.user, null);
  });
});

test('con ENTRADA_SECRETO: exige firma y fecha vigentes; sin firma, firma mala, datos cambiados o vencida no entra', async () => {
  await withServer({ entradaSecreto: SECRETO }, async (s, c) => {
    const ts = Math.floor(s.now.t / 1000);
    const url = (nomina, nombre, t, f) => `/entrar?nomina=${nomina}&nombre=${encodeURIComponent(nombre)}&ts=${t}&firma=${f}`;
    const casos = [
      ['sin firma', '/entrar?nomina=123456&nombre=Ana'],
      ['firma mala', url('123456', 'Ana', ts, 'a'.repeat(64))],
      ['firma de otro secreto', url('123456', 'Ana', ts, firmar('123456', 'Ana', ts, 'otro'))],
      ['nombre cambiado', url('123456', 'Beto', ts, firmar('123456', 'Ana', ts))],
      ['nómina cambiada', url('999999', 'Ana', ts, firmar('123456', 'Ana', ts))],
      ['vencida', url('123456', 'Ana', ts - 3600, firmar('123456', 'Ana', ts - 3600))],
      ['del futuro', url('123456', 'Ana', ts + 3600, firmar('123456', 'Ana', ts + 3600))],
      ['ts basura', url('123456', 'Ana', 'x', firmar('123456', 'Ana', 'x'))]
    ];
    for (const [nombre, u] of casos) {
      const r = await c.call('GET', u);
      assert.equal(r.headers.location, '/panel?entrada=no', nombre);
      assert.equal(cookieDe(r), '', nombre);
    }
    const ok = await c.call('GET', url('123456', 'Ana', ts, firmar('123456', 'Ana', ts)));
    assert.equal(ok.headers.location, '/panel');
    assert.ok(cookieDe(ok));
    assert.equal((await c.call('GET', '/api/auth/me')).json.user.nombre, 'Ana');
  });
});

test('la firma admite la hora en milisegundos', async () => {
  await withServer({ entradaSecreto: SECRETO }, async (s, c) => {
    const ts = s.now.t;
    const r = await c.call('GET', `/entrar?nomina=123456&ts=${ts}&firma=${firmar('123456', '', ts)}`);
    assert.equal(r.headers.location, '/panel');
  });
});

test('límite de intentos por IP (como el login) y Host no permitido', async () => {
  await withServer({ loginMax: 3 }, async (s, c) => {
    for (let i = 0; i < 3; i++) assert.equal((await c.call('GET', '/entrar?nomina=12345' + i)).status, 302);
    assert.equal((await c.call('GET', '/entrar?nomina=123459')).status, 429);
  });
  await withServer({}, async (s, c) => {
    assert.equal((await c.call('GET', '/entrar?nomina=123456', { headers: { host: 'sitio-ajeno.example.com' } })).status, 421);
  });
});

test('cambia de sesión: la cookie anterior deja de valer', async () => {
  await withServer({}, async (s, c) => {
    const a = await c.call('GET', '/entrar?nomina=111111');
    const vieja = cookieDe(a);
    await c.call('GET', '/entrar?nomina=222222');
    assert.equal((await c.call('GET', '/api/auth/me')).json.user.nomina, '222222');
    assert.equal((await c.call('GET', '/api/auth/me', { headers: { cookie: vieja } })).json.user, null);
  });
});
