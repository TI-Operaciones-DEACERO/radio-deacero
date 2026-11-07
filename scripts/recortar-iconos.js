#!/usr/bin/env node
'use strict';
/* recortar-iconos.js — arma public/assets/vendor/fontawesome/css/iconos.min.css con SOLO los iconos de Font Awesome que usa el panel
 * (los busca en public/panel-completo.html y public/js/panel/*.js). all.min.css pesa ~100 KB y la Raspberry Pi 4B es lenta.
 *
 *   node scripts/recortar-iconos.js          regenera el archivo (después de usar un icono nuevo)
 *
 * test/panel-iconos.test.js falla si el panel usa un icono que no está en el recorte. */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const FA = path.join(ROOT, 'public', 'assets', 'vendor', 'fontawesome', 'css');
const ESTILOS = new Set(['fa-solid', 'fa-brands', 'fa-regular', 'fa-classic', 'fa-sharp']); /* clases de estilo, no iconos */

/* Iconos (fa-xxx) que aparecen en el HTML y el JS del panel (no los nombres de archivo como /webfonts/fa-solid-900.woff2). */
function iconosUsados() {
  const archivos = [path.join(ROOT, 'public', 'panel-completo.html')]
    .concat(fs.readdirSync(path.join(ROOT, 'public', 'js', 'panel')).filter((f) => f.endsWith('.js')).map((f) => path.join(ROOT, 'public', 'js', 'panel', f)));
  const out = new Set();
  for (const f of archivos) for (const m of fs.readFileSync(f, 'utf8').matchAll(/(?<![\w/.-])fa-[a-z0-9]+(?:-[a-z0-9]+)*(?![\w.-])/g)) if (!ESTILOS.has(m[0])) out.add(m[0]);
  return [...out].sort();
}

/* Reglas de primer nivel de un CSS minificado (las @reglas con llaves anidadas van completas). */
function reglas(css) {
  const out = [];
  let i = 0;
  while (i < css.length) {
    const a = css.indexOf('{', i);
    if (a < 0) break;
    const sel = css.slice(i, a).replace(/\/\*[\s\S]*?\*\//g, '').trim();
    let n = 1, j = a + 1;
    while (j < css.length && n > 0) { if (css[j] === '{') n++; else if (css[j] === '}') n--; j++; }
    out.push({ sel, cuerpo: css.slice(a + 1, j - 1) });
    i = j;
  }
  return out;
}

function recortar(css, iconos) {
  const quiero = new Set(iconos);
  const base = [], caras = [], iconosCss = [];
  for (const r of reglas(css)) {
    if (r.sel === '@font-face') {
      /* solo las dos fuentes que se copian (sólida 900 y marcas), y solo woff2 */
      const fam = /font-family:"Font Awesome 6 (Free|Brands)"/.exec(r.cuerpo);
      if (!fam || (fam[1] === 'Free' && !/font-weight:900/.test(r.cuerpo))) continue;
      caras.push('@font-face{' + r.cuerpo.replace(/,url\([^)]*\.ttf\) format\("truetype"\)/, '') + '}');
      continue;
    }
    if (r.sel.startsWith('@')) continue; /* animaciones: el panel no las usa */
    const sels = r.sel.split(',');
    if (sels.every((s) => /^\.fa-[a-z0-9-]+:(?::)?before$/.test(s))) {
      const mios = sels.filter((s) => quiero.has(s.replace(/:(?::)?before$/, '').slice(1)));
      if (mios.length) iconosCss.push(mios.join(',') + '{' + r.cuerpo + '}');
      continue;
    }
    /* base: familia, peso y forma de .fa/.fas/.fab y sus variables */
    if (sels.some((s) => /^(\.fa|\.fas|\.fab|\.fa-solid|\.fa-brands|\.fa-classic|:root|:host)$/.test(s.trim()))) base.push(r.sel + '{' + r.cuerpo + '}');
  }
  return { css: base.concat(caras, iconosCss).join(''), encontrados: iconosCss.length };
}

if (require.main === module) {
  const css = fs.readFileSync(path.join(FA, 'all.min.css'), 'utf8');
  const iconos = iconosUsados();
  const { css: out } = recortar(css, iconos);
  const faltan = iconos.filter((i) => !out.includes('.' + i + ':before'));
  const cab = '/*! Font Awesome Free 6.5.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free (Icons: CC BY 4.0, Fonts: SIL OFL 1.1, Code: MIT License) Copyright 2023 Fonticons, Inc.\n' +
    ' * Recorte con solo los iconos del panel: lo genera scripts/recortar-iconos.js a partir de all.min.css. No editar a mano. */\n';
  fs.writeFileSync(path.join(FA, 'iconos.min.css'), cab + out + '\n');
  console.log(iconos.length + ' iconos, ' + (cab.length + out.length) + ' bytes' + (faltan.length ? '. NO existen en Font Awesome: ' + faltan.join(', ') : ''));
  process.exitCode = faltan.length ? 1 : 0;
}

module.exports = { iconosUsados, recortar };
