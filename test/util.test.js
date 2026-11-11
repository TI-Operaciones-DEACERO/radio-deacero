'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fmtTime, activeLine, createHistory } = require('../public/js/util');

test('fmtTime', () => {
  assert.equal(fmtTime(0), '0:00');
  assert.equal(fmtTime(65.9), '1:05');
  assert.equal(fmtTime(3600 + 61), '1:01:01');
  assert.equal(fmtTime(NaN), '–:––');
  assert.equal(fmtTime(Infinity), '–:––');
  assert.equal(fmtTime(-3), '0:00');
});

test('activeLine: línea vigente según el tiempo', () => {
  const lines = [{ t: 5, text: 'a' }, { t: 10, text: 'b' }, { t: 20, text: 'c' }];
  assert.equal(activeLine(lines, 0), -1);
  assert.equal(activeLine(lines, 5), 0);
  assert.equal(activeLine(lines, 9.99), 0);
  assert.equal(activeLine(lines, 10), 1);
  assert.equal(activeLine(lines, 999), 2);
  assert.equal(activeLine([], 3), -1);
});

test('history: anterior vuelve por las pistas ya sonadas', () => {
  const h = createHistory(3);
  h.push({ id: 1 }); h.push({ id: 2 }); h.push({ id: 3 }); h.push({ id: 4 });
  assert.equal(h.size(), 3, 'acotado');
  assert.equal(h.pop().id, 4);
  assert.equal(h.pop().id, 3);
  assert.equal(h.pop().id, 2);
  assert.equal(h.pop(), undefined);
});

test('emojiSrc: archivo SVG según los puntos de código (como twemoji)', () => {
  const { emojiSrc } = require('../public/js/util');
  assert.equal(emojiSrc('🎷'), 'assets/emoji/1f3b7.svg');
  assert.equal(emojiSrc('☕'), 'assets/emoji/2615.svg');
  assert.equal(emojiSrc('🌶'), 'assets/emoji/1f336.svg');
  assert.equal(emojiSrc('🌶️'), 'assets/emoji/1f336.svg', 'con selector de variación (FE0F) da lo mismo');
  assert.equal(emojiSrc('🇲🇽'), 'assets/emoji/1f1f2-1f1fd.svg');
  assert.equal(emojiSrc('🏳️‍🌈'), 'assets/emoji/1f3f3-fe0f-200d-1f308.svg', 'en secuencias ZWJ se conserva FE0F');
  assert.equal(emojiSrc(''), '');
  assert.equal(emojiSrc(undefined), '');
});

test('todos los emoji de data/genres.json tienen su SVG en public/assets/emoji', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { emojiSrc } = require('../public/js/util');
  const genres = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'genres.json'), 'utf8'));
  const missing = [];
  for (const e of new Set([...genres.map((g) => g.emoji), '🎵', '🔎', '🎙️'].filter(Boolean))) {
    if (!fs.existsSync(path.join(__dirname, '..', 'public', emojiSrc(e)))) missing.push(e);
  }
  assert.deepEqual(missing, []);
});

test('clockParts: hora de 24 h sin AM/PM y fecha en español', () => {
  const { clockParts } = require('../public/js/util');
  assert.deepEqual(clockParts(new Date(2026, 9, 29, 15, 7, 9).getTime()), { time: '15:07:09', date: 'jueves, 29 de octubre' });
  assert.deepEqual(clockParts(new Date(2026, 9, 28, 0, 5, 0).getTime()), { time: '00:05:00', date: 'miércoles, 28 de octubre' }, 'medianoche = 00');
  assert.equal(clockParts(new Date(2026, 0, 1, 12, 0, 0).getTime()).time, '12:00:00', 'mediodía = 12');
  assert.equal(clockParts(new Date(2026, 0, 1, 9, 0, 0).getTime()).time, '09:00:00', 'con cero a la izquierda');
  assert.equal(clockParts(new Date(2026, 11, 31, 23, 59, 59).getTime()).time, '23:59:59');
  assert.equal(clockParts(new Date(2026, 11, 31, 23, 59, 59).getTime()).date, 'jueves, 31 de diciembre');
});

test('spokenTime: la hora como la diría un locutor de radio', () => {
  const { spokenTime } = require('../public/js/util');
  const at = (h, m) => spokenTime(new Date(2026, 9, 29, h, m, 0).getTime());
  assert.equal(at(15, 20), 'Son las tres con veinte minutos de la tarde.');
  assert.equal(at(15, 0), 'Son las tres de la tarde en punto.');
  assert.equal(at(13, 40), 'Es la una con cuarenta minutos de la tarde.');
  assert.equal(at(1, 0), 'Es la una de la madrugada en punto.');
  assert.equal(at(9, 20), 'Son las nueve con veinte minutos de la mañana.');
  assert.equal(at(21, 40), 'Son las nueve con cuarenta minutos de la noche.');
  assert.equal(at(12, 0), 'Son las doce del día en punto.');
  assert.equal(at(12, 20), 'Son las doce con veinte minutos de la tarde.');
  assert.equal(at(0, 0), 'Son las doce de la noche en punto.');
  assert.equal(at(0, 20), 'Son las doce con veinte minutos de la madrugada.');
  assert.equal(at(18, 40), 'Son las seis con cuarenta minutos de la tarde.');
  assert.equal(at(19, 0), 'Son las siete de la noche en punto.');
  assert.equal(at(10, 1), 'Son las diez con un minuto de la mañana.', 'uno -> un');
  assert.equal(at(10, 21), 'Son las diez con veintiún minutos de la mañana.');
  assert.equal(at(10, 31), 'Son las diez con treinta y un minutos de la mañana.');
  assert.equal(at(10, 45), 'Son las diez con cuarenta y cinco minutos de la mañana.');
  assert.equal(at(10, 15), 'Son las diez con quince minutos de la mañana.');
});

test('announceSlot: un solo aviso por cada múltiplo de N minutos', () => {
  const { announceSlot } = require('../public/js/util');
  const t = (h, m, s) => new Date(2026, 9, 29, h, m, s).getTime();
  assert.notEqual(announceSlot(t(15, 20, 5), 20), null);
  assert.equal(announceSlot(t(15, 20, 0), 20), announceSlot(t(15, 20, 59), 20), 'todo ese minuto es el mismo aviso');
  assert.notEqual(announceSlot(t(15, 20, 0), 20), announceSlot(t(15, 40, 0), 20), 'avisos distintos en minutos distintos');
  assert.equal(announceSlot(t(15, 21, 0), 20), null);
  assert.notEqual(announceSlot(t(15, 0, 3), 20), null, 'minuto 00 cuenta');
  assert.equal(announceSlot(t(15, 20, 0), 30), null);
  assert.notEqual(announceSlot(t(15, 30, 0), 30), null);
  assert.equal(announceSlot(t(15, 20, 0), 0), null, 'N inválido = nunca');
  assert.equal(announceSlot(t(15, 20, 0), NaN), null);
});

test('semillaDe: el artista de una canción elegida (para «más como esto»)', () => {
  const { semillaDe } = require('../public/js/util.js');
  assert.equal(semillaDe({ title: 'Selena Gomez & The Scene - Love You Like A Love Song', channel: 'SelenaGomezVEVO' }), 'Selena Gomez & The Scene');
  assert.equal(semillaDe({ title: 'Hasta Que Me Olvides', channel: 'Luis Miguel - Topic' }), 'Luis Miguel');
  assert.equal(semillaDe({ title: 'Mr. Brightside', channel: 'TheKillersVEVO' }), 'TheKillers');
  assert.equal(semillaDe({ title: 'Bad Bunny – Tití Me Preguntó (Video Oficial)', channel: 'Bad Bunny' }), 'Bad Bunny');
  assert.equal(semillaDe({ title: 'algo', channel: '' }), 'algo', 'sin canal: el título');
  assert.equal(semillaDe(null), '');
  assert.ok(semillaDe({ title: 'x'.repeat(300) + ' - y', channel: '' }).length <= 100);
});
