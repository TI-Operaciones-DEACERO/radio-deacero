/* logica.js — lógica pura del panel completo (sin DOM ni red): se prueba con node:test (test/panel-*.test.js).
   Me gusta, fusión de lo local, cola, fases de Bienestar, ánimos más usados, teclado de pestañas. */
(function (root) {
  'use strict';

  const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
  const SID = /^[A-Za-z0-9_-]{8,40}$/;
  const GENRE_ID = /^[A-Za-z0-9_-]{1,40}$/;
  const MAX_LIKES = 2000, MAX_MERGE = 500, MAX_QUEUE = 200;

  /* — canciones — */
  /* Solo los campos conocidos de una canción; null si no es una canción válida (mismo criterio que el servidor). */
  function cleanTrack(x) {
    if (!x || typeof x !== 'object' || Array.isArray(x) || typeof x.id !== 'string' || !VIDEO_ID.test(x.id)) return null;
    const t = {
      id: x.id,
      title: typeof x.title === 'string' ? x.title.slice(0, 300) : '',
      channel: typeof x.channel === 'string' ? x.channel.slice(0, 200) : '',
      duration: Number.isFinite(x.duration) ? Math.min(1e5, Math.max(0, x.duration)) : 0
    };
    if (typeof x.genre === 'string' && GENRE_ID.test(x.genre)) t.genre = x.genre;
    return t;
  }

  /* La canción que suena + el id de su género, listos para guardar. */
  function trackConGenero(state) {
    if (!state || !state.track) return null;
    const t = cleanTrack(Object.assign({}, state.track, { genre: state.genre && state.genre.id }));
    return t && t.title ? t : null;
  }

  /* — Me gusta (mapa id → { r, at, track }) —
     Los mapas por id de canción NO tienen prototipo (Object.create(null)): el id "constructor" mide 11 caracteres, pasa la validación
     de id y con un {} normal chocaría con Object.prototype. — */
  const mapa = (...fuentes) => Object.assign(Object.create(null), ...fuentes);
  const tiene = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
  /* Alternar: pulsar la misma reacción otra vez la quita. */
  const nextReaction = (actual, pulsada) => (actual === pulsada ? null : pulsada);

  /* Devuelve un mapa NUEVO (no toca el original): sirve para la UI optimista y para revertir si el servidor falla. */
  function setReaction(map, track, r, at) {
    const out = mapa(map);
    const t = cleanTrack(track);
    if (!t) return out;
    delete out[t.id];
    if (r === 'like' || r === 'dislike') {
      out[t.id] = { r, at: Number.isFinite(at) ? at : Date.now(), track: t };
      const ids = Object.keys(out);
      if (ids.length > MAX_LIKES) {
        ids.sort((a, b) => out[a].at - out[b].at).slice(0, ids.length - MAX_LIKES).forEach((id) => { delete out[id]; });
      }
    }
    return out;
  }
  /* Deshace un cambio optimista: devuelve la entrada anterior de esa canción (o la quita si no había). */
  function restoreEntry(map, id, entry) {
    const out = mapa(map);
    if (entry) out[id] = entry; else delete out[id];
    return out;
  }
  const reactionOf =(map, id) => (tiene(map, id) ? map[id].r : null);

  /* Lista (más reciente primero) de las reacciones de un tipo. */
  function listByReaction(map, r) {
    return Object.keys(map || {}).map((id, i) => [map[id], i]).filter(([x]) => x.r === r)
      .sort((a, b) => b[0].at - a[0].at || b[1] - a[1]).map(([x]) => x);
  }

  /* Lo que responde GET /api/me/reactions ([{ r, at, track }]) → mapa. */
  function fromServerList(list) {
    const map = mapa();
    if (!Array.isArray(list)) return map;
    for (const x of list) {
      const t = x && cleanTrack(x.track);
      if (t && (x.r === 'like' || x.r === 'dislike')) map[t.id] = { r: x.r, at: Number.isFinite(x.at) ? x.at : 0, track: t };
    }
    return map;
  }

  /* Texto guardado en localStorage ('pl_likes') → mapa; tolera basura. */
  function parseLocalLikes(raw) {
    try {
      const v = JSON.parse(raw || 'null');
      return fromServerList(Array.isArray(v) ? v : []);
    } catch (_) { return {}; }
  }
  const serializeLikes = (map) => JSON.stringify(Object.keys(map || {}).map((id) => map[id]));

  /* Cuerpo de POST /api/me/reactions/merge: lo local, lo más reciente primero, con tope. */
  function toMergeItems(map) {
    return Object.keys(map || {}).map((id) => map[id]).sort((a, b) => b.at - a.at).slice(0, MAX_MERGE).map((x) => ({ track: x.track, r: x.r }));
  }

  /* Al entrar: lo que había en el navegador se suma a lo de la cuenta; si una canción ya está en la cuenta, manda la cuenta. */
  function mergeLocalWithAccount(local, account) {
    return mapa(local, account);
  }

  /* ¿Se registra en el historial? Una sola vez por canción que empieza a sonar (y no si ya es la última registrada). */
  const shouldLogHistory = (lastId, track) => !!(track && VIDEO_ID.test(track.id || '') && track.id !== lastId);

  /* — colas — */
  /* Desde una lista de canciones: empieza en la elegida y toma hasta MAX_QUEUE; el motor las reproduce en orden. */
  function queueFromTracks(tracks, startId) {
    const list = (Array.isArray(tracks) ? tracks : []).map(cleanTrack).filter((t) => t && t.title);
    let i = startId ? list.findIndex((t) => t.id === startId) : 0;
    if (i < 0) i = 0;
    return { cmd: 'queue', items: list.slice(i, i + MAX_QUEUE).map((track) => ({ track })) };
  }
  /* Desde las consultas de "Playlist IA": cada una se resuelve con la búsqueda del motor. */
  function queueFromQueries(consultas) {
    const items = [];
    for (const c of Array.isArray(consultas) ? consultas : []) {
      const q = typeof c === 'string' ? c : c && c.query;
      if (typeof q === 'string' && q.trim()) items.push({ q: q.trim().slice(0, 100) });
      if (items.length >= MAX_QUEUE) break;
    }
    return { cmd: 'queue', items };
  }

  /* — Bienestar — */
  const clampPct = (e) => Math.round(Math.min(1, Math.max(0, Number(e) || 0)) * 100);
  const energiaTexto = (e) => clampPct(e) + ' %';
  const energiaAncho = (e) => clampPct(e) + '%';

  /* Dónde va el viaje: la fase y el tema actuales según getState().viaje, y si ya terminó (la música continúa). */
  function estadoViaje(plan, viaje) {
    const fases = plan && Array.isArray(plan.fases) ? plan.fases : [];
    if (!fases.length) return null;
    if (!viaje) return { activo: false, faseIdx: -1, total: fases.length, tema: 0, porFase: plan.temasPorFase || 0, terminado: false, nombre: '', energia: null };
    const idx = Math.min(fases.length - 1, Math.max(0, (Number(viaje.fase) || 1) - 1));
    const f = fases[idx];
    return {
      activo: true, faseIdx: idx, total: fases.length,
      tema: viaje.continuando ? 0 : Number(viaje.tema) || 0,
      porFase: Number(viaje.porFase) || plan.temasPorFase || 0,
      terminado: !!viaje.continuando,
      nombre: viaje.nombre || f.nombre || '',
      energia: Number.isFinite(viaje.energia) ? viaje.energia : f.energia
    };
  }
  function resumenFase(ev) {
    if (!ev || !ev.activo) return '';
    if (ev.terminado) return 'Viaje completo: la música continúa en esta energía';
    return 'Fase ' + (ev.faseIdx + 1) + ' de ' + ev.total + ' · ' + ev.nombre + ' · Canción ' + ev.tema + ' de ' + ev.porFase;
  }
  const canciones = (n) => n + (n === 1 ? ' canción' : ' canciones');
  /* Cuánto falta: cada fase dura porFase canciones y avanza sola (no hay que hacer nada más que escuchar). */
  function avanceFase(ev) {
    if (!ev || !ev.activo || ev.terminado || !(ev.porFase > 0)) return '';
    const resta = Math.max(0, ev.porFase - ev.tema);
    const meta = ev.faseIdx + 1 >= ev.total ? 'llegar a tu destino' : 'pasar a la fase ' + (ev.faseIdx + 2);
    if (resta === 0) return 'Al terminar esta canción ' + (ev.faseIdx + 1 >= ev.total ? 'llegas a tu destino' : 'pasas a la fase ' + (ev.faseIdx + 2));
    return (resta === 1 ? 'Falta ' : 'Faltan ') + canciones(resta) + ' para ' + meta;
  }
  /* Etiqueta de la fase i en la lista: Lista / Canción t de n / cuántas canciones dura. */
  function estadoFase(ev, i, porFase) {
    const hecha = ev && ev.activo && (ev.terminado || i < ev.faseIdx);
    if (hecha) return 'Lista';
    if (ev && ev.activo && i === ev.faseIdx) return 'Canción ' + ev.tema + ' de ' + ev.porFase;
    return porFase > 0 ? canciones(porFase) : 'Pendiente';
  }

  /* Cuerpo de POST /api/bienestar/viaje: solo lo que tiene valor. Si hay ánimo elegido va `estado`; si no, el texto libre. */
  function armarPeticionViaje(sel) {
    const s = sel || {};
    const out = {};
    const estado = typeof s.estado === 'string' ? s.estado.trim() : '';
    const texto = typeof s.texto === 'string' ? s.texto.trim().slice(0, 300) : '';
    if (estado) out.estado = estado; else if (texto) out.texto = texto;
    for (const k of ['destino', 'intensidad', 'duracion', 'estilo', 'idioma']) {
      if (typeof s[k] === 'string' && s[k].trim()) out[k] = s[k].trim();
    }
    return out;
  }
  const peticionValida = (req) => !!(req && (req.estado || req.texto));

  /* Los n ánimos más usados (por conteo; empata el orden de las valores por omisión). Se completa con los de siempre. */
  function topAnimos(usos, porOmision, validos, n) {
    n = n || 6;
    const ok = new Set(validos || []);
    const conteo = usos && typeof usos === 'object' ? usos : {};
    const cuenta = (id) => (tiene(conteo, id) ? conteo[id] : 0);
    const usados = Object.keys(conteo).filter((id) => ok.has(id) && cuenta(id) > 0)
      .sort((a, b) => cuenta(b) - cuenta(a) || (porOmision.indexOf(a) + 1 || 99) - (porOmision.indexOf(b) + 1 || 99));
    const out = usados.slice(0, n);
    for (const id of porOmision) { if (out.length >= n) break; if (ok.has(id) && !out.includes(id)) out.push(id); }
    return out;
  }
  const sumarUso = (usos, id) => { const o = mapa(usos); o[id] = (tiene(o, id) ? o[id] : 0) + 1; return o; };

  /* — IA — */
  const fuenteTexto = (fuente) => (fuente === 'gemini' ? 'Sugerido por IA' : '') /* lo local no se anuncia: era ruido técnico */;

  /* — pestañas con flechas (patrón WAI-ARIA, pestañas en horizontal): → siguiente, ← anterior, Inicio, Fin; da vuelta en los extremos — */
  function nextTabIndex(key, i, n) {
    if (!(n > 0)) return -1;
    if (key === 'ArrowRight') return (i + 1) % n;
    if (key === 'ArrowLeft') return (i - 1 + n) % n;
    if (key === 'Home') return 0;
    if (key === 'End') return n - 1;
    return -1;
  }

  /* — atajos de teclado del panel — ev = { key, tag, editable, role, ctrl, alt, meta, shift } (lo arma nucleo.js desde el KeyboardEvent).
     Nunca dentro de campos de texto ni con Ctrl/Alt/Meta (son del navegador o del lector de pantalla). El espacio no se roba
     a botones, enlaces, pestañas ni <summary>, que lo usan para activarse. → 'toggle' | 'next' | 'letras' | 'karaoke' | 'buscar'
     | 'ayuda' | 'pestana:N' | null */
  const CAMPOS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
  const ACTIVABLES = new Set(['BUTTON', 'A', 'SUMMARY']);
  const ROLES_ACTIVABLES = new Set(['button', 'tab', 'link', 'checkbox', 'radio', 'switch', 'menuitem', 'option']);
  function atajoDeTecla(ev) {
    if (!ev || typeof ev.key !== 'string' || ev.ctrl || ev.alt || ev.meta) return null;
    const tag = String(ev.tag || '').toUpperCase();
    if (CAMPOS.has(tag) || ev.editable) return null;
    const k = ev.key;
    if (k === '?') return 'ayuda';
    if (k === ' ' || k === 'Spacebar') return ACTIVABLES.has(tag) || ROLES_ACTIVABLES.has(ev.role) ? null : 'toggle';
    if (k === '/') return 'buscar';
    if (/^[1-9]$/.test(k)) return 'pestana:' + k;
    switch (k.toLowerCase()) {
      case 'n': return 'next';
      case 'l': return 'letras';
      case 'k': return 'karaoke';
      default: return null;
    }
  }

  /* Mensaje amable según el estado HTTP (0 = sin conexión). */
  function mensajeError(status) {
    if (status === 0) return 'No hay conexión con el servidor. Revisa tu red e inténtalo de nuevo.';
    if (status === 401) return 'Entra con tu nómina para usar esta función.';
    if (status === 429) return 'Demasiadas peticiones seguidas. Espera un momento e inténtalo de nuevo.';
    return 'Algo no salió bien. Inténtalo de nuevo en un momento.';
  }

  /* — sesión del oyente — */
  const validSid = (s) => typeof s === 'string' && SID.test(s);
  function makeSid(bytes) { return Array.from(bytes, (x) => (x & 255).toString(16).padStart(2, '0')).join(''); }

  const api = {
    cleanTrack, trackConGenero, nextReaction, setReaction, restoreEntry, reactionOf, listByReaction, fromServerList, parseLocalLikes, serializeLikes,
    toMergeItems, mergeLocalWithAccount, shouldLogHistory, queueFromTracks, queueFromQueries,
    energiaTexto, energiaAncho, estadoViaje, resumenFase, avanceFase, estadoFase, armarPeticionViaje, peticionValida, topAnimos, sumarUso,
    fuenteTexto, nextTabIndex, atajoDeTecla, mensajeError, validSid, makeSid
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PanelLogica = api;
})(typeof window !== 'undefined' ? window : globalThis);
