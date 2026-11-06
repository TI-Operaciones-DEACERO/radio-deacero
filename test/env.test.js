'use strict';
/* Lector mínimo de .env (sin dependencias): las claves viven en el entorno, nunca en el repo. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseEnv, loadEnv } = require('../src/env');

test('parseEnv: pares CLAVE=valor, comentarios, comillas y espacios', () => {
  const r = parseEnv([
    '# comentario', '', 'GEMINI_KEY=abc123', 'MODELO = gemini-x ', 'CON_COMILLAS="hola mundo"', "SIMPLES='a b'", 'export CON_EXPORT=1',
    'CON_COMENTARIO=valor # esto se ignora', 'VACIA=', '   ESPACIADA=ok'
  ].join('\n'));
  assert.deepEqual(r, { GEMINI_KEY: 'abc123', MODELO: 'gemini-x', CON_COMILLAS: 'hola mundo', SIMPLES: 'a b', CON_EXPORT: '1', CON_COMENTARIO: 'valor', VACIA: '', ESPACIADA: 'ok' });
});

test('parseEnv: CRLF, BOM y líneas raras no rompen', () => {
  assert.deepEqual(parseEnv('﻿A=1\r\nB=2\r\n'), { A: '1', B: '2' });
  assert.deepEqual(parseEnv('sin igual\n=sinclave\n1MALA=x\nBUENA=y'), { BUENA: 'y' });
  assert.deepEqual(parseEnv(undefined), {});
  assert.deepEqual(parseEnv('A=http://x.com/?a=b&c=d'), { A: 'http://x.com/?a=b&c=d' });
});

test('parseEnv: nombres peligrosos no se aceptan (__proto__, constructor)', () => {
  const r = parseEnv('__proto__=x\nconstructor=y\nOK=1');
  assert.equal(Object.keys(r).join(','), 'OK');
  assert.equal({}.x, undefined);
});

test('loadEnv: carga el archivo y NO pisa lo que ya está definido en el entorno', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'play-env-')), '.env');
  fs.writeFileSync(f, 'PLAY_T_UNO=del-archivo\nPLAY_T_DOS=del-archivo\n');
  const env = { PLAY_T_DOS: 'del-entorno' };
  const r = loadEnv(f, env);
  assert.equal(env.PLAY_T_UNO, 'del-archivo');
  assert.equal(env.PLAY_T_DOS, 'del-entorno', 'manda el entorno');
  assert.deepEqual(r.cargadas, ['PLAY_T_UNO']);
});

test('loadEnv: sin archivo no falla; y el resultado nunca incluye los valores', () => {
  assert.deepEqual(loadEnv(path.join(os.tmpdir(), 'no-existe-' + Date.now(), '.env'), {}), { cargadas: [], archivo: false });
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'play-env-')), '.env');
  fs.writeFileSync(f, 'SECRETO_X=valor-muy-secreto\n');
  assert.ok(!JSON.stringify(loadEnv(f, {})).includes('valor-muy-secreto'));
});

test('el .env está ignorado por git y server.js lo carga antes de leer la configuración', () => {
  const root = path.join(__dirname, '..');
  const { spawnSync } = require('node:child_process');
  assert.equal(spawnSync('git', ['check-ignore', '-q', '.env'], { cwd: root }).status, 0);
  const src = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.ok(src.indexOf('loadEnv(') > -1 && src.indexOf('loadEnv(') < src.indexOf('process.env.GEMINI_KEY'), 'loadEnv va antes de usar GEMINI_KEY');
});
