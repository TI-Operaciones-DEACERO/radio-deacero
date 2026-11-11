'use strict';
/* Radio en vivo: lista CURADA de emisoras (data/seed/emisoras.json) y proxy de su flujo de audio.
 * El navegador solo habla con este servidor (/api/emisora/<id>): así suena aunque la red del equipo no alcance la emisora, y nadie puede
 * pedir una URL arbitraria (no hay SSRF: solo ids de la lista). Cada oyente es una conexión hacia la emisora, con tope total. */
const { Readable } = require('node:stream');

const ID = /^[a-z0-9-]{1,40}$/;
const TIPO_AUDIO = /^(audio\/[a-z0-9.+-]+|application\/ogg)$/i;

function createEmisoras({ lista = [], fetchImpl = fetch, conectarMs = 10000, max = 20 } = {}) {
  const validas = (Array.isArray(lista) ? lista : []).filter((e) => {
    if (!e || !ID.test(e.id || '') || !e.nombre) return false;
    try { return ['http:', 'https:'].includes(new URL(e.url).protocol); } catch (_) { return false; }
  });
  const porId = new Map(validas.map((e) => [e.id, e]));
  const publica = validas.map((e) => ({ id: e.id, nombre: String(e.nombre), frecuencia: String(e.frecuencia || ''), banda: String(e.banda || ''), estilo: String(e.estilo || '') }));
  let activas = 0;

  const fin = (res, code, error) => { if (!res.headersSent) { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify({ error })); } else res.destroy(); };

  async function escuchar(id, req, res) {
    const e = ID.test(id || '') ? porId.get(id) : null;
    if (!e) return fin(res, 404, 'NO_EXISTE');
    if (activas >= max) return fin(res, 503, 'OCUPADO');
    activas++;
    let suelto = false;
    const soltar = () => { if (!suelto) { suelto = true; activas--; } };
    const ac = new AbortController();
    const cerrar = () => { ac.abort(); soltar(); };
    res.on('close', cerrar);
    const reloj = setTimeout(() => ac.abort(new Error('TIEMPO')), conectarMs);
    let r;
    try {
      r = await fetchImpl(e.url, { signal: ac.signal, redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (radio de planta)', 'icy-metadata': '0' } });
    } catch (_) {
      clearTimeout(reloj);
      soltar();
      return fin(res, ac.signal.reason && ac.signal.reason.message === 'TIEMPO' ? 504 : 502, 'SIN_SENAL');
    }
    clearTimeout(reloj);
    const tipo = String(r.headers.get('content-type') || '').split(';')[0].trim();
    if (!r.ok || !r.body || !TIPO_AUDIO.test(tipo)) {
      try { if (r.body) await r.body.cancel(); } catch (_) { /* ya cerrado */ }
      soltar();
      return fin(res, 502, 'SIN_SENAL');
    }
    if (res.destroyed) { try { await r.body.cancel(); } catch (_) { /* ya cerrado */ } return soltar(); }
    res.writeHead(200, { 'content-type': tipo, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    const flujo = Readable.fromWeb(r.body);
    flujo.on('error', () => { res.destroy(); cerrar(); });
    flujo.on('end', () => { res.end(); soltar(); });
    flujo.pipe(res);
  }

  return { list: () => publica.map((e) => ({ ...e })), existe: (id) => porId.has(id), escuchar, activas: () => activas };
}

module.exports = { createEmisoras };
