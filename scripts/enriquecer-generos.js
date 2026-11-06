'use strict';
/* Copia desc, mood y energy de otro genres.json (el del proyecto completo) a data/genres.json.
 * Uso: node scripts/enriquecer-generos.js <ruta/al/genres.json origen>
 * Solo añade campos: no quita ni cambia ninguno de los que ya tiene. Se ejecuta una vez; el resultado se versiona. */
const fs = require('node:fs');
const path = require('node:path');

const origen = process.argv[2];
if (!origen) { console.error('Falta la ruta del genres.json de origen'); process.exit(1); }
const destino = path.join(__dirname, '..', 'data', 'genres.json');

const src = new Map(JSON.parse(fs.readFileSync(origen, 'utf8')).map((g) => [g.id, g]));
const lite = JSON.parse(fs.readFileSync(destino, 'utf8'));

const faltan = lite.filter((g) => !src.has(g.id)).map((g) => g.id);
if (faltan.length) { console.error('Sin datos de origen para:', faltan.join(', ')); process.exit(1); }

const out = lite.map((g) => {
  const o = src.get(g.id);
  return { ...g, desc: o.desc, mood: o.mood, energy: o.energy };
});
fs.writeFileSync(destino, JSON.stringify(out));
console.log(`${out.length} géneros enriquecidos`);
