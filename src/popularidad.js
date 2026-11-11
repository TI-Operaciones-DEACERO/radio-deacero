'use strict';
/* popularidad.js — «lo más escuchado» de la planta: conteos AGREGADOS por artista y género de lo que el radio ha servido en los
 * últimos días. No guarda quién lo oyó ni desde dónde (ni sesión, ni cuenta, ni IP): solo "artista X: N veces".
 * Un artista solo sale en la lista si llegó a `minimo` reproducciones (no se expone lo que oyó una sola persona una sola vez). */
const path = require('node:path');
const { readJson, writeJson } = require('./jsonfile');

const DIA_MS = 24 * 3600 * 1000;
const GENRE_ID = /^[A-Za-z0-9_-]{1,40}$/;
const INTERNOS = new Set(['search', 'podcast', 'lista']); /* «géneros» del motor: no son música de un género */

/* El canal de YouTube trae adornos: «Cuco - Topic», «BadBunnyVEVO», «Grupo Frontera Official». */
function limpiarCanal(x) {
  if (typeof x !== 'string') return '';
  return x.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s*-\s*Topic\s*$/i, '')
    .replace(/\s*VEVO\s*$/i, '')
    .replace(/\s+(Official|Oficial)(\s+(Channel|Canal))?\s*$/i, '')
    .replace(/\s+/g, ' ').trim().slice(0, 80);
}

const diaDe = (t) => new Date(t).toISOString().slice(0, 10);

function createPopularidad({ dir, now = Date.now, dias = 14, minimo = 3, maxPorDia = 300, guardarCadaMs = 30 * 1000 } = {}) {
  const file = dir ? path.join(dir, 'popularidad.json') : null;
  const raw = file ? readJson(file, {}) : {};
  const porDia = new Map(); /* 'AAAA-MM-DD' → { a: {artista: n}, g: {género: n} } */
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [d, v] of Object.entries(raw)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !v || typeof v !== 'object') continue;
      const num = (o) => Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {}).filter(([k, n]) => k && Number.isInteger(n) && n > 0).slice(0, maxPorDia));
      porDia.set(d, { a: Object.assign(Object.create(null), num(v.a)), g: Object.assign(Object.create(null), num(v.g)) });
    }
  }
  let ultimoGuardado = 0, sucio = false;

  function podar() {
    const desde = diaDe(now() - dias * DIA_MS);
    for (const d of porDia.keys()) if (d < desde) { porDia.delete(d); sucio = true; }
  }

  function guardar() {
    if (!file || !sucio) return;
    try { writeJson(file, Object.fromEntries(porDia), 0o600, 0); sucio = false; } catch (_) { /* sigue en memoria mientras el disco falle */ }
    ultimoGuardado = Date.now();
  }

  function registrar(x) {
    if (!x || typeof x !== 'object') return;
    const nombre = limpiarCanal(x.channel);
    if (!nombre) return;
    podar();
    const d = diaDe(now());
    let dia = porDia.get(d);
    if (!dia) { dia = { a: Object.create(null), g: Object.create(null) }; porDia.set(d, dia); }
    const k = nombre;
    if (dia.a[k] || Object.keys(dia.a).length < maxPorDia) dia.a[k] = (dia.a[k] || 0) + 1;
    const g = typeof x.genre === 'string' && GENRE_ID.test(x.genre) && !INTERNOS.has(x.genre) ? x.genre : '';
    if (g) dia.g[g] = (dia.g[g] || 0) + 1;
    sucio = true;
    if (Date.now() - ultimoGuardado >= guardarCadaMs) guardar();
  }

  function top({ n = 12 } = {}) {
    podar();
    const sumar = (campo) => {
      const m = new Map();
      for (const dia of porDia.values()) for (const [k, v] of Object.entries(dia[campo])) m.set(k, (m.get(k) || 0) + v);
      return m;
    };
    const orden = (m) => [...m].filter(([, v]) => v >= minimo).sort((p, q) => q[1] - p[1] || (p[0] < q[0] ? -1 : 1)).slice(0, n);
    return { artistas: orden(sumar('a')).map(([name, c]) => ({ name, n: c })), generos: orden(sumar('g')).map(([id, c]) => ({ id, n: c })) };
  }

  return { registrar, top, guardar };
}

module.exports = { createPopularidad, limpiarCanal };
