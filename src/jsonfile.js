'use strict';
/* jsonfile.js — leer/escribir JSON en disco de forma robusta (podcasts, historial). */
const fs = require('node:fs');
const path = require('node:path');

/* Devuelve `fallback` si el archivo no existe o está dañado. */
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

/* Escritura atómica (temporal + renombrar). Si el renombrado falla (Windows: antivirus/indexador,
 * EPERM) se escribe directo. Lanza si el disco no se puede escribir. */
function writeJson(file, data, mode, indent = 2) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  const text = JSON.stringify(data, null, indent || undefined);
  fs.writeFileSync(tmp, text, mode ? { mode } : undefined);
  try {
    fs.renameSync(tmp, file);
  } catch (_) {
    fs.writeFileSync(file, text, mode ? { mode } : undefined);
    try { fs.unlinkSync(tmp); } catch (__) { /* ya no está */ }
  }
}

module.exports = { readJson, writeJson };
