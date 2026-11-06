'use strict';
/* Fase 6: ajustes (filtro de títulos), anuncios programados y diagnóstico. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAjustes } = require('../src/ajustes');
const { createAnuncios, esMp3 } = require('../src/anuncios');
const { createDiagnostico } = require('../src/diagnostico');

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const at = (dia, hh, mm = 0, ss = 0) => new Date(2026, 10, 1 + dia, hh, mm, ss).getTime(); /* dia 0 = domingo */
const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(400, 1)]);
const MP3_FRAME = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x64]), Buffer.alloc(400, 2)]);

/* — ajustes — */
test('ajustes: apagado por defecto (no cambia lo de siempre); encendido filtra por palabras del título, sin acentos ni mayúsculas', () => {
  const dir = tmp('play-aj-');
  const a = createAjustes({ dir });
  assert.deepEqual(a.get(), { filtroExplicito: false, palabras: [] });
  assert.equal(a.permite({ title: 'Canción (Explicit)' }), true);
  assert.equal(a.set({ filtroExplicito: true, palabras: ['Grosería'] }).ok, true);
  assert.equal(a.permite({ title: 'Canción (Explicit)' }), false);
  assert.equal(a.permite({ title: 'Versión SIN CENSURA' }), false);
  assert.equal(a.permite({ title: 'una groseria aquí' }), false, 'palabra extra, sin acento');
  assert.equal(a.permite({ title: 'Explicitamente bonito' }), true, 'palabra completa, no prefijo');
  assert.equal(a.permite({ title: 'Canción limpia' }), true);
  assert.equal(createAjustes({ dir }).get().filtroExplicito, true, 'se guarda');
});

test('ajustes: valida', () => {
  const a = createAjustes({ dir: tmp('play-aj-') });
  for (const malo of [null, { filtroExplicito: 'si' }, { filtroExplicito: true, palabras: 'x' }, { filtroExplicito: true, palabras: Array(201).fill('a') }, { filtroExplicito: true, palabras: ['x'.repeat(41)] }]) {
    assert.equal(a.set(malo).ok, false, JSON.stringify(malo));
  }
  assert.deepEqual(a.set({ filtroExplicito: true, palabras: [' a ', 'a', ''] }).ajustes.palabras, ['a']);
});

/* — anuncios — */
test('esMp3: encabezado ID3 o marco MPEG; nada más', () => {
  assert.equal(esMp3(MP3), true);
  assert.equal(esMp3(MP3_FRAME), true);
  assert.equal(esMp3(Buffer.from('<html>' + 'x'.repeat(400))), false);
  assert.equal(esMp3(Buffer.from('ID3')), false, 'demasiado corto');
});

function mkAnuncios(extra = {}) {
  const dir = tmp('play-an-');
  const enviados = [];
  const reloj = { t: at(1, 9) };
  const a = createAnuncios({ dir, send: (c) => { enviados.push(c); return 1; }, clock: () => reloj.t, ...extra });
  return { dir, a, enviados, reloj };
}
const base = { nombre: 'Pausa activa', dias: [1, 2, 3, 4, 5], desde: '09:00', hasta: '17:00', cadaMin: 60 };

test('anuncios: alta valida audio y datos, guarda el mp3 aparte con id de 8 hex', () => {
  const { a, dir } = mkAnuncios();
  const r = a.add({ ...base, audio: MP3.toString('base64') });
  assert.equal(r.ok, true);
  assert.match(r.anuncio.id, /^[a-f0-9]{8}$/);
  assert.equal(r.anuncio.bytes, MP3.length);
  assert.equal(r.anuncio.activo, true);
  assert.ok(fs.readFileSync(a.archivo(r.anuncio.id)).equals(MP3));
  assert.ok(a.archivo(r.anuncio.id).startsWith(dir));
  assert.equal(a.add({ ...base, audio: Buffer.from('no es audio, es texto' + 'x'.repeat(300)).toString('base64') }).error, 'AUDIO_INVALIDO');
  assert.equal(a.add({ ...base, audio: 'no-es-base64!!' }).error, 'AUDIO_INVALIDO');
  assert.equal(a.add({ ...base, cadaMin: 5, audio: MP3.toString('base64') }).error, 'DATOS_INVALIDOS');
  assert.equal(a.add({ ...base, nombre: '', audio: MP3.toString('base64') }).error, 'DATOS_INVALIDOS');
  assert.equal(a.add({ ...base, audio: Buffer.concat([Buffer.from('ID3'), Buffer.alloc(5 * 1024 * 1024)]).toString('base64') }).error, 'AUDIO_INVALIDO', '> 5 MB');
  assert.equal(a.list().length, 1);
  assert.equal(a.list()[0].audio, undefined, 'la lista no trae el audio');
});

test('anuncios: se acepta el prefijo data:audio/mpeg;base64,', () => {
  const { a } = mkAnuncios();
  assert.equal(a.add({ ...base, audio: 'data:audio/mpeg;base64,' + MP3_FRAME.toString('base64') }).ok, true);
});

test('anuncios: suena UNA vez por franja, solo en sus días y horas, y no si está inactivo', () => {
  const { a, enviados, reloj } = mkAnuncios();
  const { anuncio } = a.add({ ...base, audio: MP3.toString('base64') });
  reloj.t = at(1, 9, 0, 10); a.tick();
  reloj.t = at(1, 9, 0, 40); a.tick();
  reloj.t = at(1, 9, 3); a.tick();
  assert.equal(enviados.length, 1);
  assert.deepEqual(enviados[0], { cmd: 'anuncio', id: anuncio.id, nombre: 'Pausa activa' });
  reloj.t = at(1, 9, 30); a.tick();
  assert.equal(enviados.length, 1, 'misma franja de 60 min');
  reloj.t = at(1, 10, 0, 20); a.tick();
  assert.equal(enviados.length, 2, 'franja siguiente');
  reloj.t = at(1, 17, 0, 20); a.tick();
  assert.equal(enviados.length, 2, 'hasta es exclusivo');
  reloj.t = at(0, 10, 0, 20); a.tick();
  assert.equal(enviados.length, 2, 'domingo no está en sus días');
  a.patch(anuncio.id, { activo: false });
  reloj.t = at(2, 11, 0, 20); a.tick();
  assert.equal(enviados.length, 2, 'inactivo');
});

test('anuncios: tras un reinicio a media franja no suena tarde (solo en los primeros minutos de la franja)', () => {
  const { a, enviados, reloj } = mkAnuncios();
  a.add({ ...base, audio: MP3.toString('base64') });
  reloj.t = at(1, 9, 40); a.tick();
  assert.equal(enviados.length, 0);
});

test('anuncios: cadaMin 0 = una sola vez al día a la hora "desde"', () => {
  const { a, enviados, reloj } = mkAnuncios();
  a.add({ ...base, cadaMin: 0, audio: MP3.toString('base64') });
  for (const [h, m] of [[9, 0], [9, 1], [10, 0], [12, 0]]) { reloj.t = at(1, h, m, 5); a.tick(); }
  assert.equal(enviados.length, 1);
  reloj.t = at(2, 9, 0, 5); a.tick();
  assert.equal(enviados.length, 2, 'al día siguiente otra vez');
});

test('anuncios: patch valida, remove borra el archivo, probar dispara ya', () => {
  const { a, enviados } = mkAnuncios();
  const { anuncio } = a.add({ ...base, audio: MP3.toString('base64') });
  assert.equal(a.patch(anuncio.id, { desde: '18:00' }).error, 'DATOS_INVALIDOS', 'desde después de hasta');
  assert.equal(a.patch(anuncio.id, { nombre: 'Nuevo', id: 'ffffffff', bytes: 1 }).anuncio.nombre, 'Nuevo');
  assert.equal(a.list()[0].id, anuncio.id);
  assert.equal(a.probar(anuncio.id), 1);
  assert.equal(enviados.length, 1);
  assert.equal(a.probar('00000000'), null);
  const f = a.archivo(anuncio.id);
  assert.equal(a.remove(anuncio.id), true);
  assert.equal(fs.existsSync(f), false);
  assert.equal(a.remove(anuncio.id), false);
  assert.equal(a.archivo(anuncio.id), null);
});

test('anuncios: sobreviven a un reinicio', () => {
  const { a, dir } = mkAnuncios();
  a.add({ ...base, audio: MP3.toString('base64') });
  assert.equal(createAnuncios({ dir, send: () => 0 }).list().length, 1);
});

/* — diagnóstico — */
test('diagnóstico: anillo con tope, resumen por servicio en la última hora, sin secretos', () => {
  const r = { t: 1_000_000_000 };
  const d = createDiagnostico({ now: () => r.t, cap: 5 });
  d.add('yt-dlp', 'error', 'falló la búsqueda');
  r.t += 2 * 60 * 60 * 1000;
  for (let i = 0; i < 6; i++) d.add('yt-dlp', 'error', 'x' + i);
  d.add('gemini', 'aviso', 'cuota agotada key=AIzaSECRETO123 ?key=AIzaOTRO');
  const ev = d.eventos();
  assert.equal(ev.length, 5, 'tope');
  assert.equal(ev[0].servicio, 'gemini', 'el más reciente primero');
  assert.ok(!JSON.stringify(ev).includes('SECRETO') && !JSON.stringify(ev).includes('AIzaOTRO'));
  const s = d.resumen();
  const yt = s.find((x) => x.servicio === 'yt-dlp');
  assert.equal(yt.errores1h, 4, 'solo lo que sigue en el anillo y es de la última hora');
  assert.equal(s.find((x) => x.servicio === 'gemini').avisos1h, 1);
  d.add('x', 'raro', 'y'.repeat(1000));
  assert.equal(d.eventos()[0].nivel, 'info');
  assert.ok(d.eventos()[0].msg.length <= 300);
});
