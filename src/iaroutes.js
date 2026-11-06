'use strict';
/* iaroutes.js — /api/ia/*: recomendaciones para el oyente. Quien escucha en /panel no tiene que entrar ni poner clave; si tiene cuenta
 * se personaliza con sus gustos. Cada llamada puede costar una petición a Gemini, así que hay un límite de ritmo por IP. */
const { createLimiter } = require('./ratelimit');
const { ipKey } = require('./http');

const GENRE_ID = /^[A-Za-z0-9_-]{1,40}$/;
const SID = /^[A-Za-z0-9_-]{8,40}$/;
const VACIO = { generos: { gustan: [], evitar: [] }, artistas: { gustan: [], evitar: [] }, total: 0 };

/* Lista de ids de género separados por coma: solo los que parecen un id, máx. 8. */
const idList = (v) => String(v || '').split(',').map((x) => x.trim()).filter((x) => GENRE_ID.test(x)).slice(0, 8);

function createIaRoutes({ ia, library, clock = Date.now, json, max = 30, geminiMax = 6, windowMs = 60 * 1000 }) {
  /* Los límites usan el reloj real del servidor: `clock` (hora corregida de la red) puede retroceder y dejar entradas "del futuro". */
  const limiter = createLimiter({ max, windowMs });
  const geminiLimiter = createLimiter({ max: geminiMax, windowMs }); /* cupo aparte para lo que llama a Gemini (cuesta dinero) */

  async function handle(req, res, url, account) {
    const p = url.pathname;
    const q = url.searchParams;
    if (p === '/api/ia/estado') return json(res, 200, { gemini: ia.gemini() });

    const lim = limiter.hit(ipKey(req.socket.remoteAddress));
    if (!lim.ok) return json(res, 429, { error: 'DEMASIADAS_PETICIONES' }, { 'retry-after': String(lim.retryAfter) });

    const hour = new Date(clock()).getHours();
    /* Pasado el cupo de Gemini de esta IP no se da error: se responde con el motor local. */
    const usaGemini = p === '/api/ia/para-ti' || p === '/api/ia/descubrir' || p === '/api/ia/playlist';
    const local = usaGemini && !geminiLimiter.hit(ipKey(req.socket.remoteAddress)).ok;
    const taste = account && library ? library.taste(account.id) : VACIO;
    const sid = q.get('sid') || undefined;
    try {
      if (p === '/api/ia/ahora') return json(res, 200, await ia.ahora({ taste, hour, recientes: idList(q.get('recientes')) }));
      if (p === '/api/ia/podcasts') return json(res, 200, await ia.podcasts({ hour }));
      if (p === '/api/ia/artistas') {
        const genero = q.get('genero') || '';
        if (!GENRE_ID.test(genero)) return json(res, 400, { error: 'FALTA_GENERO' });
        return json(res, 200, await ia.artistas({ genero, excluir: String(q.get('excluir') || '').split(',').map((x) => x.trim().slice(0, 80)).filter(Boolean).slice(0, 30) }));
      }
      if (p === '/api/ia/playlist') {
        const texto = (q.get('q') || '').trim().slice(0, 200);
        if (!texto) return json(res, 400, { error: 'FALTA_TEXTO' });
        return json(res, 200, await ia.playlist({ texto, taste, local }));
      }
      if (p === '/api/ia/para-ti') return json(res, 200, await ia.paraTi({ sid: SID.test(sid || '') ? sid : undefined, taste, hour, local }));
      if (p === '/api/ia/descubrir') {
        const prefer = idList(q.get('prefer')).length ? idList(q.get('prefer')) : taste.generos.gustan.slice(0, 4);
        const avoid = [...new Set([...idList(q.get('avoid')), ...taste.generos.evitar])].slice(0, 8);
        return json(res, 200, await ia.descubrir({ sid: SID.test(sid || '') ? sid : undefined, prefer, avoid, local }));
      }
    } catch (_) {
      return json(res, 503, { error: 'IA_NO_DISPONIBLE' }); /* sin detalles: podrían traer datos internos */
    }
    return json(res, 404, { error: 'Endpoint no encontrado' });
  }

  return { handle };
}

module.exports = { createIaRoutes };
