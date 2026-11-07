'use strict';
/* El robocopy de install.ps1 excluye por NOMBRE en cualquier carpeta: un nombre de dato personal (podcasts.json) también borraba
 * la semilla data/seed/podcasts.json y el servidor no arrancaba (pasó al desplegar en Windows). Ningún archivo que la app
 * necesita puede llamarse como algo de la lista de exclusión por nombre. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const ps1 = fs.readFileSync(path.join(ROOT, 'deploy', 'windows', 'install.ps1'), 'utf8');

function archivos(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...archivos(f)); else out.push(f);
  }
  return out;
}

test('install.ps1: la exclusión por nombre de robocopy no atrapa ningún archivo que la app necesita', () => {
  const linea = ps1.split(/\r?\n/).find((l) => /robocopy \$source/.test(l));
  assert.ok(linea, 'línea de robocopy');
  const xf = /\/XF (.*)$/.exec(linea)[1].split(/\s+/).filter((x) => x && !x.startsWith('$') && !x.startsWith('('));
  const necesarios = [...archivos(path.join(ROOT, 'src')), ...archivos(path.join(ROOT, 'public')), ...archivos(path.join(ROOT, 'data', 'seed')), path.join(ROOT, 'data', 'genres.json'), path.join(ROOT, 'server.js')];
  const atrapados = necesarios.filter((f) => xf.includes(path.basename(f))).map((f) => path.relative(ROOT, f));
  assert.deepEqual(atrapados, []);
});

test('install.ps1: los datos personales se siguen excluyendo (por ruta de data\\)', () => {
  for (const n of ['podcasts.json', 'history.json', 'users.json', 'sessions.json', 'horario.json', 'ajustes.json', 'anuncios.json', 'nominas-permitidas.txt']) {
    assert.ok(ps1.includes(`'${n}'`), n);
  }
  assert.match(ps1, /\.env/);
});

test('install.ps1: la exclusión de CARPETAS por nombre (/XD) no se lleva carpetas que la app necesita (p. ej. public/assets/vendor)', () => {
  const linea = ps1.split(/\r?\n/).find((l) => /robocopy \$source/.test(l));
  const xd = /\/XD (.*?) \/XF/.exec(linea)[1].split(/\s+/).filter((x) => x && !x.startsWith('$') && !x.startsWith('('));
  const carpetas = new Set();
  for (const f of [...archivos(path.join(ROOT, 'public')), ...archivos(path.join(ROOT, 'src')), ...archivos(path.join(ROOT, 'data', 'seed'))]) {
    for (const parte of path.relative(ROOT, path.dirname(f)).split(path.sep)) carpetas.add(parte);
  }
  assert.deepEqual(xd.filter((d) => carpetas.has(d)), []);
});
