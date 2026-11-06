'use strict';
const net = require('node:net');
const os = require('node:os');
/* http.js — piezas comunes del servidor: leer el cuerpo con tope, cookies y comprobación de origen. */

function readBody(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let tooBig = false;
    req.on('data', (c) => {
      size += c.length;
      if (tooBig) return; /* se descarta el resto; el 413 sale ya y la conexión se cierra */
      if (size > limit) { tooBig = true; reject(Object.assign(new Error('Cuerpo demasiado grande'), { status: 413 })); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseCookies(header) {
  const out = {};
  if (typeof header !== 'string') return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const k = part.slice(0, i).trim();
    if (!(k in out)) out[k] = part.slice(i + 1).trim();
  }
  return out;
}

/* Una página de OTRO sitio no debe poder mandar acciones con la cookie del usuario: si el navegador dice de dónde
 * viene (Origin), tiene que ser este mismo servidor. Sin Origin (curl, el comando play) no hay navegador de por medio. */
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

/* Clave de límite de una dirección: IPv4 tal cual; IPv6 agrupada por /64 (cada equipo recibe un /64 entero, así no se evade
 * el límite cambiando de dirección dentro del mismo). */
function ipKey(addr) {
  if (typeof addr !== 'string' || !addr) return '?';
  const a = addr.split('%')[0].toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  if (mapped) return mapped[1];
  if (!a.includes(':')) return a;
  const [l, r] = a.split('::');
  const head = l ? l.split(':') : [];
  const tail = r === undefined ? [] : (r ? r.split(':') : []);
  const groups = r === undefined ? head : [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill('0'), ...tail];
  return groups.slice(0, 4).map((g) => (parseInt(g || '0', 16) || 0).toString(16)).join(':') + '::/64';
}

/* Defensa contra DNS rebinding: una página de otro sitio que se haga pasar por este servidor trae SU nombre en Host.
 * Se aceptan direcciones IP, localhost, el nombre de esta máquina (y su nombre completo en el dominio), *.local y los que
 * se añadan a mano (HOSTS_PERMITIDOS). Sin cabecera Host no hay navegador de por medio: se deja pasar. */
function hostAllowed(hostHeader, extra = [], machine = os.hostname().toLowerCase()) {
  if (hostHeader === undefined) return true;
  let h = String(hostHeader).trim().toLowerCase();
  if (h.startsWith('[')) h = h.slice(1, h.indexOf(']') === -1 ? undefined : h.indexOf(']'));
  else if ((h.match(/:/g) || []).length === 1) h = h.slice(0, h.indexOf(':'));
  if (!h) return false;
  if (net.isIP(h) || h === 'localhost') return true;
  if (h === machine || h.startsWith(machine + '.') || h.endsWith('.local')) return true;
  return extra.some((x) => x && String(x).toLowerCase() === h);
}

/* Cuerpo JSON de una acción: un objeto, con tope de tamaño y tipo application/json. Si no sirve, ya respondió el error y devuelve undefined. */
async function jsonBody(req, res, json, limit = 4096) {
  const hasBody = Number(req.headers['content-length']) > 0 || req.headers['transfer-encoding'] !== undefined;
  if (hasBody && !/^application\/json\b/i.test(req.headers['content-type'] || '')) { json(res, 415, { error: 'UNSUPPORTED_MEDIA_TYPE' }); return undefined; }
  try {
    const v = JSON.parse((await readBody(req, limit)) || '{}');
    if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  } catch (e) {
    if (e.status === 413) { json(res, 413, { error: 'Cuerpo demasiado grande' }); return undefined; }
  }
  json(res, 400, { error: 'JSON inválido' });
  return undefined;
}

module.exports = { readBody, jsonBody, parseCookies, sameOrigin, ipKey, hostAllowed };
