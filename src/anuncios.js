'use strict';
/* anuncios.js — mensajes de bienestar y jingles programados para las PANTALLAS (no para los oyentes del panel).
 * El servidor es el único reloj: cada tick revisa la programación y manda por SSE { cmd:'anuncio', id, nombre };
 * la pantalla baja la música y reproduce GET /api/anuncio/:id.
 * Datos: DATA_DIR/anuncios.json (programación) y DATA_DIR/anuncios/<id>.mp3 (audio). */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { readJson, writeJson } = require('./jsonfile');
const { aMin } = require('./horario');

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ANUNCIOS = 50;
const VENTANA_MIN = 5; /* una franja solo suena en sus primeros minutos (tras un reinicio no suena a deshora) */
const ID = /^[a-f0-9]{8}$/;

/* Encabezado de mp3: etiqueta ID3 o un marco MPEG (11 bits de sincronía). No basta con la extensión. */
function esMp3(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 128) return false;
  if (buf.slice(0, 3).toString('latin1') === 'ID3') return true;
  return buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0;
}

function decodificar(audio) {
  if (typeof audio !== 'string') return null;
  const b64 = audio.replace(/^data:audio\/(mpeg|mp3);base64,/, '').replace(/\s+/g, '');
  if (!b64 || b64.length > Math.ceil((MAX_BYTES + 3) / 3) * 4 + 8 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null;
  const buf = Buffer.from(b64, 'base64');
  return buf.length <= MAX_BYTES && esMp3(buf) ? buf : null;
}

/* Programación: { nombre, dias, desde, hasta, cadaMin, activo }. `previo` = valores actuales (para PATCH). */
function validarProgramacion(b, previo = {}) {
  const v = { ...previo };
  for (const k of ['nombre', 'dias', 'desde', 'hasta', 'cadaMin', 'activo']) if (b[k] !== undefined) v[k] = b[k];
  if (v.activo === undefined) v.activo = true;
  if (typeof v.nombre !== 'string' || !v.nombre.trim() || v.nombre.trim().length > 60) return 'nombre de 1 a 60 caracteres';
  if (!Array.isArray(v.dias) || !v.dias.length || !v.dias.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) return 'días inválidos (0 = domingo … 6 = sábado)';
  const d = aMin(v.desde), h = aMin(v.hasta);
  if (d === null || h === null || d >= h) return 'franja inválida (HH:MM, "desde" antes que "hasta")';
  if (!Number.isInteger(v.cadaMin) || !(v.cadaMin === 0 || (v.cadaMin >= 15 && v.cadaMin <= 720))) return 'cadaMin: 0 (una vez) o de 15 a 720';
  if (typeof v.activo !== 'boolean') return 'activo: sí/no';
  return { nombre: v.nombre.trim(), dias: [...new Set(v.dias)].sort((x, y) => x - y), desde: v.desde, hasta: v.hasta, cadaMin: v.cadaMin, activo: v.activo };
}

function createAnuncios({ dir, send, clock = Date.now, tickMs = 0 }) {
  const file = path.join(dir, 'anuncios.json');
  const audioDir = path.join(dir, 'anuncios');
  const leidos = readJson(file, []);
  let items = Array.isArray(leidos) ? leidos.filter((a) => a && ID.test(a.id) && typeof validarProgramacion(a) === 'object') : [];
  const sonado = new Map(); /* id → clave de la última franja que sonó */

  const guardar = () => writeJson(file, items);
  const pub = (a) => ({ ...a });
  const find = (id) => (ID.test(id) ? items.find((a) => a.id === id) : undefined);

  function add(b) {
    if (!b || typeof b !== 'object') return { ok: false, error: 'DATOS_INVALIDOS', detalle: 'cuerpo inválido' };
    const prog = validarProgramacion(b);
    if (typeof prog === 'string') return { ok: false, error: 'DATOS_INVALIDOS', detalle: prog };
    if (items.length >= MAX_ANUNCIOS) return { ok: false, error: 'DATOS_INVALIDOS', detalle: `máximo ${MAX_ANUNCIOS} anuncios` };
    const buf = decodificar(b.audio);
    if (!buf) return { ok: false, error: 'AUDIO_INVALIDO', detalle: 'un .mp3 de hasta 5 MB' };
    const a = { id: crypto.randomBytes(4).toString('hex'), ...prog, bytes: buf.length, creado: clock() };
    fs.mkdirSync(audioDir, { recursive: true });
    fs.writeFileSync(path.join(audioDir, a.id + '.mp3'), buf);
    items.push(a);
    guardar();
    return { ok: true, anuncio: pub(a) };
  }

  function patch(id, b) {
    const a = find(id);
    if (!a) return { ok: false, error: 'NO_EXISTE' };
    if (!b || typeof b !== 'object') return { ok: false, error: 'DATOS_INVALIDOS', detalle: 'cuerpo inválido' };
    const prog = validarProgramacion(b, a);
    if (typeof prog === 'string') return { ok: false, error: 'DATOS_INVALIDOS', detalle: prog };
    Object.assign(a, prog);
    guardar();
    return { ok: true, anuncio: pub(a) };
  }

  function remove(id) {
    const a = find(id);
    if (!a) return false;
    items = items.filter((x) => x !== a);
    guardar();
    try { fs.unlinkSync(path.join(audioDir, a.id + '.mp3')); } catch (_) { /* ya no estaba */ }
    sonado.delete(id);
    return true;
  }

  /* Ruta del mp3 (solo de un anuncio que existe), o null. */
  const archivo = (id) => (find(id) ? path.join(audioDir, id + '.mp3') : null);

  const disparar = (a) => send({ cmd: 'anuncio', id: a.id, nombre: a.nombre });
  const probar = (id) => { const a = find(id); return a ? disparar(a) : null; };

  /* Revisa la programación con la hora del servidor. Una vez por franja (cada cadaMin desde "desde"; con 0, una al día). */
  function tick() {
    const ms = clock();
    const d = new Date(ms);
    const dia = d.getDay(), min = d.getHours() * 60 + d.getMinutes();
    const hoy = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    for (const a of items) {
      if (!a.activo || !a.dias.includes(dia)) continue;
      const desde = aMin(a.desde), hasta = aMin(a.hasta);
      if (min < desde || min >= hasta) continue;
      const dentro = min - desde;
      const franja = a.cadaMin ? Math.floor(dentro / a.cadaMin) : 0;
      if (dentro - franja * (a.cadaMin || 0) >= VENTANA_MIN) continue;
      const clave = `${hoy}#${franja}`;
      if (sonado.get(a.id) === clave) continue;
      sonado.set(a.id, clave);
      disparar(a);
    }
  }

  let timer = null;
  if (tickMs > 0) { timer = setInterval(tick, tickMs); if (timer.unref) timer.unref(); }

  return { list: () => items.map(pub), add, patch, remove, archivo, probar, tick, stop: () => timer && clearInterval(timer) };
}

module.exports = { createAnuncios, esMp3, MAX_BYTES };
