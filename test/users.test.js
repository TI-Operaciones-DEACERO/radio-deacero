'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createUsers, normalizeNomina, cleanNombre } = require('../src/users');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'play-users-'));

test('normalizeNomina: solo dígitos, 4 a 10; quita espacios', () => {
  assert.equal(normalizeNomina(' 123456 '), '123456');
  assert.equal(normalizeNomina(123456), '123456');
  for (const mal of ['', '123', '12345678901', 'abc123', '12 34', '12-34', '١٢٣٤٥٦', null, undefined, {}, [], '1234\n5']) {
    assert.equal(normalizeNomina(mal), null, JSON.stringify(mal));
  }
});

test('cleanNombre: opcional, sin controles, máx. 40', () => {
  assert.equal(cleanNombre('  Ana   Pérez '), 'Ana Pérez');
  assert.equal(cleanNombre('A\u0000b‮c'), 'Abc');
  assert.equal(cleanNombre(''), null);
  assert.equal(cleanNombre(undefined), null);
  assert.equal(cleanNombre(12), null);
  assert.equal(cleanNombre('x'.repeat(100)).length, 40);
});

test('entrar: crea la cuenta la primera vez y reconoce la misma nómina después', () => {
  const u = createUsers({ dir: tmp() });
  const a = u.entrar('123456', 'Ana');
  assert.equal(a.ok, true);
  assert.equal(a.nuevo, true);
  assert.match(a.user.id, /^[a-f0-9]{16}$/);
  assert.equal(a.user.nombre, 'Ana');
  const b = u.entrar('123456');
  assert.equal(b.ok, true);
  assert.equal(b.nuevo, false);
  assert.equal(b.user.id, a.user.id);
  assert.equal(b.user.nombre, 'Ana', 'sin nombre nuevo se conserva el anterior');
});

test('entrar: nómina inválida', () => {
  const u = createUsers({ dir: tmp() });
  assert.deepEqual(u.entrar('abc'), { ok: false, error: 'NOMINA_INVALIDA' });
});

test('entrar: cuenta desactivada no entra', () => {
  const u = createUsers({ dir: tmp() });
  const { user } = u.entrar('123456');
  u.setEstado(user.id, 'desactivado');
  assert.deepEqual(u.entrar('123456'), { ok: false, error: 'DESACTIVADA' });
  u.setEstado(user.id, 'activo');
  assert.equal(u.entrar('123456').ok, true);
});

test('lista de nóminas permitidas: si el archivo existe, solo esas entran', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'nominas-permitidas.txt'), '# comentario\n111111\n\n222222 # Ana\n');
  const u = createUsers({ dir });
  assert.equal(u.entrar('111111').ok, true);
  assert.equal(u.entrar('222222').ok, true);
  assert.deepEqual(u.entrar('333333'), { ok: false, error: 'NO_AUTORIZADA' });
});

test('sin archivo de permitidas, cualquier nómina válida entra', () => {
  assert.equal(createUsers({ dir: tmp() }).entrar('999999').ok, true);
});

test('tope de cuentas', () => {
  const u = createUsers({ dir: tmp(), max: 2 });
  u.entrar('100001'); u.entrar('100002');
  assert.deepEqual(u.entrar('100003'), { ok: false, error: 'LLENO' });
  assert.equal(u.entrar('100001').ok, true, 'los que ya existen siguen entrando');
});

test('persistencia: sobrevive a reiniciar', () => {
  const dir = tmp();
  const id = createUsers({ dir }).entrar('123456', 'Ana').user.id;
  const u2 = createUsers({ dir });
  assert.equal(u2.get(id).nombre, 'Ana');
  assert.equal(u2.entrar('123456').user.id, id);
});

test('archivo dañado: arranca vacío en vez de caerse', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'users.json'), '{no es json');
  assert.equal(createUsers({ dir }).list().length, 0);
});

test('rename, list, remove y export', () => {
  const dir = tmp();
  const u = createUsers({ dir });
  const { user } = u.entrar('123456');
  assert.equal(u.rename(user.id, ' Beto ').nombre, 'Beto');
  assert.equal(u.list().length, 1);
  assert.equal(u.list()[0].nomina, '123456');
  fs.mkdirSync(path.join(dir, 'users'));
  fs.writeFileSync(path.join(dir, 'users', user.id + '.json'), '{"reactions":{}}');
  assert.deepEqual(u.export(user.id).datos, { reactions: {} });
  assert.equal(u.remove(user.id), true);
  assert.equal(u.get(user.id), null);
  assert.equal(fs.existsSync(path.join(dir, 'users', user.id + '.json')), false, 'borra también sus datos');
  assert.equal(u.remove(user.id), false);
  assert.equal(u.entrar('123456').nuevo, true);
});

test('un id con ../ no sale de la carpeta de usuarios', () => {
  const dir = tmp();
  const u = createUsers({ dir });
  assert.equal(u.get('../x'), null);
  assert.equal(u.remove('../../x'), false);
  assert.equal(u.export('../x'), null);
});
