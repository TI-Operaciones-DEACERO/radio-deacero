#!/usr/bin/env node
'use strict';
/* respaldo.js — copia y restauración de los datos (DATA_DIR): cuentas, favoritos, horario, anuncios, ajustes, podcasts, historial y .env de datos.
 *
 *   node scripts/respaldo.js respaldar [destino]          copia DATA_DIR a <destino>/play-datos-AAAA-MM-DD-HHMM (por defecto ./respaldos)
 *   node scripts/respaldo.js restaurar <carpeta>          deja DATA_DIR igual que el respaldo (lo de antes se guarda aparte)
 *
 * Restaurar con el servidor DETENIDO (si no, puede volver a escribir encima). Los respaldos tienen datos personales: no los subas al repo. */
const fs = require('node:fs');
const path = require('node:path');

const MARCAS = ['users.json', 'sessions.json', 'podcasts.json', 'history.json', 'horario.json', 'ajustes.json', 'anuncios.json', 'users', 'anuncios', '.env', 'nominas-permitidas.txt'];
const p2 = (n) => String(n).padStart(2, '0');
const sello = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
const sinTemporales = (src) => !src.endsWith('.tmp');

function respaldar(datos, destino, ahora = new Date()) {
  if (!fs.existsSync(datos)) throw new Error(`DATA_DIR no existe: ${datos}`);
  let carpeta = path.join(destino, 'play-datos-' + sello(ahora));
  for (let i = 2; fs.existsSync(carpeta); i++) carpeta = path.join(destino, `play-datos-${sello(ahora)}-${i}`);
  fs.mkdirSync(destino, { recursive: true });
  fs.cpSync(datos, carpeta, { recursive: true, filter: sinTemporales });
  return carpeta;
}

function restaurar(carpeta, datos, ahora = new Date()) {
  const ok = fs.existsSync(carpeta) && fs.readdirSync(carpeta).some((f) => MARCAS.includes(f));
  if (!ok) throw new Error(`${carpeta} no parece un respaldo de datos de Play`);
  /* lo que había se aparta (no se borra) por si el respaldo era el equivocado */
  const previo = `${datos}.antes-de-restaurar-${sello(ahora)}`;
  if (fs.existsSync(datos)) fs.cpSync(datos, previo, { recursive: true });
  fs.rmSync(datos, { recursive: true, force: true });
  fs.cpSync(carpeta, datos, { recursive: true, filter: sinTemporales });
  return previo;
}

if (require.main === module) {
  const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
  const [orden, arg] = process.argv.slice(2);
  try {
    if (orden === 'respaldar') console.log('Respaldo en ' + respaldar(DATA_DIR, path.resolve(arg || path.join(__dirname, '..', 'respaldos'))));
    else if (orden === 'restaurar' && arg) console.log(`Restaurado ${DATA_DIR}. Lo anterior quedó en ${restaurar(path.resolve(arg), DATA_DIR)}`);
    else { console.log('Uso: node scripts/respaldo.js respaldar [destino] | restaurar <carpeta>   (DATA_DIR=' + DATA_DIR + ')'); process.exitCode = 2; }
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}

module.exports = { respaldar, restaurar };
