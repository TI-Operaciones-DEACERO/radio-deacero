'use strict';
/* diagnostico.js — anillo de eventos en memoria (errores de yt-dlp, letras, Gemini, 5xx…) con resumen por servicio.
 * Nunca guarda claves: se borran los valores que parecen una (key=…, AIza…, token=…) y se recorta el texto. */

const NIVELES = new Set(['error', 'aviso', 'info']);
const HORA = 60 * 60 * 1000;

function limpiar(msg) {
  return String(msg == null ? '' : msg)
    .replace(/\b((?:api[_-]?)?key|token|t|secret|password)=([^&\s]+)/gi, '$1=***')
    /* cabecera o JSON: x-token: …, x-goog-api-key: …, "token":"…", password: … */
    .replace(/\b((?:x-)?(?:goog-)?(?:api[_-]?)?key|(?:x-)?token|secret|password|passwd)("?\s*:\s*"?)([^"\s,;&}]+)/gi, '$1$2***')
    .replace(/\bBearer\s+[^\s"',;]+/gi, 'Bearer ***')
    .replace(/AIza[0-9A-Za-z_-]+/g, '***')
    .replace(/\s+/g, ' ')
    .slice(0, 300);
}

function createDiagnostico({ now = Date.now, cap = 200 } = {}) {
  const ring = [];

  function add(servicio, nivel, msg) {
    ring.push({ t: now(), servicio: String(servicio || 'otro').slice(0, 30), nivel: NIVELES.has(nivel) ? nivel : 'info', msg: limpiar(msg) });
    while (ring.length > cap) ring.shift();
  }

  /* Del más reciente al más antiguo. */
  const eventos = () => ring.slice().reverse().map((e) => ({ ...e }));

  function resumen() {
    const desde = now() - HORA;
    const por = new Map();
    for (const e of ring) {
      const s = por.get(e.servicio) || { servicio: e.servicio, errores1h: 0, avisos1h: 0, ultimo: null };
      if (e.t >= desde && e.nivel === 'error') s.errores1h++;
      if (e.t >= desde && e.nivel === 'aviso') s.avisos1h++;
      s.ultimo = { t: e.t, nivel: e.nivel, msg: e.msg };
      por.set(e.servicio, s);
    }
    return [...por.values()].sort((a, b) => b.errores1h - a.errores1h || a.servicio.localeCompare(b.servicio));
  }

  return { add, eventos, resumen };
}

module.exports = { createDiagnostico };
