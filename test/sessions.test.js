'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSessions } = require('../src/sessions');
const { createLimiter } = require('../src/ratelimit');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'play-ses-'));

test('create/verify/destroy', () => {
  const s = createSessions({ dir: tmp() });
  const t = s.create('u1');
  assert.match(t, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(s.verify(t), 'u1');
  s.destroy(t);
  assert.equal(s.verify(t), null);
});

test('verify: rechaza basura sin lanzar', () => {
  const s = createSessions({ dir: tmp() });
  for (const x of [undefined, null, '', 'abc', 42, {}, 'a'.repeat(500)]) assert.equal(s.verify(x), null);
});

test('caduca', () => {
  let now = 1_000_000;
  const s = createSessions({ dir: tmp(), now: () => now, ttlMs: 1000 });
  const t = s.create('u1');
  now += 999;
  assert.equal(s.verify(t), 'u1');
  now += 2;
  assert.equal(s.verify(t), null);
});

test('sessions.json guarda el hash, nunca el token', () => {
  const dir = tmp();
  const s = createSessions({ dir });
  const t = s.create('u1');
  const raw = fs.readFileSync(path.join(dir, 'sessions.json'), 'utf8');
  assert.ok(!raw.includes(t));
  assert.ok(raw.includes('u1'));
});

test('sobrevive a reiniciar el servidor', () => {
  const dir = tmp();
  const t = createSessions({ dir }).create('u1');
  assert.equal(createSessions({ dir }).verify(t), 'u1');
});

test('destroyUser cierra todas las sesiones de esa cuenta; tope por usuario', () => {
  const s = createSessions({ dir: tmp(), maxPerUser: 2 });
  const a = s.create('u1'); const b = s.create('u1'); const c = s.create('u1');
  assert.equal(s.verify(a), null, 'la más vieja se descarta');
  assert.equal(s.verify(b), 'u1');
  assert.equal(s.verify(c), 'u1');
  const o = s.create('u2');
  s.destroyUser('u1');
  assert.equal(s.verify(b), null);
  assert.equal(s.verify(c), null);
  assert.equal(s.verify(o), 'u2');
});

test('limitador: bloquea al pasar el máximo y se libera con la ventana', () => {
  let now = 0;
  const l = createLimiter({ max: 3, windowMs: 1000, now: () => now });
  assert.equal(l.hit('ip').ok, true);
  assert.equal(l.hit('ip').ok, true);
  assert.equal(l.hit('ip').ok, true);
  const r = l.hit('ip');
  assert.equal(r.ok, false);
  assert.ok(r.retryAfter >= 1);
  assert.equal(l.hit('otra').ok, true, 'cada clave lleva su cuenta');
  now += 1001;
  assert.equal(l.hit('ip').ok, true);
});

test('limitador: tope de claves en memoria', () => {
  const l = createLimiter({ max: 1, windowMs: 1e9, maxKeys: 50 });
  for (let i = 0; i < 500; i++) l.hit('k' + i);
  assert.ok(l.size() <= 50);
});
