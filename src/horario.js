'use strict';
/* horario.js — qué debe sonar en el radio PRINCIPAL (pantallas / y /kiosco) según la hora. Nunca afecta a los oyentes del panel.
 *
 * Modos:
 *   rotacion       como siempre (sin límite de géneros)
 *   horario        bloques por días y franja; fuera de ellos, rotación normal
 *   musicoterapia  curva ISO 24/7: el mood sale de la hora dentro de la jornada (calma → foco → ánimo → foco → energía → bajar)
 *
 * La hora es la LOCAL del servidor (la del reloj corregido que se le pase). Todo lo de arriba son funciones puras. */
const path = require('node:path');
const { readJson, writeJson } = require('./jsonfile');

const MODOS = new Set(['rotacion', 'horario', 'musicoterapia']);
const MOODS = new Set(['calm', 'focus', 'uplift', 'energy', 'winddown']);
const MAX_BLOQUES = 20;
const MAX_GENEROS = 12;
const JORNADA = { inicio: 7, fin: 19 };
const LATINO = /latin|salsa|cumbia|bachata|reggaet|banda|ranchera|norte|mariachi|regional|grupera/;

/* 'HH:MM' → minutos del día (00:00–24:00), o null. */
function aMin(s) {
  const m = /^([01]\d|2[0-4]):([0-5]\d)$/.exec(typeof s === 'string' ? s : '');
  if (!m) return null;
  const v = Number(m[1]) * 60 + Number(m[2]);
  return v <= 1440 ? v : null;
}
const aHHMM = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

function validarJornada(j) {
  if (j === undefined) return { ...JORNADA };
  if (!j || !Number.isInteger(j.inicio) || !Number.isInteger(j.fin) || j.inicio < 0 || j.fin > 24 || j.inicio >= j.fin) return null;
  return { inicio: j.inicio, fin: j.fin };
}

function validarBloque(b, genreIds) {
  if (!b || typeof b !== 'object') return 'bloque inválido';
  if (!Array.isArray(b.dias) || !b.dias.length || !b.dias.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) return 'días inválidos (0 = domingo … 6 = sábado)';
  const desde = aMin(b.desde), hasta = aMin(b.hasta);
  if (desde === null || hasta === null || desde >= hasta) return 'franja inválida (HH:MM, "desde" antes que "hasta")';
  if (!Array.isArray(b.generos) || !b.generos.length || b.generos.length > MAX_GENEROS * 2) return `de 1 a ${MAX_GENEROS} géneros`;
  const generos = [...new Set(b.generos)];
  if (generos.length > MAX_GENEROS || !generos.every((g) => typeof g === 'string' && genreIds.has(g))) return 'género desconocido';
  if (b.mood !== undefined && !MOODS.has(b.mood)) return 'mood inválido';
  if (b.nombre !== undefined && (typeof b.nombre !== 'string' || b.nombre.length > 40)) return 'nombre de hasta 40 caracteres';
  return {
    dias: [...new Set(b.dias)].sort((x, y) => x - y), desde: b.desde, hasta: b.hasta, generos,
    ...(b.mood !== undefined ? { mood: b.mood } : {}), ...(b.nombre ? { nombre: b.nombre.trim() } : {})
  };
}

/* → { ok:true, horario } con SOLO los campos conocidos, o { ok:false, detalle }. */
function validar(h, genreIds) {
  if (!h || typeof h !== 'object' || Array.isArray(h)) return { ok: false, detalle: 'horario inválido' };
  if (!MODOS.has(h.modo)) return { ok: false, detalle: 'modo: rotacion, horario o musicoterapia' };
  const jornada = validarJornada(h.jornada);
  if (!jornada) return { ok: false, detalle: 'jornada inválida (horas 0–24, inicio antes que fin)' };
  const lista = h.bloques === undefined ? [] : h.bloques;
  if (!Array.isArray(lista) || lista.length > MAX_BLOQUES) return { ok: false, detalle: `hasta ${MAX_BLOQUES} bloques` };
  const bloques = [];
  for (let i = 0; i < lista.length; i++) {
    const b = validarBloque(lista[i], genreIds);
    if (typeof b === 'string') return { ok: false, detalle: `bloque ${i + 1}: ${b}` };
    bloques.push(b);
  }
  return { ok: true, horario: { modo: h.modo, jornada, bloques } };
}

const minutosDe = (ms) => { const d = new Date(ms); return { dia: d.getDay(), min: d.getHours() * 60 + d.getMinutes() }; };

/* El primer bloque que cubre ese momento (desde incluido, hasta excluido), o null. */
function bloqueActivo(ms, h) {
  const { dia, min } = minutosDe(ms);
  for (const b of (h && h.bloques) || []) if (b.dias.includes(dia) && min >= aMin(b.desde) && min < aMin(b.hasta)) return b;
  return null;
}

/* Curva de la jornada (fracción del día laboral): el mismo orden que usa el generador de semana. */
const CURVA = [[0.1, 'calm'], [0.4, 'focus'], [0.5, 'uplift'], [0.6, 'focus'], [0.85, 'energy'], [1, 'winddown']];
function moodMusicoterapia(ms, jornada = JORNADA) {
  const { min } = minutosDe(ms);
  const f = (min - jornada.inicio * 60) / ((jornada.fin - jornada.inicio) * 60);
  if (f < 0 || f >= 1) return 'calm';
  return CURVA.find(([hasta]) => f < hasta)[1];
}

/* Géneros de un mood: primero los destacados (los de la rotación de siempre), luego el resto. */
function generosDeMood(genres, mood, n = 8) {
  const del = genres.filter((g) => g.mood === mood);
  return [...del.filter((g) => g.featured), ...del.filter((g) => !g.featured)].slice(0, n).map((g) => g.id);
}

/* Qué limita la rotación ahora: { modo, bloque, mood, generos } (generos vacío = rotación normal). */
function seleccion(ms, h, genres) {
  const modo = h && MODOS.has(h.modo) ? h.modo : 'rotacion';
  if (modo === 'horario') {
    const b = bloqueActivo(ms, h);
    return { modo, bloque: b, mood: b ? b.mood || null : null, generos: b ? [...b.generos] : [] };
  }
  if (modo === 'musicoterapia') {
    const mood = moodMusicoterapia(ms, h.jornada || JORNADA);
    return { modo, bloque: null, mood, generos: generosDeMood(genres, mood) };
  }
  return { modo, bloque: null, mood: null, generos: [] };
}

/* Propuesta de semana (lunes a viernes) a partir de la curva; se devuelve para EDITAR antes de guardar. Máx. 8 bloques. */
const NOMBRES = { calm: 'Inicio tranquilo', focus: 'Concentración', uplift: 'Ánimo (comida)', energy: 'Energía de la tarde', winddown: 'Cierre' };
function generarSemana({ jornada = JORNADA, genres, rng = Math.random, porBloque = 3 } = {}) {
  const j = validarJornada(jornada) || { ...JORNADA };
  const total = (j.fin - j.inicio) * 60;
  const usados = new Set();
  const bloques = [];
  let desde = j.inicio * 60;
  CURVA.forEach(([hasta, mood], i) => {
    const fin = i === CURVA.length - 1 ? j.fin * 60 : j.inicio * 60 + Math.round((total * hasta) / 15) * 15;
    if (fin <= desde) return;
    let pool = genres.filter((g) => g.mood === mood && !usados.has(g.id));
    const dest = pool.filter((g) => g.featured);
    if (dest.length >= porBloque) pool = dest;
    const elegidos = [];
    if (mood === 'uplift') { /* al mediodía, al menos un género latino */
      const lat = pool.filter((g) => LATINO.test(g.id));
      if (lat.length) elegidos.push(lat[Math.floor(rng() * lat.length)]);
    }
    while (elegidos.length < porBloque && elegidos.length < pool.length) {
      const g = pool[Math.floor(rng() * pool.length)];
      if (!elegidos.includes(g)) elegidos.push(g);
    }
    elegidos.forEach((g) => usados.add(g.id));
    if (elegidos.length) bloques.push({ dias: [1, 2, 3, 4, 5], desde: aHHMM(desde), hasta: aHHMM(fin), generos: elegidos.map((g) => g.id), mood, nombre: NOMBRES[mood] });
    desde = fin;
  });
  return bloques.slice(0, 8);
}

/* El horario guardado (DATA_DIR/horario.json). Un archivo dañado o con géneros que ya no existen vuelve a la rotación. */
function createPrograma({ dir, genres, clock = Date.now }) {
  const file = path.join(dir, 'horario.json');
  const ids = new Set(genres.map((g) => g.id));
  const porDefecto = () => ({ modo: 'rotacion', jornada: { ...JORNADA }, bloques: [] });
  const leido = validar(readJson(file, null), ids);
  let actual = leido.ok ? leido.horario : porDefecto();

  return {
    get: () => JSON.parse(JSON.stringify(actual)),
    set(h) {
      const r = validar(h, ids);
      if (!r.ok) return r;
      writeJson(file, r.horario);
      actual = r.horario;
      return { ok: true, horario: JSON.parse(JSON.stringify(actual)) };
    },
    seleccion: (ms = clock()) => seleccion(ms, actual, genres),
    generar: (jornada, rng) => generarSemana({ jornada: jornada || actual.jornada, genres, rng })
  };
}

module.exports = { aMin, validar, bloqueActivo, moodMusicoterapia, seleccion, generarSemana, generosDeMood, createPrograma, MOODS };
