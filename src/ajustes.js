'use strict';
/* ajustes.js — ajustes de administración (DATA_DIR/ajustes.json). Hoy: filtro de contenido explícito.
 * yt-dlp no tiene el "safeSearch" de la API oficial: se filtra por PALABRAS COMPLETAS del título. No es infalible. */
const path = require('node:path');
const { readJson, writeJson } = require('./jsonfile');

/* Lista base (se suma a las palabras que ponga el administrador). */
const BASE = ['explicit', 'explícito', 'explicito', 'uncensored', 'sin censura', 'nsfw', '+18', 'parental advisory'];
const MAX_PALABRAS = 200;

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function validar(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b) || typeof b.filtroExplicito !== 'boolean') return { ok: false, detalle: 'filtroExplicito (sí/no) es obligatorio' };
  const lista = b.palabras === undefined ? [] : b.palabras;
  if (!Array.isArray(lista) || lista.length > MAX_PALABRAS) return { ok: false, detalle: `hasta ${MAX_PALABRAS} palabras` };
  const palabras = [];
  for (const p of lista) {
    if (typeof p !== 'string' || p.trim().length > 40) return { ok: false, detalle: 'cada palabra: texto de hasta 40 caracteres' };
    const t = p.trim();
    if (t && !palabras.includes(t)) palabras.push(t);
  }
  return { ok: true, ajustes: { filtroExplicito: b.filtroExplicito, palabras } };
}

function createAjustes({ dir }) {
  const file = path.join(dir, 'ajustes.json');
  const leido = validar(readJson(file, null));
  let actual = leido.ok ? leido.ajustes : { filtroExplicito: false, palabras: [] };
  let re = null;

  /* Palabra completa: "explicit" no atrapa "explicitamente". Los bordes son cualquier cosa que no sea letra o número. */
  function compilar() {
    const todas = [...BASE, ...actual.palabras].map(fold).filter(Boolean);
    re = new RegExp('(^|[^a-z0-9])(' + todas.map(escapar).join('|') + ')(?=$|[^a-z0-9])');
  }
  compilar();

  return {
    get: () => ({ filtroExplicito: actual.filtroExplicito, palabras: [...actual.palabras] }),
    set(b) {
      const r = validar(b);
      if (!r.ok) return r;
      writeJson(file, r.ajustes);
      actual = r.ajustes;
      compilar();
      return { ok: true, ajustes: { ...actual, palabras: [...actual.palabras] } };
    },
    /* ¿Se puede ofrecer esta pista? (con el filtro apagado, todo) */
    permite: (track) => !actual.filtroExplicito || !re.test(fold(track && track.title))
  };
}

module.exports = { createAjustes, BASE };
