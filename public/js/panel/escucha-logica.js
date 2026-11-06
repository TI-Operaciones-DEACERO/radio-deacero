/* escucha-logica.js — lógica pura de la Fase 5 del panel completo (sin DOM, sin red, sin WebAudio): búsqueda, letras,
   visualizador sintético y Naturaleza. Se prueba con node:test (test/panel-escucha.test.js). En el navegador: window.EscuchaLogica. */
(function (root) {
  'use strict';

  const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
  const tiene = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
  const acotar = (x, a, b) => Math.min(b, Math.max(a, x));

  /* ───────────── búsqueda (GET /api/buscar?q=) ───────────── */
  /* La consulta que se manda: recortada, sin espacios repetidos, de 2 a 100 caracteres ('' = no se busca). */
  function consultaBusqueda(q) {
    if (typeof q !== 'string') return '';
    const s = q.replace(/\s+/g, ' ').trim().slice(0, 100);
    return s.length >= 2 ? s : '';
  }
  /* Resultados del servidor → canciones con solo los campos conocidos (máx. 10). */
  function limpiarResultados(data) {
    if (!Array.isArray(data)) return [];
    const out = [];
    for (const x of data) {
      if (!x || typeof x !== 'object' || typeof x.id !== 'string' || !VIDEO_ID.test(x.id)) continue;
      const title = typeof x.title === 'string' ? x.title.trim().slice(0, 300) : '';
      if (!title) continue;
      out.push({ id: x.id, title, channel: typeof x.channel === 'string' ? x.channel.slice(0, 200) : '', duration: Number.isFinite(x.duration) ? acotar(x.duration, 0, 1e5) : 0 });
      if (out.length >= 10) break;
    }
    return out;
  }
  function mensajeBusqueda(status, error) {
    if (status === 0) return 'No hay conexión con el servidor. Revisa tu red e inténtalo de nuevo.';
    if (status === 400 || error === 'FALTA_Q') return 'Escribe al menos 2 letras para buscar.';
    if (status === 429) return 'Demasiadas búsquedas seguidas. Espera un momento e inténtalo de nuevo.';
    if (status === 503 || error === 'SIN_CONEXION') return 'El servidor no tiene conexión a internet en este momento. Inténtalo más tarde.';
    return 'No se pudo buscar. Inténtalo de nuevo en un momento.';
  }

  /* ───────────── letras (GET /api/lyrics) ───────────── */
  /* → { tipo: 'synced' | 'plain' | 'ninguna', lineas: [{ t, text }] }. Acepta `time` (contrato) o `t` (lo que da hoy src/lyrics.js). */
  function normalizarLetra(data) {
    const nada = { tipo: 'ninguna', lineas: [] };
    if (!data || typeof data !== 'object') return nada;
    if (Array.isArray(data.synced)) {
      const ls = [];
      for (const x of data.synced) {
        if (!x || typeof x.text !== 'string' || !x.text.trim()) continue;
        const t = Number.isFinite(x.time) ? x.time : Number.isFinite(x.t) ? x.t : NaN;
        if (Number.isFinite(t) && t >= 0) ls.push({ t, text: x.text.trim() });
      }
      ls.sort((a, b) => a.t - b.t);
      if (ls.length) return { tipo: 'synced', lineas: ls };
    }
    if (typeof data.plain === 'string' && data.plain.trim()) {
      const ls = data.plain.replace(/\r\n?/g, '\n').trim().split('\n').map((s) => ({ t: null, text: s.trim() }));
      return { tipo: 'plain', lineas: ls };
    }
    return nada;
  }
  /* La última línea cuyo tiempo ya pasó (búsqueda binaria); -1 antes de la primera. */
  function lineaActiva(lineas, time) {
    if (!Array.isArray(lineas) || !Number.isFinite(time)) return -1;
    let lo = 0, hi = lineas.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lineas[mid].t <= time) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }
  /* Letra sin tiempos: se supone que la letra va del 8 % al 92 % de la canción (intro y final instrumentales). */
  const ENTRADA = 0.08, SALIDA = 0.08;
  function fraccionLetra(time, duration) {
    if (!(duration > 0) || !Number.isFinite(time)) return 0;
    return acotar((time / duration - ENTRADA) / (1 - ENTRADA - SALIDA), 0, 1);
  }
  function lineaProporcional(time, duration, n) {
    if (!(n > 0)) return -1;
    return Math.min(n - 1, Math.floor(fraccionLetra(time, duration) * n));
  }
  function desplazamientoProporcional(time, duration, total, visible) {
    return Math.round(Math.max(0, total - visible) * fraccionLetra(time, duration));
  }

  /* ───────────── visualizador (datos sintéticos: NO se toca el audio del motor) ───────────── */
  const MODOS_VIS = [
    { id: 'barras', nombre: 'Barras' }, { id: 'espejo', nombre: 'Espejo' }, { id: 'onda', nombre: 'Onda' }, { id: 'circulo', nombre: 'Círculo' },
    { id: 'anillos', nombre: 'Anillos' }, { id: 'puntos', nombre: 'Puntos' }, { id: 'particulas', nombre: 'Partículas' }, { id: 'nivel', nombre: 'Nivel' }
  ];
  const modoVisValido = (id) => (MODOS_VIS.some((m) => m.id === id) ? id : MODOS_VIS[0].id);

  /* n niveles entre 0 y 1 para el instante t (s): ondas suaves + un pulso al ritmo que marca la energía del género.
     Deterministas (mismo t → mismos valores). En pausa caen casi a cero. */
  function nivelesSinteticos(t, n, energia, activo) {
    const e = Number.isFinite(energia) ? acotar(energia, 0, 1) : 0.5;
    const out = [];
    const bpm = 70 + 80 * e, fase = (t * bpm) / 60;
    const pulso = Math.pow(Math.max(0, Math.cos(2 * Math.PI * fase)), 8);
    for (let i = 0; i < n; i++) {
      const k = n > 1 ? i / (n - 1) : 0;
      const onda = 0.5 + 0.25 * Math.sin(t * (1.1 + 0.37 * i) + i * 1.7) + 0.25 * Math.sin(t * (2.3 + 0.11 * i) + i * 0.5);
      let v = (0.18 + 0.62 * e) * onda * (1 - 0.45 * k) + pulso * (0.12 + 0.3 * e) * (1 - k);
      if (!activo) v *= 0.04;
      out.push(acotar(v, 0, 1));
    }
    return out;
  }
  /* ¿Arranca quieto? Con movimiento reducido o en equipos modestos (la Raspberry Pi 4B: 4 núcleos). Sin datos, se asume lento. */
  function dispositivoLento(d) {
    const x = d || {};
    if (x.reducido) return true;
    if (!(x.nucleos > 0)) return true;
    if (x.nucleos <= 4) return true;
    if (x.memoria > 0 && x.memoria <= 2) return true;
    return false;
  }

  /* ───────────── Naturaleza (WebAudio sintetizado) ───────────── */
  const SONIDOS = [
    /* emojis que YA están en assets/emoji (Twemoji SVG) */
    { id: 'lluvia', nombre: 'Lluvia', emoji: '🌧️' }, { id: 'olas', nombre: 'Olas', emoji: '🌊' }, { id: 'viento', nombre: 'Viento', emoji: '🍂' },
    { id: 'bosque', nombre: 'Bosque y pájaros', emoji: '🌿' }, { id: 'rosa', nombre: 'Ruido rosa', emoji: '🌸' }, { id: 'marron', nombre: 'Ruido marrón', emoji: '🌙' }
  ];
  /* { id: volumen } guardado → solo sonidos conocidos (propiedades propias) y volumen entre 0 y 1. */
  function limpiarMezcla(obj) {
    const out = {};
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
    for (const s of SONIDOS) {
      if (!tiene(obj, s.id) || typeof obj[s.id] !== 'number' || !Number.isFinite(obj[s.id])) continue;
      out[s.id] = acotar(obj[s.id], 0, 1);
    }
    return out;
  }
  /* n muestras de ruido entre -1 y 1. rnd() → [0, 1). Rosa: filtro de Paul Kellet; marrón: integración con fuga. */
  function ruido(tipo, n, rnd) {
    const x = new Float32Array(n);
    if (tipo === 'blanco') { for (let i = 0; i < n; i++) x[i] = rnd() * 2 - 1; return x; }
    if (tipo === 'rosa') {
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < n; i++) {
        const w = rnd() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        x[i] = acotar((b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11, -1, 1);
        b6 = w * 0.115926;
      }
      return x;
    }
    if (tipo === 'marron') {
      let u = 0;
      for (let i = 0; i < n; i++) { u = (u + 0.02 * (rnd() * 2 - 1)) / 1.02; x[i] = acotar(u * 3.5, -1, 1); }
      return x;
    }
    throw new Error('tipo de ruido desconocido: ' + tipo);
  }
  /* Respuesta al impulso de una sala (para la reverberación de la capa Naturaleza): ruido que decae. */
  function impulsoReverb(n, decaimiento, rnd) {
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = (rnd() * 2 - 1) * Math.pow(1 - i / n, decaimiento);
    return x;
  }
  const MINUTOS_TEMPORIZADOR = [0, 15, 30, 45, 60, 90];
  /* Segundos que faltan (redondeado hacia arriba); 0 sin temporizador o ya vencido. */
  const restante = (fin, ahora) => (fin > 0 ? Math.max(0, Math.ceil((fin - ahora) / 1000)) : 0);
  const fmtRestante = (s) => { const x = Math.max(0, Math.floor(Number(s) || 0)); return Math.floor(x / 60) + ':' + String(x % 60).padStart(2, '0'); };

  const api = {
    consultaBusqueda, limpiarResultados, mensajeBusqueda,
    normalizarLetra, lineaActiva, fraccionLetra, lineaProporcional, desplazamientoProporcional,
    MODOS_VIS, modoVisValido, nivelesSinteticos, dispositivoLento,
    SONIDOS, limpiarMezcla, ruido, impulsoReverb, MINUTOS_TEMPORIZADOR, restante, fmtRestante
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EscuchaLogica = api;
})(typeof window !== 'undefined' ? window : globalThis);
