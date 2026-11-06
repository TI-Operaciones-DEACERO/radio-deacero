'use strict';
/* bienestarroutes.js — /api/bienestar/*: planear el viaje de ESTE oyente y detenerlo. El viaje vive en la sesión del oyente
 * (la misma ?sid= que usa /api/next), así que no toca lo que suena en las pantallas ni lo de otros oyentes. */
const { jsonBody, ipKey } = require('./http');
const { createLimiter } = require('./ratelimit');
const B = require('./bienestar');

const VACIO = { generos: { gustan: [], evitar: [] }, artistas: { gustan: [], evitar: [] }, total: 0 };
const txt = (x, n) => (typeof x === 'string' ? x.slice(0, n) : undefined);

function createBienestarRoutes({ radio, genres, library, json, max = 20, windowMs = 60 * 1000, now = Date.now }) {
  const limiter = createLimiter({ max, windowMs, now });

  async function handle(req, res, url, account) {
    const p = url.pathname;
    if (p === '/api/bienestar/opciones') return json(res, 200, B.opciones());

    const lim = limiter.hit(ipKey(req.socket.remoteAddress));
    if (!lim.ok) return json(res, 429, { error: 'DEMASIADAS_PETICIONES' }, { 'retry-after': String(lim.retryAfter) });
    const sid = url.searchParams.get('sid'); /* policy.js ya comprobó que es válida */

    if (req.method === 'DELETE') {
      try { radio.stopViaje(sid); } catch (_) { return json(res, 503, { error: 'BIENESTAR_NO_DISPONIBLE' }); }
      res.writeHead(204);
      return res.end();
    }

    const b = await jsonBody(req, res, json);
    if (!b) return undefined;
    const taste = account && library ? library.taste(account.id) : VACIO;
    try {
      const plan = B.planViaje({
        estado: txt(b.estado, 40), texto: txt(b.texto, 300), destino: txt(b.destino, 40), intensidad: txt(b.intensidad, 20),
        duracion: txt(b.duracion, 20), estilo: txt(b.estilo, 40), idioma: txt(b.idioma, 40), genres, taste
      });
      radio.startViaje(sid, plan, taste);
      return json(res, 200, plan);
    } catch (_) {
      return json(res, 503, { error: 'BIENESTAR_NO_DISPONIBLE' }); /* sin detalles internos */
    }
  }

  return { handle };
}

module.exports = { createBienestarRoutes };
