'use strict';
/* Bienestar: la música tiene que ir DE LA MANO con el ánimo y el destino, no solo con un número de energía.
 * (Antes: «enojado → concentrarme» terminaba en reggaetón y mariachi; «estresado» empezaba con Khmer Pop; «agotado → energía» acababa en Sludge Metal.) */
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../src/bienestar');
const genres = require('../data/genres.json');

const byId = new Map(genres.map((g) => [g.id, g]));
const VACIO = { generos: { gustan: [], evitar: [] }, artistas: { gustan: [], evitar: [] }, total: 0 };
const seeded = (s) => () => { s = (s * 16807 + 1) % 2147483647; return s / 2147483647; };
const plan = (estado, destino, s = 1, extra = {}) => B.planViaje({ estado, destino, genres, taste: VACIO, rng: seeded(s), ...extra });
const ids = (f) => f.generos.map((g) => g.id);

/* Nada de esto en un viaje para calmar, dormir o concentrarse (después de la primera fase). */
const AGRESIVO = /metal|punk|hardcore|grind|thrash|djent|drill|trap|reggaeton|perreo|dembow|party|workout|hardstyle|gabber|dubstep|techno|corrido|phonk|crunk|grime|screamo|emo-rap|horrorcore|riddim|rawstyle|frenchcore|jungle|dnb/;
const INSTRUMENTAL = /instrument|lofi|ambient|piano|classical|clasic|study|focus|meditat|nature|spa|newage|harp|cello|guitar|minimal|impression|jazz|cinematic|film|post-rock|office|chillhouse|deephouse|bossa|cafe/;

test('calmar: estresado/ansioso/abrumado/enojado/frustrado → relajar, dormir o concentrarse nunca pasan por música agresiva o de fiesta', () => {
  for (const estado of ['estresado', 'ansioso', 'abrumado', 'enojado', 'frustrado']) {
    for (const destino of ['relajar', 'dormir', 'concentrar']) {
      for (let s = 1; s <= 12; s++) {
        const p = plan(estado, destino, s);
        p.fases.forEach((f, k) => {
          for (const id of ids(f)) assert.ok(!AGRESIVO.test(id), `${estado}→${destino} fase ${k + 1}: ${id}`);
        });
      }
    }
  }
});

test('destino relajar/dormir: las dos últimas fases son música tranquila de verdad (calm/winddown/focus)', () => {
  for (const estado of ['estresado', 'enojado', 'contento', 'con-energia', 'triste']) {
    for (const destino of ['relajar', 'dormir']) {
      for (let s = 1; s <= 8; s++) {
        const p = plan(estado, destino, s);
        for (const f of p.fases.slice(3)) for (const id of ids(f)) assert.ok(['calm', 'winddown', 'focus'].includes(byId.get(id).mood), `${estado}→${destino}: ${id} (${byId.get(id).mood})`);
      }
    }
  }
});

test('dormir y concentrarse terminan en música instrumental', () => {
  for (const destino of ['dormir', 'concentrar']) {
    for (let s = 1; s <= 10; s++) {
      const f = plan('ansioso', destino, s).fases[4];
      for (const id of ids(f)) assert.match(id, INSTRUMENTAL, `${destino}: ${id}`);
    }
  }
});

test('triste y nostálgico empiezan reconociendo el sentimiento (baladas, boleros, acústico), no orquesta medieval ni fiesta', () => {
  const MELANCOLIA = /sad|bolero|balad|ballad|romantic|acoustic|blues|indie-folk|night|trova|rnb-slow|requinto|bachata-clasica|mix-|oldschool|soul80s|classicrock|grupero/;
  for (const estado of ['triste', 'nostalgico']) {
    for (let s = 1; s <= 10; s++) {
      for (const id of ids(plan(estado, 'animo', s).fases[0])) assert.match(id, MELANCOLIA, `${estado}: ${id}`);
    }
  }
});

test('enojado/frustrado empiezan descargando con rock (no con salsa ni k-pop), y luego bajan', () => {
  for (const estado of ['enojado', 'frustrado']) {
    for (let s = 1; s <= 10; s++) {
      for (const id of ids(plan(estado, 'relajar', s).fases[0])) assert.match(id, /rock|grunge|britpop/, `${estado}: ${id}`);
    }
  }
});

test('energía y buen ánimo terminan con música animada y familiar (pop, rock, cumbia, salsa, electrónica…), nunca metal extremo', () => {
  for (const destino of ['energia', 'animo']) {
    for (let s = 1; s <= 10; s++) {
      const f = plan('agotado', destino, s).fases[4];
      for (const id of ids(f)) {
        assert.ok(['energy', 'uplift'].includes(byId.get(id).mood), `${destino}: ${id}`);
        assert.ok(!/metal|grind|djent|hardcore|gabber|screamo/.test(id), `${destino}: ${id}`);
      }
    }
  }
});

test('familiar: sin estilo ni idioma pedidos, no salen géneros exóticos para la planta', () => {
  const EXOTICO = /khmer|mongolian|tuvan|enka|gamelan|maori|turbo-folk|mor-lam|luk-thung|dangdut|qawwali|carnatic|hindustani|ghazal|gqom|kwaito|azonto|ndombolo|medieval|gregorian|renaissance|requiem|sevdah|klezmer|rebetiko|dabke|khaleeji/;
  const o = B.opciones();
  let s = 1;
  for (const a of o.animos) for (const d of o.destinos) {
    for (const f of plan(a.id, d.id, s++).fases) for (const id of ids(f)) assert.ok(!EXOTICO.test(id), `${a.id}→${d.id}: ${id}`);
  }
});

test('cada fase dice su carácter y, si conviene, un tono para buscar canciones que vayan con él', () => {
  const p = plan('estresado', 'relajar', 3);
  for (const f of p.fases) assert.ok(typeof f.caracter === 'string' && f.caracter, 'caracter');
  assert.equal(p.fases[4].tono, 'relaxing');
  assert.equal(plan('agotado', 'energia', 3).fases[4].tono, 'upbeat');
  assert.equal(plan('ansioso', 'concentrar', 3).fases[4].tono, 'focus');
});

test('continuación: sigue en el carácter del destino (relajar → tranquila; energía → animada)', () => {
  const r = B.generosContinuacion(plan('estresado', 'relajar', 2), genres, VACIO);
  assert.ok(r.length >= 6);
  for (const g of r) assert.ok(['calm', 'winddown', 'focus'].includes(g.mood), g.id);
  const e = B.generosContinuacion(plan('agotado', 'energia', 2), genres, VACIO);
  for (const g of e) assert.ok(['energy', 'uplift'].includes(g.mood), g.id);
});
