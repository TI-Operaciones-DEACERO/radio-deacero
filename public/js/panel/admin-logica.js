/* admin-logica.js — lógica pura de la pestaña Administración (sin DOM ni red): validación del editor de horario y de anuncios,
   ajustes y formatos. Se prueba con node:test (test/panel-admin.test.js). En el navegador: window.AdminLogica.
   El servidor vuelve a validar todo: esto solo sirve para avisar ANTES de guardar y decir qué corregir. */
(function (root) {
  'use strict';

  const MODOS = ['rotacion', 'horario', 'musicoterapia'];
  const MOODS = ['calm', 'focus', 'uplift', 'energy', 'winddown'];
  const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const MAX_BLOQUES = 20, MAX_GENEROS = 12, MAX_NOMBRE = 60, MAX_NOMBRE_BLOQUE = 40, MAX_MP3 = 5 * 1024 * 1024; /* mismos topes que src/horario.js y src/anuncios.js */

  /* 'HH:MM' de 00:00 a 23:59; con `fin` también '24:00' (hasta el final del día). */
  function hhmm(s, fin) {
    if (typeof s !== 'string' || !/^\d{2}:\d{2}$/.test(s)) return false;
    if (fin && s === '24:00') return true;
    const [h, m] = s.split(':').map(Number);
    return h <= 23 && m <= 59;
  }
  const aMinutos = (s) => (hhmm(s, true) ? Number(s.slice(0, 2)) * 60 + Number(s.slice(3)) : -1);
  const diasValidos = (d) => Array.isArray(d) && d.length > 0 && d.every((x) => Number.isInteger(x) && x >= 0 && x <= 6);

  function erroresBloque(b, ids) {
    const e = [];
    if (!b || typeof b !== 'object') return ['El bloque está vacío.'];
    if (!diasValidos(b.dias)) e.push('Elige al menos un día.');
    const okDesde = hhmm(b.desde), okHasta = hhmm(b.hasta, true);
    if (!okDesde) e.push('La hora «desde» no es válida.');
    if (!okHasta) e.push('La hora «hasta» no es válida.');
    if (okDesde && okHasta && aMinutos(b.desde) >= aMinutos(b.hasta)) e.push('La hora «desde» debe ser antes de «hasta».');
    const g = Array.isArray(b.generos) ? b.generos : [];
    if (!g.length) e.push('Elige al menos un género.');
    else if (g.length > MAX_GENEROS) e.push('Máximo ' + MAX_GENEROS + ' géneros por bloque.');
    else if (ids && g.some((x) => !ids.has(x))) e.push('Hay un género que ya no existe; quítalo.');
    if (b.mood !== undefined && b.mood !== '' && !MOODS.includes(b.mood)) e.push('El ánimo elegido no es válido.');
    if (b.nombre !== undefined && (typeof b.nombre !== 'string' || b.nombre.trim().length > MAX_NOMBRE_BLOQUE)) e.push('El nombre del bloque admite hasta ' + MAX_NOMBRE_BLOQUE + ' caracteres.');
    return e;
  }

  /* → { ok, errores: [{ bloque: índice | -1 (general), msg }] } · idsGeneros: lista de ids válidos (o null para no comprobarlos). */
  function validarHorario(h, idsGeneros) {
    const errores = [];
    const gen = (msg) => errores.push({ bloque: -1, msg });
    if (!h || typeof h !== 'object') { gen('El horario está vacío.'); return { ok: false, errores }; }
    if (!MODOS.includes(h.modo)) gen('Elige un modo: rotación, horario o musicoterapia.');
    const j = h.jornada;
    if (!j || !Number.isInteger(j.inicio) || !Number.isInteger(j.fin) || j.inicio < 0 || j.fin > 24 || j.inicio >= j.fin) gen('La jornada va de 0 a 24 h en horas enteras y el inicio debe ser antes del fin.');
    const bloques = Array.isArray(h.bloques) ? h.bloques : [];
    if (bloques.length > MAX_BLOQUES) gen('Máximo ' + MAX_BLOQUES + ' bloques.');
    if (h.modo === 'horario' && !bloques.length) gen('En modo horario agrega al menos un bloque.');
    const ids = Array.isArray(idsGeneros) ? new Set(idsGeneros) : null;
    bloques.forEach((b, i) => { for (const msg of erroresBloque(b, ids)) errores.push({ bloque: i, msg }); });
    return { ok: errores.length === 0, errores };
  }

  /* Solo lo del contrato: días enteros ordenados sin repetir, géneros sin repetir, sin `mood`/`nombre` vacíos. */
  function limpiarHorario(h) {
    const x = h || {};
    const j = x.jornada || {};
    return {
      modo: x.modo,
      jornada: { inicio: Number(j.inicio), fin: Number(j.fin) },
      bloques: (Array.isArray(x.bloques) ? x.bloques : []).map((b) => {
        const out = {
          dias: Array.from(new Set((Array.isArray(b.dias) ? b.dias : []).map(Number))).filter((d) => Number.isInteger(d)).sort((a, c) => a - c),
          desde: b.desde, hasta: b.hasta,
          generos: Array.from(new Set(Array.isArray(b.generos) ? b.generos : []))
        };
        if (typeof b.mood === 'string' && b.mood) out.mood = b.mood;
        if (typeof b.nombre === 'string' && b.nombre.trim()) out.nombre = b.nombre.trim();
        return out;
      })
    };
  }

  /* Búsqueda de géneros sin acentos ni mayúsculas (en nombre e id), sin los ya elegidos, con tope. */
  const plano = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  function filtrarGeneros(generos, q, excluidos, max) {
    if (!Array.isArray(generos)) return [];
    const fuera = new Set(excluidos || []);
    const t = plano(q).trim();
    const out = [];
    for (const g of generos) {
      if (!g || fuera.has(g.id)) continue;
      if (t && !plano(g.label).includes(t) && !plano(g.id).includes(t)) continue;
      out.push(g);
      if (out.length >= (max || 8)) break;
    }
    return out;
  }

  /* — anuncios — a = { nombre, dias, desde, hasta, cadaMin } · archivo = { bytes, tipo, archivo } al crear (null/undefined al editar). */
  function validarAnuncio(a, archivo) {
    const e = [];
    const x = a || {};
    if (typeof x.nombre !== 'string' || !x.nombre.trim()) e.push('Escribe un nombre para el anuncio.');
    else if (x.nombre.trim().length > MAX_NOMBRE) e.push('El nombre admite hasta ' + MAX_NOMBRE + ' caracteres.');
    if (!diasValidos(x.dias)) e.push('Elige al menos un día.');
    if (!hhmm(x.desde) || !hhmm(x.hasta, true)) e.push('Revisa las horas «desde» y «hasta».');
    else if (aMinutos(x.desde) >= aMinutos(x.hasta)) e.push('La hora «desde» debe ser antes de «hasta» (también si suena una sola vez).');
    const c = x.cadaMin;
    if (!Number.isInteger(c) || (c !== 0 && (c < 15 || c > 720))) e.push('El intervalo es 0 (una sola vez) o de 15 a 720 minutos.');
    if (archivo) {
      const nombre = typeof archivo.archivo === 'string' ? archivo.archivo : '';
      if (!nombre) e.push('Elige un archivo mp3.');
      else {
        const esMp3 = archivo.tipo === 'audio/mpeg' || archivo.tipo === 'audio/mp3' || (!archivo.tipo && /\.mp3$/i.test(nombre));
        if (!esMp3) e.push('El archivo debe ser mp3.');
        if (!(archivo.bytes > 0)) e.push('El archivo está vacío.');
        else if (archivo.bytes > MAX_MP3) e.push('El archivo pesa más de 5 MB.');
      }
    }
    return e;
  }
  /* 'data:audio/mpeg;base64,XXXX' (FileReader.readAsDataURL) → 'XXXX' */
  function base64DeDataUrl(s) {
    if (typeof s !== 'string') return '';
    const i = s.indexOf(';base64,');
    return s.startsWith('data:') && i >= 0 ? s.slice(i + 8) : '';
  }

  function textoDias(dias) {
    const d = Array.from(new Set(Array.isArray(dias) ? dias : [])).filter((x) => Number.isInteger(x) && x >= 0 && x <= 6).sort((a, b) => a - b);
    if (!d.length) return '';
    if (d.length === 7) return 'Todos los días';
    const seguidos = d.length >= 3 && d.every((x, i) => i === 0 || x === d[i - 1] + 1);
    return seguidos ? DIAS[d[0]] + ' a ' + DIAS[d[d.length - 1]] : d.map((x) => DIAS[x]).join(', ');
  }
  function textoProgramacion(a) {
    const dias = textoDias(a && a.dias);
    if (!dias) return 'Sin días';
    if (!a.cadaMin) return dias + ' · una vez a las ' + a.desde;
    return dias + ' · ' + a.desde + '–' + a.hasta + ' · cada ' + a.cadaMin + ' min';
  }

  /* — ajustes: palabras del filtro explícito — */
  function palabrasDeTexto(txt) {
    if (typeof txt !== 'string') return [];
    const out = [];
    for (const p of txt.split(/[\n,]/)) {
      const w = p.trim().toLowerCase().slice(0, 40);
      if (w && !out.includes(w)) out.push(w);
      if (out.length >= 200) break;
    }
    return out;
  }

  /* — formatos — */
  function fmtBytes(n) {
    if (!Number.isFinite(n) || n < 0) return '—';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }
  /* uptime en segundos → '2 h 5 min' */
  function fmtUptime(s) {
    if (!Number.isFinite(s) || s < 0) return '—';
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    if (d) return d + ' d ' + h + ' h';
    if (h) return h + ' h ' + m + ' min';
    if (m) return m + ' min';
    return Math.floor(s) + ' s';
  }
  function resumenDiagnostico(d) {
    const sv = d && Array.isArray(d.servicios) ? d.servicios : [];
    let errores = 0, avisos = 0;
    const conProblemas = [];
    for (const s of sv) {
      const e = Number(s.errores1h) || 0, a = Number(s.avisos1h) || 0;
      errores += e; avisos += a;
      if (e > 0) conProblemas.push(s.servicio);
    }
    return { errores, avisos, conProblemas };
  }

  const api = {
    MODOS, MOODS, DIAS, MAX_BLOQUES, MAX_GENEROS, MAX_MP3,
    hhmm, aMinutos, validarHorario, limpiarHorario, filtrarGeneros,
    validarAnuncio, base64DeDataUrl, textoDias, textoProgramacion, palabrasDeTexto,
    fmtBytes, fmtUptime, resumenDiagnostico
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AdminLogica = api;
})(typeof window !== 'undefined' ? window : globalThis);
