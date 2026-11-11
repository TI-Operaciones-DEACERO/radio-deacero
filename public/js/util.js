/* util.js — helpers puros del cliente (también se prueban con node:test). */
(function (root) {
  'use strict';

  function fmtTime(s) {
    if (!Number.isFinite(s)) return '–:––';
    s = Math.max(0, Math.floor(s));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    var ss = (sec < 10 ? '0' : '') + sec;
    return h ? h + ':' + (m < 10 ? '0' : '') + m + ':' + ss : m + ':' + ss;
  }

  /* Índice de la última línea con t <= tiempo (búsqueda binaria); -1 si aún no empieza. */
  function activeLine(lines, t) {
    var lo = 0, hi = lines.length - 1, ans = -1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (lines[mid].t <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }

  /* Pila acotada de pistas ya sonadas, para el botón "anterior". */
  function createHistory(max) {
    var items = [];
    return {
      push: function (x) { items.push(x); if (items.length > max) items.shift(); },
      pop: function () { return items.pop(); },
      size: function () { return items.length; }
    };
  }

  /* Archivo SVG (Twemoji) de un emoji: puntos de código en hex unidos por "-". Mismo criterio que twemoji:
     el selector FE0F solo se conserva dentro de secuencias ZWJ. La Pi no trae fuente de emoji. */
  function emojiSrc(emoji) {
    if (!emoji) return '';
    var cps = Array.from(emoji).map(function (c) { return c.codePointAt(0).toString(16); });
    if (emoji.indexOf('‍') === -1) cps = cps.filter(function (c) { return c !== 'fe0f'; });
    return 'assets/emoji/' + cps.join('-') + '.svg';
  }

  /* Pone el emoji en el elemento como imagen (si falla, como texto). */
  function setEmoji(el, emoji) {
    el.textContent = '';
    if (!emoji) return;
    var img = document.createElement('img');
    img.className = 'emo'; img.alt = emoji; img.decoding = 'async';
    img.onerror = function () { el.textContent = emoji; };
    img.src = emojiSrc(emoji);
    el.appendChild(img);
  }

  /* Lista para la orden 'queue' (/panel/completo): conserva solo lo reproducible, con campos acotados y un tope.
     { track:{id,title,channel,duration} } = canción conocida · { q } = consulta que se resuelve con la búsqueda. */
  var QUEUE_MAX = 200;
  function cleanQueueItems(items) {
    var out = [];
    if (!Array.isArray(items)) return out;
    for (var i = 0; i < items.length && out.length < QUEUE_MAX; i++) {
      var it = items[i];
      if (!it || typeof it !== 'object') continue;
      var t = it.track;
      if (t && typeof t === 'object' && typeof t.id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(t.id) && typeof t.title === 'string' && t.title.trim()) {
        out.push({ track: { id: t.id, title: t.title.trim().slice(0, 300), channel: typeof t.channel === 'string' ? t.channel.slice(0, 200) : '', duration: Number.isFinite(t.duration) && t.duration >= 0 ? t.duration : 0 } });
      } else if (typeof it.q === 'string' && it.q.trim()) {
        out.push({ q: it.q.trim().slice(0, 100) });
      }
    }
    return out;
  }

  /* Reloj del kiosco: hora de 24 h y fecha en español. */
  var DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  var MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  function two(n) { return (n < 10 ? '0' : '') + n; }
  function clockParts(ms) {
    var d = new Date(ms);
    return {
      time: two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds()),
      date: DAYS[d.getDay()] + ', ' + d.getDate() + ' de ' + MONTHS[d.getMonth()]
    };
  }

  /* Locutor: la hora dicha en palabras (el navegador la lee con su voz en español). */
  var UNITS = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince',
    'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco',
    'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'];
  var TENS = ['', '', '', 'treinta', 'cuarenta', 'cincuenta'];
  var HOURS = ['doce', 'una', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once'];
  function minuteWords(n) {
    if (n === 21) return 'veintiún';
    var w = n < 30 ? UNITS[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ' y ' + UNITS[n % 10] : '');
    return n % 10 === 1 && n !== 11 ? w.replace(/uno$/, 'un') : w;
  }
  function spokenTime(ms) {
    var d = new Date(ms);
    var h = d.getHours(), m = d.getMinutes();
    var period = h < 6 ? 'de la madrugada' : h < 12 ? 'de la mañana' : h < 19 ? 'de la tarde' : 'de la noche';
    if (h === 12 && m === 0) period = 'del día';
    if (h === 0 && m === 0) period = 'de la noche';
    var h12 = h % 12;
    var lead = h12 === 1 ? 'Es la ' : 'Son las ';
    if (m === 0) return lead + HOURS[h12] + ' ' + period + ' en punto.';
    return lead + HOURS[h12] + ' con ' + minuteWords(m) + ' ' + (m === 1 ? 'minuto' : 'minutos') + ' ' + period + '.';
  }
  /* Número del minuto (si toca avisar) o null: el mismo durante todo ese minuto, para avisar una sola vez. */
  function announceSlot(ms, everyMin) {
    if (!(everyMin >= 1)) return null;
    return new Date(ms).getMinutes() % everyMin === 0 ? Math.floor(ms / 60000) : null;
  }

  /* «Más como esto»: el artista de una canción elegida. «Artista - Título» → Artista; si no, el canal sin « - Topic» ni «VEVO». */
  function semillaDe(track) {
    if (!track) return '';
    var title = String(track.title || '').trim();
    var m = /^(.{2,60}?)\s+[-–—]\s+\S/.exec(title);
    var canal = String(track.channel || '').replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').replace(/\s*(Official|Oficial)$/i, '').trim();
    return (m ? m[1].trim() : canal || title).slice(0, 100);
  }

  var api = { semillaDe: semillaDe, clockParts: clockParts, spokenTime: spokenTime, announceSlot: announceSlot, fmtTime: fmtTime, activeLine: activeLine, createHistory: createHistory, emojiSrc: emojiSrc, setEmoji: setEmoji, cleanQueueItems: cleanQueueItems };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Util = api;
})(typeof window !== 'undefined' ? window : globalThis);
