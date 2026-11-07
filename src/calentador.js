'use strict';
/* calentador.js — tiene listas las canciones de los géneros ANTES de que alguien los pida, para que en el panel el cambio de género y
 * «siguiente» empiecen al instante (sin esperar una búsqueda de yt-dlp ni la resolución de la URL).
 * Va de a UN género por tick (no satura la Pi): busca si su pool está corto y resuelve las primeras `porGenero` canciones.
 * Los géneros que la gente acaba de pedir (prioridad) pasan al frente de la fila. */

function createCalentador({ radio, generos, resolver, porGenero = 2, cadaMs = 15000 }) {
  let i = 0;
  const urgentes = [];
  let ocupado = false;

  function prioridad(id) {
    if (typeof id === 'string' && !urgentes.includes(id)) urgentes.push(id);
    while (urgentes.length > 20) urgentes.shift();
  }

  async function tick() {
    if (ocupado) return;
    ocupado = true;
    try {
      const lista = generos();
      const id = urgentes.shift() || (lista.length ? lista[i++ % lista.length] : null);
      if (!id) return;
      const ids = await radio.calentar(id);
      for (const t of ids.slice(0, porGenero)) await resolver(t).catch(() => {});
    } catch (_) { /* yt-dlp caído o sin red: se reintenta en el siguiente tick */ }
    finally { ocupado = false; }
  }

  let timer = null;
  if (cadaMs > 0) { timer = setInterval(tick, cadaMs); if (timer.unref) timer.unref(); }

  return { tick, prioridad, stop: () => timer && clearInterval(timer) };
}

module.exports = { createCalentador };
