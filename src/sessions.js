'use strict';
/* sessions.js — sesiones de cuenta. El navegador guarda el token (cookie); aquí solo se guarda su HASH,
 * así que leer sessions.json no sirve para entrar como nadie. Sobreviven a reiniciar el servidor. */
const path = require('node:path');
const crypto = require('node:crypto');
const { readJson, writeJson } = require('./jsonfile');

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const hash = (t) => crypto.createHash('sha256').update(t).digest('hex');

function createSessions({ dir, now = Date.now, ttlMs = 7 * 24 * 60 * 60 * 1000, maxPerUser = 10, maxTotal = 2000 }) {
  const file = path.join(dir, 'sessions.json');
  const stored = readJson(file, {});
  const map = new Map(); /* hash → { uid, exp, creado } */
  for (const [h, v] of Object.entries(stored && typeof stored === 'object' ? stored : {})) {
    if (/^[a-f0-9]{64}$/.test(h) && v && typeof v.uid === 'string' && Number.isFinite(v.exp) && v.exp > now()) map.set(h, { uid: v.uid, exp: v.exp, creado: v.creado || 0 });
  }

  function save() {
    try { writeJson(file, Object.fromEntries(map), 0o600); } catch (_) { /* siguen en memoria */ }
  }

  function create(uid) {
    const t = now();
    for (const [h, v] of map) if (v.exp <= t) map.delete(h);
    const token = crypto.randomBytes(32).toString('base64url');
    map.set(hash(token), { uid, exp: t + ttlMs, creado: t });
    const mine = [...map].filter(([, v]) => v.uid === uid).sort((a, b) => a[1].creado - b[1].creado);
    while (mine.length > maxPerUser) map.delete(mine.shift()[0]);
    while (map.size > maxTotal) map.delete(map.keys().next().value); /* las más antiguas entraron primero */
    save();
    return token;
  }

  function verify(token) {
    if (typeof token !== 'string' || !TOKEN.test(token)) return null;
    const h = hash(token);
    const v = map.get(h);
    if (!v) return null;
    if (v.exp <= now()) { map.delete(h); return null; }
    return v.uid;
  }

  function destroy(token) {
    if (typeof token !== 'string' || !TOKEN.test(token)) return;
    if (map.delete(hash(token))) save();
  }

  function destroyUser(uid) {
    let any = false;
    for (const [h, v] of map) if (v.uid === uid) { map.delete(h); any = true; }
    if (any) save();
  }

  return { create, verify, destroy, destroyUser, ttlMs };
}

module.exports = { createSessions };
