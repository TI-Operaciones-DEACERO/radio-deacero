'use strict';
/* adminroutes.js — /api/admin/* (salvo usuarios, que atiende authroutes.js) y el audio de los anuncios (/api/anuncio/:id).
 * El nivel de acceso (clave) ya lo comprobó server.js con policy.js; aquí solo se atiende. */
const fs = require('node:fs');
const { jsonBody } = require('./http');
const policy = require('./policy');

const ANUNCIO = /^\/api\/admin\/anuncios\/([a-f0-9]{8})(\/probar)?$/;
const AUDIO = /^\/api\/anuncio\/([a-f0-9]{8})$/;
const HORARIO = /^\/api\/admin\/horario(\/ahora|\/generar)?$/;

function createAdminRoutes({ programa, anuncios, ajustes, diag, sistema, json }) {
  const body = (req, res) => jsonBody(req, res, json, (policy.resolve(req.method, new URL(req.url, 'http://x').pathname) || {}).bodyLimit || 4096);
  const falta = (res) => json(res, 503, { error: 'NO_DISPONIBLE' });

  async function horario(req, res, p) {
    if (!programa) return falta(res);
    if (p === '/api/admin/horario/ahora') return json(res, 200, programa.seleccion());
    if (p === '/api/admin/horario/generar') {
      const b = await body(req, res);
      if (!b) return undefined;
      return json(res, 200, { bloques: programa.generar(b.jornada) });
    }
    if (req.method === 'GET') return json(res, 200, programa.get());
    const b = await body(req, res);
    if (!b) return undefined;
    const r = programa.set(b);
    return r.ok ? json(res, 200, r.horario) : json(res, 400, { error: 'HORARIO_INVALIDO', detalle: r.detalle });
  }

  async function avisos(req, res, p) {
    if (!anuncios) return falta(res);
    if (p === '/api/admin/anuncios') {
      if (req.method === 'GET') return json(res, 200, anuncios.list());
      const b = await body(req, res);
      if (!b) return undefined;
      const r = anuncios.add(b);
      return r.ok ? json(res, 201, r.anuncio) : json(res, 400, { error: r.error, detalle: r.detalle });
    }
    const [, id, probar] = ANUNCIO.exec(p);
    if (probar) {
      const n = anuncios.probar(id);
      return n === null ? json(res, 404, { error: 'NO_EXISTE' }) : json(res, 200, { entregado: n });
    }
    if (req.method === 'DELETE') {
      if (!anuncios.remove(id)) return json(res, 404, { error: 'NO_EXISTE' });
      res.writeHead(204);
      return res.end();
    }
    const b = await body(req, res);
    if (!b) return undefined;
    const r = anuncios.patch(id, b);
    if (r.ok) return json(res, 200, r.anuncio);
    return json(res, r.error === 'NO_EXISTE' ? 404 : 400, { error: r.error, detalle: r.detalle });
  }

  async function config(req, res) {
    if (!ajustes) return falta(res);
    if (req.method === 'GET') return json(res, 200, ajustes.get());
    const b = await body(req, res);
    if (!b) return undefined;
    const r = ajustes.set(b);
    return r.ok ? json(res, 200, r.ajustes) : json(res, 400, { error: 'AJUSTES_INVALIDOS', detalle: r.detalle });
  }

  /* Audio de un anuncio: lo piden las pantallas (nivel clave, como /api/events). */
  function audio(req, res, id) {
    const f = anuncios && anuncios.archivo(id);
    if (!f) return json(res, 404, { error: 'NO_EXISTE' });
    fs.stat(f, (e, st) => {
      if (e || !st.isFile()) return json(res, 404, { error: 'NO_EXISTE' });
      res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': st.size, 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff' });
      fs.createReadStream(f).pipe(res);
    });
    return undefined;
  }

  function handle(req, res, url) {
    const p = url.pathname;
    const a = AUDIO.exec(p);
    if (a) return audio(req, res, a[1]);
    if (p === '/api/admin/estado') return json(res, 200, { ok: true });
    if (HORARIO.test(p)) return horario(req, res, p); /* rutas exactas: un prefijo dejaría pasar /api/admin/horarioX */
    if (p === '/api/admin/anuncios' || ANUNCIO.test(p)) return avisos(req, res, p);
    if (p === '/api/admin/ajustes') return config(req, res);
    if (p === '/api/admin/diagnostico') {
      return json(res, 200, { servicios: diag ? diag.resumen() : [], eventos: diag ? diag.eventos() : [], sistema: sistema() });
    }
    return json(res, 404, { error: 'Endpoint no encontrado' });
  }

  return { handle };
}

module.exports = { createAdminRoutes };
