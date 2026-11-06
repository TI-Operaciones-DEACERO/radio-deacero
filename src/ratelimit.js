'use strict';
/* ratelimit.js — límite de peticiones por clave (p. ej. la IP), en memoria, con ventana deslizante. */

function createLimiter({ max, windowMs, now = Date.now, maxKeys = 5000 }) {
  const hits = new Map(); /* clave → horas de las peticiones dentro de la ventana */

  /* Cuenta una petición. { ok:true } o { ok:false, retryAfter: segundos }. Las rechazadas no alargan el bloqueo. */
  function hit(key) {
    const t = now();
    const list = (hits.get(key) || []).filter((x) => t - x < windowMs);
    if (list.length >= max) {
      hits.set(key, list);
      return { ok: false, retryAfter: Math.max(1, Math.ceil((list[0] + windowMs - t) / 1000)) };
    }
    list.push(t);
    hits.delete(key); /* reinserta al final: las claves más antiguas son las primeras en salir */
    hits.set(key, list);
    while (hits.size > maxKeys) hits.delete(hits.keys().next().value);
    return { ok: true };
  }

  return { hit, size: () => hits.size };
}

module.exports = { createLimiter };
