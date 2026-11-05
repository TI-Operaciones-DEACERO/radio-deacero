'use strict';
/* stream.js — pasa el audio/video de googlevideo.com al navegador.
 *
 * El navegador solo habla con este servidor: así el firewall que bloquea
 * googlevideo.com no afecta a la pantalla, y el audio es del mismo origen
 * (el visualizador puede leerlo). */
const { Readable } = require('node:stream');

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const PASS = ['content-type', 'content-length', 'content-range', 'accept-ranges'];

/* Solo se hace de proxy al CDN de YouTube (evita convertir esto en un proxy abierto / SSRF). */
function isYoutubeCdn(host) {
  return host === 'googlevideo.com' || host.endsWith('.googlevideo.com');
}

function createProxy({ resolve, invalidate, fetchImpl = fetch, allowHost = isYoutubeCdn }) {
  const fail = (res, code, msg) => {
    if (res.headersSent) { res.destroy(); return; }
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: msg }));
  };

  async function handle(req, res, id, mode = 'audio') {
    if (!VIDEO_ID.test(id || '')) return fail(res, 400, 'ID inválido');

    const ctrl = new AbortController();
    res.on('close', () => ctrl.abort());

    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const { url } = await resolve(id, mode);
        if (!allowHost(new URL(url).hostname)) return fail(res, 502, 'Origen no permitido');

        const up = await fetchImpl(url, {
          headers: { 'user-agent': UA, accept: '*/*', 'accept-encoding': 'identity', range: req.headers.range || 'bytes=0-' },
          signal: ctrl.signal
        });
        /* URL caducada o ligada a otra IP: se resuelve de nuevo una vez. */
        if ([403, 404, 410].includes(up.status) && attempt === 0) {
          invalidate(id);
          if (up.body) up.body.cancel().catch(() => {});
          continue;
        }
        if (!up.ok) return fail(res, 502, `El origen respondió ${up.status}`);

        const headers = { 'cache-control': 'no-store' };
        for (const h of PASS) { const v = up.headers.get(h); if (v) headers[h] = v; }
        if (!headers['content-type']) headers['content-type'] = mode === 'video' ? 'video/mp4' : 'audio/mp4';
        if (!headers['accept-ranges']) headers['accept-ranges'] = 'bytes';
        /* Sin Range del cliente se pide `bytes=0-` al CDN (sin rango se estrangula),
         * pero al navegador se le responde 200 completo, no 206. */
        const partial = up.status === 206 && !!req.headers.range;
        if (!partial) delete headers['content-range'];
        res.writeHead(partial ? 206 : 200, headers);
        const body = Readable.fromWeb(up.body);
        body.on('error', () => res.destroy());
        body.pipe(res);
        return;
      }
    } catch (e) {
      if (ctrl.signal.aborted) return; /* el cliente cerró (cambio de pista): normal */
      fail(res, 502, e.message);
    }
  }

  /* ¿Se puede reproducir esta pista? Resuelve y pide 1 byte al CDN, sin pasarlo a nadie. Sirve para NO ofrecer canciones que van a fallar
   * (p. ej. certificados "aún no válidos" por un reloj atrasado, o un nodo que no responde). La URL queda en la caché de resolve. */
  async function probe(id, mode = 'audio') {
    if (!VIDEO_ID.test(id || '')) return false;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { url } = await resolve(id, mode);
        if (!allowHost(new URL(url).hostname)) return false;
        const up = await fetchImpl(url, {
          headers: { 'user-agent': UA, accept: '*/*', 'accept-encoding': 'identity', range: 'bytes=0-0' },
          signal: AbortSignal.timeout(8000)
        });
        if (up.body) up.body.cancel().catch(() => {});
        if ([403, 404, 410].includes(up.status) && attempt === 0) { invalidate(id); continue; }
        return up.ok;
      } catch { return false; }
    }
    return false;
  }

  return { handle, probe };
}

module.exports = { createProxy, isYoutubeCdn };
