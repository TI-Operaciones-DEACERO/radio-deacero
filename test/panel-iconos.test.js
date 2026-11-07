'use strict';
/* Fuentes e iconos del panel (auto-hospedados en public/assets/vendor/): cada icono de Font Awesome que usa el panel está en el recorte,
   el recorte está al día con all.min.css y las url() de las hojas apuntan a archivos que existen (sin CDN). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { iconosUsados, recortar } = require('../scripts/recortar-iconos');

const PUB = path.join(__dirname, '..', 'public');
const FA = path.join(PUB, 'assets', 'vendor', 'fontawesome', 'css');
const recorte = fs.readFileSync(path.join(FA, 'iconos.min.css'), 'utf8');
const html = fs.readFileSync(path.join(PUB, 'panel-completo.html'), 'utf8');

test('cada icono que usa el panel está en iconos.min.css', () => {
  const usados = iconosUsados();
  assert.ok(usados.length >= 20, 'se esperaban los iconos del diseño anterior: ' + usados.length);
  for (const i of usados) assert.ok(recorte.includes('.' + i + ':before'), 'falta el icono ' + i + ' (corre node scripts/recortar-iconos.js)');
});

test('el recorte está al día y es mucho más ligero que all.min.css', () => {
  const todo = fs.readFileSync(path.join(FA, 'all.min.css'), 'utf8');
  const { css } = recortar(todo, iconosUsados());
  assert.ok(recorte.includes(css), 'iconos.min.css no coincide con lo que genera scripts/recortar-iconos.js');
  assert.ok(recorte.length < todo.length / 10, recorte.length + ' bytes');
  assert.ok(!/\.ttf/.test(recorte), 'solo woff2 (los .ttf no se copian)');
});

test('el panel usa las hojas locales (sin CDN) y sus url() existen', () => {
  assert.match(html, /href="\/assets\/vendor\/inter\/inter\.css"/);
  assert.match(html, /href="\/assets\/vendor\/fontawesome\/css\/iconos\.min\.css"/);
  assert.ok(!/https?:\/\//.test(html.replace(/<!--[\s\S]*?-->/g, '').replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, '')), 'el HTML no debe pedir nada fuera del sitio');
  for (const [hoja, dir] of [[recorte, FA], [fs.readFileSync(path.join(PUB, 'assets', 'vendor', 'inter', 'inter.css'), 'utf8'), path.join(PUB, 'assets', 'vendor', 'inter')]]) {
    const urls = [...hoja.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1].replace(/["']/g, ''));
    assert.ok(urls.length > 0);
    for (const u of urls) assert.ok(fs.existsSync(path.join(dir, u)), 'no existe ' + u);
  }
});

test('licencias de Inter y Font Awesome junto a los archivos', () => {
  const lic = fs.readFileSync(path.join(PUB, 'assets', 'vendor', 'LICENCIAS.txt'), 'utf8');
  assert.match(lic, /Inter/);
  assert.match(lic, /SIL Open Font License 1\.1/);
  assert.match(lic, /Font Awesome Free/);
  assert.match(lic, /CC BY 4\.0/);
  assert.match(lic, /MIT/);
});
