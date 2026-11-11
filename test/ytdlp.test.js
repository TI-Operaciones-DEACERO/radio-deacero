'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createYtdlp, ttlFromUrl } = require('../src/ytdlp');

/* spawn falso: handler(args) → { stdout, stderr, code } */
function fakeSpawn(handler) {
  const calls = [];
  const spawn = (cmd, args) => {
    calls.push({ cmd, args });
    const p = new EventEmitter();
    p.stdout = new PassThrough();
    p.stderr = new PassThrough();
    p.kill = () => {};
    setImmediate(() => {
      const r = handler(args);
      p.stdout.end(r.stdout || '');
      p.stderr.end(r.stderr || '');
      setImmediate(() => p.emit('close', r.code ?? 0));
    });
    return p;
  };
  spawn.calls = calls;
  return spawn;
}

const CMD = { cmd: 'yt-dlp', extra: [] };
const NOW = 1_800_000_000_000;
const line = (o) => JSON.stringify(o);
const ID = (c) => String(c).repeat(11);

test('search: deja solo pistas válidas (id de 11 car., 60 s–4 h, sin vivo ni ruido)', async () => {
  const out = [
    line({ id: ID('a'), title: 'Song A', channel: 'Band', duration: 200 }),
    line({ id: 'corto', title: 'Id inválido', duration: 200 }),
    line({ id: ID('b'), title: 'Transmisión en vivo', duration: null }),
    line({ id: ID('c'), title: 'Mix de 3 horas', duration: 10800 }),
    line({ id: ID('g'), title: 'Maratón de 12 horas', duration: 43200 }),
    line({ id: ID('d'), title: 'Short', duration: 20 }),
    line({ id: ID('e'), title: 'Song E karaoke version', duration: 200 }),
    line({ id: ID('f'), title: 'Song F', uploader: 'Otro', duration: 61 }),
    'no es json'
  ].join('\n');
  const spawn = fakeSpawn(() => ({ stdout: out }));
  const yt = createYtdlp({ spawn, cmd: CMD, now: () => NOW });

  const items = await yt.search('lofi', 5);

  assert.deepEqual(items.map((i) => i.id), [ID('a'), ID('c'), ID('f')]);
  assert.deepEqual(items[0], { id: ID('a'), title: 'Song A', channel: 'Band', duration: 200 });
  assert.equal(items.find((i) => i.id === ID('f')).channel, 'Otro');
  assert.equal(spawn.calls[0].args[0], 'ytsearch5:lofi');
});

test('search: rechaza con la última línea de stderr si yt-dlp falla sin salida', async () => {
  const spawn = fakeSpawn(() => ({ code: 1, stderr: 'warn\nERROR: sin red\n' }));
  const yt = createYtdlp({ spawn, cmd: CMD });
  await assert.rejects(yt.search('x', 3), /ERROR: sin red/);
});

test('resolve audio: pide m4a, parsea duración y URL', async () => {
  const url = `https://rr1.googlevideo.com/videoplayback?expire=${NOW / 1000 + 600}&id=1`;
  const spawn = fakeSpawn(() => ({ stdout: `213\n${url}\n` }));
  const yt = createYtdlp({ spawn, cmd: CMD, now: () => NOW });

  const r = await yt.resolve(ID('a'), 'audio');

  assert.equal(r.url, url);
  assert.equal(r.duration, 213);
  const args = spawn.calls[0].args;
  assert.match(args[args.indexOf('-f') + 1], /bestaudio\[ext=m4a\]/);
  assert.ok(args.includes('--no-playlist'));
});

test('resolve video: solo video (sin audio) de 360p H.264, un único formato', async () => {
  const spawn = fakeSpawn(() => ({ stdout: 'NA\nhttps://rr1.googlevideo.com/v\n' }));
  const yt = createYtdlp({ spawn, cmd: CMD });

  const r = await yt.resolve(ID('a'), 'video');

  assert.equal(r.duration, null);
  const args = spawn.calls[0].args;
  const fmt = args[args.indexOf('-f') + 1];
  assert.match(fmt, /^bv\[/, 'video sin audio (YouTube ya no sirve formatos combinados)');
  assert.match(fmt, /height<=360/);
  assert.match(fmt, /avc1/);
  assert.ok(!fmt.includes('+'), 'sin mezclar formatos: no hay ffmpeg');
});

test('resolve: cachea según el parámetro expire de la URL', async () => {
  const live = `https://x.googlevideo.com/v?expire=${NOW / 1000 + 600}`;
  const spawn = fakeSpawn(() => ({ stdout: `100\n${live}\n` }));
  const yt = createYtdlp({ spawn, cmd: CMD, now: () => NOW });

  await yt.resolve(ID('a'), 'audio');
  await yt.resolve(ID('a'), 'audio');
  assert.equal(spawn.calls.length, 1, 'segunda llamada sale de caché');

  await yt.resolve(ID('a'), 'video');
  assert.equal(spawn.calls.length, 2, 'el modo forma parte de la clave');
});

test('isResolved: dice si la URL ya está en caché y vigente, sin lanzar procesos', async () => {
  const live = `https://x.googlevideo.com/v?expire=${NOW / 1000 + 600}`;
  const spawn = fakeSpawn(() => ({ stdout: `100\n${live}\n` }));
  const t = { now: NOW };
  const yt = createYtdlp({ spawn, cmd: CMD, now: () => t.now });
  assert.equal(yt.isResolved(ID('a')), false);
  await yt.resolve(ID('a'), 'audio');
  assert.equal(yt.isResolved(ID('a')), true);
  assert.equal(yt.isResolved(ID('a'), 'video'), false);
  t.now += 601 * 1000;
  assert.equal(yt.isResolved(ID('a')), false, 'caducada');
  assert.equal(spawn.calls.length, 1);
});

test('resolve: no cachea URLs que ya caducaron o caducan en < 60 s', async () => {
  const dead = `https://x.googlevideo.com/v?expire=${NOW / 1000 + 30}`;
  const spawn = fakeSpawn(() => ({ stdout: `100\n${dead}\n` }));
  const yt = createYtdlp({ spawn, cmd: CMD, now: () => NOW });

  await yt.resolve(ID('a'), 'audio');
  await yt.resolve(ID('a'), 'audio');
  assert.equal(spawn.calls.length, 2);
});

test('resolve: llamadas simultáneas del mismo id comparten un solo proceso', async () => {
  const spawn = fakeSpawn(() => ({ stdout: '100\nhttps://x.googlevideo.com/v\n' }));
  const yt = createYtdlp({ spawn, cmd: CMD });

  const [a, b] = await Promise.all([yt.resolve(ID('a'), 'audio'), yt.resolve(ID('a'), 'audio')]);

  assert.equal(spawn.calls.length, 1);
  assert.equal(a.url, b.url);
});

test('resolve: id inválido se rechaza sin lanzar procesos', async () => {
  const spawn = fakeSpawn(() => ({ stdout: '' }));
  const yt = createYtdlp({ spawn, cmd: CMD });
  await assert.rejects(yt.resolve('../etc/passwd', 'audio'), /ID inválido/);
  await assert.rejects(yt.resolve(ID('a'), 'raro'), /modo/i);
  assert.equal(spawn.calls.length, 0);
});

test('extraArgs (YTDLP_EXTRA) se añaden a búsqueda y resolución', async () => {
  const spawn = fakeSpawn((args) => ({ stdout: args[0].startsWith('ytsearch') ? '' : '100\nhttps://x.googlevideo.com/v\n' }));
  const yt = createYtdlp({ spawn, cmd: CMD, extraArgs: ['--cookies', 'c.txt'] });
  await yt.search('x', 1);
  await yt.resolve(ID('a'), 'audio');
  for (const c of spawn.calls) {
    const i = c.args.indexOf('--cookies');
    assert.ok(i >= 0 && c.args[i + 1] === 'c.txt', c.args.join(' '));
  }
});

test('invalidate: obliga a resolver de nuevo', async () => {
  const live = `https://x.googlevideo.com/v?expire=${NOW / 1000 + 600}`;
  const spawn = fakeSpawn(() => ({ stdout: `100\n${live}\n` }));
  const yt = createYtdlp({ spawn, cmd: CMD, now: () => NOW });

  await yt.resolve(ID('a'), 'audio');
  yt.invalidate(ID('a'));
  await yt.resolve(ID('a'), 'audio');

  assert.equal(spawn.calls.length, 2);
});

test('resolve: sin URL en la salida es un error', async () => {
  const spawn = fakeSpawn(() => ({ stdout: '100\n' }));
  const yt = createYtdlp({ spawn, cmd: CMD });
  await assert.rejects(yt.resolve(ID('a'), 'audio'), /sin URL/i);
});

test('ttlFromUrl: margen de 60 s y tope del llamador', () => {
  const max = 5 * 3600 * 1000;
  assert.equal(ttlFromUrl('https://x/v', max, NOW), max, 'sin expire → tope');
  assert.equal(ttlFromUrl(`https://x/v?expire=${NOW / 1000 + 30}`, max, NOW), 0);
  assert.equal(ttlFromUrl(`https://x/v?expire=${NOW / 1000 + 600}`, max, NOW), 540_000);
  assert.equal(ttlFromUrl(`https://x/v?expire=${NOW / 1000 + 99999}`, max, NOW), max);
});

test('search: minSec/maxSec se pueden ajustar (episodios de podcast) y usa ytsearch normal', async () => {
  const out = [
    line({ id: ID('a'), title: 'Corto', channel: 'P', duration: 120 }),
    line({ id: ID('b'), title: 'Episodio 1', channel: 'P', duration: 1800 }),
    line({ id: ID('c'), title: 'Maratón', channel: 'P', duration: 20000 })
  ].join('\n');
  const spawn = fakeSpawn(() => ({ stdout: out }));
  const yt = createYtdlp({ spawn, cmd: CMD });
  const items = await yt.search('radio ambulante', 5, { minSec: 300, maxSec: 10800 });
  assert.equal(spawn.calls[0].args[0], 'ytsearch5:radio ambulante');
  assert.deepEqual(items.map((i) => i.id), [ID('b')]);
});

/* spawn a mano: cada proceso termina cuando la prueba lo suelta (así se ve el orden en que yt-dlp atiende la fila). */
function spawnManual() {
  const vivos = [];
  const spawn = (cmd, args) => {
    const p = new EventEmitter();
    p.stdout = new PassThrough(); p.stderr = new PassThrough(); p.kill = () => {};
    p.args = args;
    p.soltar = () => { p.stdout.end('100\nhttps://rr1.googlevideo.com/v?expire=9999999999\n'); p.stderr.end(''); setImmediate(() => p.emit('close', 0)); };
    vivos.push(p);
    return p;
  };
  spawn.vivos = vivos;
  return spawn;
}
const tic = () => new Promise((r) => setImmediate(r));
const idDe = (p) => p.args[p.args.length - 1].slice(-11);

test('prioridad: lo de baja prioridad (carátulas y miniclips) usa a lo sumo un lugar y no adelanta a la música en fila', async () => {
  const spawn = spawnManual();
  const yt = createYtdlp({ spawn, cmd: CMD, concurrency: 2, now: () => NOW });
  const bajas = [ID('a'), ID('b'), ID('c')].map((id) => yt.resolve(id, 'video', { baja: true }));
  await tic();
  assert.equal(spawn.vivos.length, 1, 'solo un trabajo de baja prioridad a la vez: el otro lugar queda para la música');
  const musica = [ID('m'), ID('n')].map((id) => yt.resolve(id, 'audio'));
  await tic();
  assert.equal(spawn.vivos.length, 2, 'la música toma el lugar libre al instante');
  assert.equal(idDe(spawn.vivos[1]), ID('m'));
  spawn.vivos[0].soltado = true; spawn.vivos[0].soltar(); await tic(); await tic();
  assert.equal(idDe(spawn.vivos[2]), ID('n'), 'al liberarse un lugar, la música en fila va antes que la baja prioridad');
  for (let i = 0; i < 8; i++) { for (const p of spawn.vivos) if (!p.soltado) { p.soltado = true; p.soltar(); } await tic(); await tic(); }
  await Promise.all([...bajas, ...musica]);
  assert.equal(spawn.vivos.length, 5, 'al final se atiende todo');
});

test('prioridad: si la fila de baja prioridad está llena se rechaza enseguida (los adornos no se acumulan)', async () => {
  const spawn = spawnManual();
  const yt = createYtdlp({ spawn, cmd: CMD, concurrency: 2, now: () => NOW });
  const ps = [];
  for (let i = 0; i < 30; i++) ps.push(yt.resolve(ID(String.fromCharCode(65 + (i % 26))) .slice(0, 10) + String(i % 10), 'video', { baja: true }).then(() => 'ok', () => 'rechazada'));
  await tic();
  const r = await Promise.race([Promise.all(ps.slice(20)), new Promise((res) => setTimeout(() => res('colgada'), 200))]);
  assert.notEqual(r, 'colgada');
  assert.ok(r.every((x) => x === 'rechazada'), 'las que no caben en la fila se rechazan');
  for (let i = 0; i < 15; i++) { for (const p of spawn.vivos) if (!p.soltado) { p.soltado = true; p.soltar(); } await tic(); await tic(); }
  await Promise.all(ps);
});
