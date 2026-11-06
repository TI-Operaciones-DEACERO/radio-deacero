'use strict';
/* Fase 8: copia y restauración de DATA_DIR (cuentas, favoritos, horario, anuncios, podcasts, historial, .env de datos). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { respaldar, restaurar } = require('../scripts/respaldo');

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

test('respaldar copia todo DATA_DIR (con subcarpetas) a una carpeta con fecha, y restaurar lo devuelve', () => {
  const datos = tmp('play-datos-');
  fs.writeFileSync(path.join(datos, 'users.json'), '[1]');
  fs.mkdirSync(path.join(datos, 'anuncios'));
  fs.writeFileSync(path.join(datos, 'anuncios', 'abcd1234.mp3'), 'ID3');
  fs.writeFileSync(path.join(datos, 'users.json.tmp'), 'basura');
  const destino = tmp('play-resp-');
  const carpeta = respaldar(datos, destino, new Date(2026, 10, 6, 9, 5));
  assert.equal(path.basename(carpeta), 'play-datos-2026-11-06-0905');
  assert.equal(fs.readFileSync(path.join(carpeta, 'anuncios', 'abcd1234.mp3'), 'utf8'), 'ID3');
  assert.equal(fs.existsSync(path.join(carpeta, 'users.json.tmp')), false, 'sin temporales');

  fs.writeFileSync(path.join(datos, 'users.json'), '[2]');
  fs.writeFileSync(path.join(datos, 'nuevo.json'), 'x');
  const previo = restaurar(carpeta, datos, new Date(2026, 10, 6, 10, 0));
  assert.equal(fs.readFileSync(path.join(datos, 'users.json'), 'utf8'), '[1]');
  assert.equal(fs.existsSync(path.join(datos, 'nuevo.json')), false, 'queda exactamente como el respaldo');
  assert.equal(fs.readFileSync(path.join(previo, 'users.json'), 'utf8'), '[2]', 'lo que había antes no se pierde');
});

test('restaurar se niega si la carpeta no parece un respaldo de datos', () => {
  assert.throws(() => restaurar(tmp('play-vacio-'), tmp('play-datos-')), /no parece un respaldo/);
  assert.throws(() => respaldar(path.join(os.tmpdir(), 'no-existe-' + Date.now()), tmp('play-resp-')), /no existe/);
});
