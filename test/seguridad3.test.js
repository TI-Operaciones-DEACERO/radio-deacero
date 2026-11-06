'use strict';
/* Tercera auditoría (Fase 6): rutas de administración no declaradas, .env de datos y redacción del diagnóstico. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { withServer } = require('./helpers/servidor');
const { createPrograma } = require('../src/horario');

const GENRES = [{ id: 'jazz', label: 'Jazz', emoji: '🎷', color: '#f90', featured: true, queries: ['x'], mood: 'focus' }];

test('sin REMOTE_TOKEN, desde la red, una ruta de administración NO declarada no llega al manejador (no filtra el horario)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'play-s3-'));
  const programa = createPrograma({ dir, genres: GENRES });
  await withServer({ genres: GENRES, programa, token: '', trustLoopback: false }, async (s, c) => {
    for (const u of ['/api/admin/horario/x', '/api/admin/horarioX', '/api/admin/horario/', '/api/admin/nada']) {
      const r = await c.call('GET', u);
      assert.equal(r.status, 401, u);
      assert.equal(r.json && r.json.modo, undefined, u);
    }
  });
});

test('con la clave, una ruta de administración no declarada responde 404 (no el horario)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'play-s3-'));
  const programa = createPrograma({ dir, genres: GENRES });
  await withServer({ genres: GENRES, programa }, async (s, c) => {
    const r = await c.call('GET', '/api/admin/horario/x', { headers: { 'x-token': 'clave-de-prueba' } });
    assert.equal(r.status, 404);
  });
});

/* DATA_DIR/.env: en Windows instalado por un administrador, el grupo Usuarios puede escribir en data\ (lo necesita la app).
 * Ese .env NO debe poder fijar el ejecutable de yt-dlp, sus argumentos, ni variables que cambien qué código corre (PATH, NODE_OPTIONS...). */
test('loadEnv con lista de permitidas: solo carga esas', () => {
  const { loadEnv, ENV_DATOS } = require('../src/env');
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'play-env3-')), '.env');
  fs.writeFileSync(f, 'GEMINI_KEY=k\nYTDLP_BIN=C:/malo.exe\nYTDLP_EXTRA=--exec calc\nPATH=x\nNODE_OPTIONS=--require x\nPYTHONPATH=x\nDATA_DIR=x\n');
  const env = {};
  const r = loadEnv(f, env, { permitidas: ENV_DATOS });
  assert.deepEqual(r.cargadas, ['GEMINI_KEY']);
  assert.deepEqual(Object.keys(env), ['GEMINI_KEY']);
  assert.deepEqual(r.ignoradas.sort(), ['DATA_DIR', 'NODE_OPTIONS', 'PATH', 'PYTHONPATH', 'YTDLP_BIN', 'YTDLP_EXTRA']);
  for (const k of ['YTDLP_BIN', 'YTDLP_EXTRA', 'PATH', 'NODE_OPTIONS', 'DATA_DIR', 'HOST', 'PORT']) assert.equal(ENV_DATOS.has(k), false, k);
});

test('server.js: el .env de DATA_DIR no carga YTDLP_EXTRA/YTDLP_BIN (sí GEMINI_MODEL)', async () => {
  const { spawn } = require('node:child_process');
  const net = require('node:net');
  const datos = fs.mkdtempSync(path.join(os.tmpdir(), 'play-env3s-'));
  fs.writeFileSync(path.join(datos, '.env'), 'GEMINI_MODEL=modelo-x\nYTDLP_EXTRA=--exec calc\nNODE_OPTIONS=--require x\n');
  const port = await new Promise((ok) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
  const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: datos, REMOTE_TOKEN: '', GEMINI_KEY: '', YTDLP_BIN: path.join(datos, 'no-existe') };
  for (const k of ['GEMINI_MODEL', 'YTDLP_EXTRA', 'NODE_OPTIONS']) delete env[k];
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  srv.stdout.on('data', (d) => (out += d)); srv.stderr.on('data', (d) => (out += d));
  try {
    const fin = Date.now() + 20000;
    while (!/ignoradas/.test(out) && Date.now() < fin) await new Promise((r) => setTimeout(r, 100));
    assert.match(out, /\.env de datos cargado \(1 variable\(s\)\)/, out);
    assert.match(out, /ignorad/i, 'avisa de lo que no carga');
  } finally { srv.kill(); try { fs.rmSync(datos, { recursive: true, force: true }); } catch (_) { /* Windows */ } }
});

test('diagnóstico: también borra claves en forma de cabecera, JSON y Bearer', () => {
  const { createDiagnostico } = require('../src/diagnostico');
  const d = createDiagnostico();
  d.add('x', 'error', 'fallo con x-token: s3cr3t-uno y {"token":"s3cr3t-dos"} y Authorization: Bearer s3cr3t-tres y password: s3cr3t-cuatro');
  const msg = d.eventos()[0].msg;
  for (const s of ['s3cr3t-uno', 's3cr3t-dos', 's3cr3t-tres', 's3cr3t-cuatro']) assert.equal(msg.includes(s), false, `${s} en: ${msg}`);
  assert.match(msg, /fallo con/);
});

test('letras (abiertas al oyente): título y canal se recortan antes de salir a lrclib / lyrics.ovh', async () => {
  const pedidas = [];
  const lyrics = { get: async (o) => { pedidas.push(o); return { synced: null, plain: 'x' }; } };
  await withServer({ genres: GENRES, lyrics }, async (s, c) => {
    const largo = 'a'.repeat(5000);
    const r = await c.call('GET', `/api/lyrics?title=${largo}&channel=${largo}&sid=oyente-12345`);
    assert.equal(r.status, 200);
    assert.ok(pedidas[0].title.length <= 200 && pedidas[0].channel.length <= 200, `${pedidas[0].title.length}/${pedidas[0].channel.length}`);
  });
});

test('install.ps1: la clave de control remoto sale de un generador criptográfico (no de Get-Random)', () => {
  const ps = fs.readFileSync(path.join(__dirname, '..', 'deploy', 'windows', 'install.ps1'), 'utf8');
  const linea = ps.split(/\r?\n/).filter((l) => /\$Token\s*=/.test(l) && !/old\.token/.test(l));
  assert.ok(linea.length, 'hay una línea que genera la clave');
  for (const l of linea) assert.doesNotMatch(l, /Get-Random/, l);
  assert.match(ps, /RandomNumberGenerator/);
});
