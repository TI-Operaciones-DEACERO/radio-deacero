'use strict';
/* users.js — cuentas locales. Se entra SOLO con el número de nómina (sin contraseña) y la cuenta se crea sola la primera vez.
 *
 * Sin contraseña, quien conozca una nómina puede entrar como esa persona. Lo que hay detrás de una cuenta es poco
 * (gustos de música), pero el control real es la LISTA DE NÓMINAS PERMITIDAS (data/nominas-permitidas.txt, una por línea):
 * si el archivo existe, solo esas nóminas entran. Los datos personales viven en DATA_DIR y nunca se versionan (.gitignore). */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { readJson, writeJson } = require('./jsonfile');

const NOMINA = /^[0-9]{4,10}$/;
const ID = /^[a-f0-9]{16}$/;
const ESTADOS = new Set(['activo', 'desactivado']);

function normalizeNomina(x) {
  if (typeof x !== 'string' && typeof x !== 'number') return null;
  const s = String(x).trim();
  return NOMINA.test(s) ? s : null;
}

/* Nombre opcional: sin caracteres de control ni de dirección de texto, espacios colapsados, máx. 40. */
function cleanNombre(x) {
  if (typeof x !== 'string') return null;
  const s = x.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40).trim();
  return s || null;
}

function createUsers({ dir, now = Date.now, max = 5000 }) {
  const file = path.join(dir, 'users.json');
  const allowedFile = path.join(dir, 'nominas-permitidas.txt');
  const stored = readJson(file, []);
  const items = new Map();
  for (const u of Array.isArray(stored) ? stored : []) {
    if (u && ID.test(u.id) && normalizeNomina(u.nomina) && ESTADOS.has(u.estado)) items.set(u.id, u);
  }
  const byNomina = () => new Map([...items.values()].map((u) => [u.nomina, u]));

  function save() {
    try { writeJson(file, [...items.values()], 0o600); } catch (_) { /* sigue en memoria */ }
  }

  /* null = sin lista (entra cualquiera). Si el archivo existe pero no se puede leer, no entra nadie (falla cerrado). */
  function allowed() {
    let text;
    try { text = fs.readFileSync(allowedFile, 'utf8'); }
    catch (e) { return e.code === 'ENOENT' ? null : new Set(); }
    return new Set(text.split(/\r?\n/).map((l) => normalizeNomina(l.replace(/#.*/, ''))).filter(Boolean));
  }

  const view = (u) => ({ id: u.id, nomina: u.nomina, nombre: u.nombre, creado: u.creado, ultimo: u.ultimo, estado: u.estado });

  function entrar(rawNomina, rawNombre) {
    const nomina = normalizeNomina(rawNomina);
    if (!nomina) return { ok: false, error: 'NOMINA_INVALIDA' };
    const list = allowed();
    if (list && !list.has(nomina)) return { ok: false, error: 'NO_AUTORIZADA' };
    const nombre = cleanNombre(rawNombre);
    let u = byNomina().get(nomina);
    if (u) {
      if (u.estado !== 'activo') return { ok: false, error: 'DESACTIVADA' };
      if (nombre) u.nombre = nombre;
      u.ultimo = now();
      save();
      return { ok: true, nuevo: false, user: view(u) };
    }
    if (items.size >= max) return { ok: false, error: 'LLENO' };
    u = { id: crypto.randomBytes(8).toString('hex'), nomina, nombre, creado: now(), ultimo: now(), estado: 'activo' };
    items.set(u.id, u);
    save();
    return { ok: true, nuevo: true, user: view(u) };
  }

  const get = (id) => (typeof id === 'string' && ID.test(id) && items.has(id) ? view(items.get(id)) : null);
  const list = () => [...items.values()].map(view);

  function setEstado(id, estado) {
    if (!ID.test(id) || !items.has(id) || !ESTADOS.has(estado)) return null;
    items.get(id).estado = estado;
    save();
    return view(items.get(id));
  }

  function rename(id, nombre) {
    if (typeof id !== 'string' || !ID.test(id) || !items.has(id)) return null;
    items.get(id).nombre = cleanNombre(nombre);
    save();
    return view(items.get(id));
  }

  const dataFile = (id) => path.join(dir, 'users', id + '.json');

  function remove(id) {
    if (typeof id !== 'string' || !ID.test(id) || !items.has(id)) return false;
    items.delete(id);
    save();
    try { fs.unlinkSync(dataFile(id)); } catch (_) { /* no tenía datos */ }
    return true;
  }

  /* Todo lo que se guarda de una persona (para que se lo pueda llevar). */
  function exportar(id) {
    if (typeof id !== 'string' || !ID.test(id) || !items.has(id)) return null;
    return { user: view(items.get(id)), datos: readJson(dataFile(id), null) };
  }

  return { entrar, get, list, setEstado, rename, remove, export: exportar };
}

module.exports = { createUsers, normalizeNomina, cleanNombre };
