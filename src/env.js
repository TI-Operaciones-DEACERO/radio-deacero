'use strict';
/* env.js — lector mínimo de .env (sin dependencias). Las claves (GEMINI_KEY...) viven en el entorno o en un .env que git ignora;
 * nunca en el repo. Lo que ya está definido en el entorno MANDA sobre el archivo. */
const fs = require('node:fs');

const LINEA = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;
const PROHIBIDOS = new Set(['__proto__', 'constructor', 'prototype']);

function parseEnv(texto) {
  const out = {};
  if (typeof texto !== 'string') return out;
  for (const linea of texto.replace(/^﻿/, '').split(/\r?\n/)) {
    if (/^\s*#/.test(linea)) continue;
    const m = LINEA.exec(linea);
    if (!m || PROHIBIDOS.has(m[1])) continue;
    let v = m[2].trim();
    const q = v[0];
    if ((q === '"' || q === "'") && v.length >= 2 && v.endsWith(q)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '').trim();
    out[m[1]] = v;
  }
  return out;
}

/* Lo único que puede venir de DATA_DIR/.env. Esa carpeta la puede escribir más gente que la de la app (en Windows instalado
 * por un administrador, el grupo Usuarios): nada que decida QUÉ se ejecuta (YTDLP_BIN, YTDLP_EXTRA, PATH, NODE_OPTIONS, PYTHONPATH...)
 * ni dónde están los datos o por dónde escucha (DATA_DIR, HOST, PORT): eso va en el entorno o en el .env de la app. */
const ENV_DATOS = new Set(['GEMINI_KEY', 'GEMINI_MODEL', 'REMOTE_TOKEN', 'HOSTS_PERMITIDOS', 'PANEL_V2', 'PANEL_PRINCIPAL', 'PANEL_PUBLICO', 'COOKIE_SECURE', 'ENTRADA_SECRETO']);

/* Carga `file` en `env` (por defecto process.env) sin pisar lo ya definido. Devuelve SOLO los nombres cargados, nunca los valores.
 * permitidas (Set): si se da, lo demás se ignora y se devuelve en `ignoradas` (solo nombres). */
function loadEnv(file, env = process.env, { permitidas } = {}) {
  let texto;
  try { texto = fs.readFileSync(file, 'utf8'); } catch { return { cargadas: [], archivo: false }; }
  const cargadas = [], ignoradas = [];
  for (const [k, v] of Object.entries(parseEnv(texto))) {
    if (permitidas && !permitidas.has(k)) { ignoradas.push(k); continue; }
    if (Object.prototype.hasOwnProperty.call(env, k)) continue;
    env[k] = v;
    cargadas.push(k);
  }
  return { cargadas, ignoradas, archivo: true };
}

module.exports = { parseEnv, loadEnv, ENV_DATOS };
