'use strict';
/* Temas del panel completo: la lista (public/js/panel/temas.js) y sus tokens en panel-completo.css deben cumplir contraste AA. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const T = require('../public/js/panel/temas');

const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'panel-completo.css'), 'utf8');

/* Tokens --x: valor de un bloque de reglas */
function tokens(cuerpo) {
  const out = {};
  for (const m of cuerpo.matchAll(/--([a-z-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const base = tokens((/(?:^|\n):root\s*\{([^}]*)\}/.exec(CSS) || [])[1] || '');
function tokensDe(id) {
  if (id === 'oscuro') return base;
  const re = new RegExp(':root\\[data-tema="' + id + '"\\]\\s*\\{([^}]*)\\}');
  const m = re.exec(CSS);
  assert.ok(m, 'falta el bloque del tema ' + id + ' en panel-completo.css');
  return { ...base, ...tokens(m[1]) };
}

test('luminancia y contraste: valores de referencia de WCAG', () => {
  assert.equal(T.contraste('#000000', '#ffffff'), 21);
  assert.equal(T.contraste('#fff', '#fff'), 1);
  assert.ok(Math.abs(T.contraste('#767676', '#ffffff') - 4.54) < 0.01);
  assert.equal(T.contraste('#ffffff', '#000'), T.contraste('#000', '#ffffff')); /* simétrico */
  assert.ok(Number.isNaN(T.contraste('rojo', '#fff')));
});

test('TEMAS: 6 temas, oscuro por omisión; temaValido regresa al oscuro con basura', () => {
  assert.equal(T.TEMAS.length, 6);
  const ids = T.TEMAS.map((t) => t.id);
  assert.equal(new Set(ids).size, 6);
  for (const id of ['oscuro', 'claro', 'contraste']) assert.ok(ids.includes(id), id);
  assert.equal(T.POR_OMISION, 'oscuro');
  assert.equal(T.temaValido('claro'), 'claro');
  assert.equal(T.temaValido('<script>'), 'oscuro');
  assert.equal(T.temaValido(undefined), 'oscuro');
  assert.equal(T.temaValido('constructor'), 'oscuro');
  /* los 3 de color conservan el naranja de la marca */
  const color = T.TEMAS.filter((t) => !['oscuro', 'claro', 'contraste'].includes(t.id));
  assert.equal(color.length, 3);
  for (const t of color) assert.equal(tokensDe(t.id).accent.toUpperCase(), '#F59B23', t.id);
});

/* Pares que se pintan juntos en la interfaz: [texto, fondo, mínimo] */
const PARES = [
  ['text', 'bg', 4.5], ['text', 'panel', 4.5], ['text', 'input', 4.5], ['text', 'bar', 4.5], ['text', 'accent-bg', 4.5],
  ['muted', 'bg', 4.5], ['muted', 'panel', 4.5], ['muted', 'bar', 4.5],
  ['accent-ink', 'accent', 4.5],
  ['accent-text', 'bg', 4.5], ['accent-text', 'panel', 4.5], ['accent-text', 'bar', 4.5],
  ['danger', 'bg', 4.5], ['danger', 'panel', 4.5],
  ['line-strong', 'bg', 3], ['line-strong', 'panel', 3], /* bordes de campos y botones (no texto) */
  ['accent', 'bg', 3] /* botón principal y pestaña elegida contra el fondo (no texto) */
];

for (const t of T.TEMAS) {
  test('tema «' + t.nombre + '»: contraste AA en todos los pares de la interfaz', () => {
    const k = tokensDe(t.id);
    for (const [a, b, min] of PARES) {
      assert.ok(k[a] && k[b], t.id + ': faltan los tokens --' + a + ' / --' + b);
      const c = T.contraste(k[a], k[b]);
      assert.ok(c >= min, t.id + ': --' + a + ' (' + k[a] + ') sobre --' + b + ' (' + k[b] + ') = ' + c.toFixed(2) + ' < ' + min);
    }
  });
}
