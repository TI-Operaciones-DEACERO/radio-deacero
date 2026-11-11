'use strict';
/* ia/local.js — recomendaciones SIN modelo y SIN red: reglas + las listas de data/seed. Son funciones puras: la misma semilla
 * (rng) da el mismo resultado, por eso se pueden probar. Sirven de motor propio y de respaldo cuando Gemini no responde. */

/* Géneros curados (familiares para la planta) de los caracteres de Bienestar. */
const FAMILIARES = new Set(Object.values(require('../bienestar').CARACTERES).flatMap((c) => c.ids));

const norm = (s) => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

const FRANJAS = [[0, 4, 'madrugada'], [5, 11, 'mañana'], [12, 14, 'mediodía'], [15, 18, 'tarde'], [19, 23, 'noche']];
const franja = (hour) => { const h = ((Math.floor(Number(hour)) % 24) + 24) % 24; return FRANJAS.find(([a, b]) => h >= a && h <= b)[2]; };

const MOODS_FRANJA = { madrugada: ['calm', 'winddown'], mañana: ['uplift', 'focus'], mediodía: ['uplift', 'energy'], tarde: ['focus', 'energy'], noche: ['calm', 'winddown', 'uplift'] };
const RAZON_FRANJA = {
  madrugada: 'Música tranquila para las horas de madrugada',
  mañana: 'Para arrancar la mañana con ánimo y enfoque',
  mediodía: 'Buen ritmo para la hora de la comida',
  tarde: 'Para mantener el empuje de la tarde',
  noche: 'Para cerrar el día con calma'
};

/* Muestra n elementos sin repetir; la probabilidad de cada uno es proporcional a su peso. */
function weightedSample(items, weight, n, rng) {
  const pool = items.map((x) => ({ x, w: Math.max(0.0001, weight(x)) }));
  const out = [];
  while (out.length < n && pool.length) {
    const total = pool.reduce((s, p) => s + p.w, 0);
    let r = rng() * total;
    let i = 0;
    for (; i < pool.length - 1; i++) { r -= pool[i].w; if (r <= 0) break; }
    out.push(pool.splice(i, 1)[0].x);
  }
  return out;
}
const shuffle = (arr, rng) => weightedSample(arr, () => 1, arr.length, rng);
const sample = (arr, n, rng) => weightedSample(arr, () => 1, n, rng);

/* ¿El género de una semilla ("pop latino", "Reggaeton") corresponde al id o etiqueta de un género de la app? */
function sameGenre(seedGenre, id, label) {
  const s = norm(seedGenre);
  if (s.length < 3) return false;
  return [norm(id), norm(label)].some((k) => k.length >= 3 && (s === k || s.includes(k) || k.includes(s)));
}
const matchesAny = (seedGenre, ids, genres) => ids.some((id) => { const g = genres.find((x) => x.id === id); return sameGenre(seedGenre, id, g && g.label); });

const pubGenre = (g, razon) => ({ id: g.id, label: g.label, emoji: g.emoji, color: g.color, mood: g.mood, energy: g.energy, razon: razon || g.desc || '' });

/* — Radio: qué género poner ahora — */
function ahora({ hour, genres, taste, recientes = [], rng = Math.random, n = 6 }) {
  const f = franja(hour);
  const moods = MOODS_FRANJA[f];
  const evitar = new Set(taste ? taste.generos.evitar : []);
  const gustan = new Set(taste ? taste.generos.gustan : []);
  const rec = new Set(recientes);
  const libre = (g) => !evitar.has(g.id) && !rec.has(g.id);
  const calmado = (g) => f !== 'madrugada' || (g.energy !== undefined ? g.energy <= 0.5 : true);
  /* Familiares primero (destacados, los curados de Bienestar y lo que le gusta a la persona): de 479 géneros la mayoría son exóticos
   * para la planta (Azonto, Khmer Pop…) y antes salían casi siempre. Solo si no alcanzan se usa el resto. */
  const familiar = (g) => g.featured || FAMILIARES.has(g.id) || gustan.has(g.id);
  let cands = genres.filter((g) => libre(g) && familiar(g) && moods.includes(g.mood) && calmado(g));
  if (cands.length < n) cands = genres.filter((g) => libre(g) && familiar(g) && moods.includes(g.mood));
  if (cands.length < n) cands = genres.filter((g) => libre(g) && moods.includes(g.mood) && calmado(g));
  if (cands.length < n) cands = genres.filter((g) => libre(g) && moods.includes(g.mood));
  if (cands.length < n) cands = genres.filter(libre);
  const pick = weightedSample(cands, (g) => (g.featured ? 2 : 1) * (gustan.has(g.id) ? 3 : 1), n, rng);
  return { franja: f, razon: RAZON_FRANJA[f], generos: pick.map((g) => pubGenre(g)) };
}

/* Artistas de las semillas, ya con la forma que usa la app. */
const card = (a, isNew = false) => ({ name: a.artist, query: a.query, genre: a.genre, reason: a.reason || 'Sugerencia para ti', emoji: a.emoji || '🎵', isNew });

/* Quita lo ya mostrado; si quedara muy poco se vuelve a empezar (mejor repetir que dejar la pantalla vacía). */
function sinVistos(list, vistos, minimo) {
  const frescos = list.filter((a) => !vistos.has(a.artist.toLowerCase()));
  return frescos.length >= minimo ? frescos : list;
}

/* — Lo más escuchado del momento: géneros Y artistas. Primero lo que más se oyó en la planta (pop = { artistas:[{name,n}], generos:[{id,n}] },
 * conteos agregados de src/popularidad.js); si no alcanza, los artistas que van con la hora (mismos ánimos que los géneros de ahora). — */
function momento({ hour, genres, seeds, taste, pop, recientes = [], rng = Math.random, nGeneros = 6, nArtistas = 8 }) {
  const base = ahora({ hour, genres, taste, recientes, rng, n: nGeneros });
  const evitar = taste ? taste.generos.evitar : [];
  const permitido = (genero) => !matchesAny(genero, evitar, genres);
  const porNombre = new Map(seeds.map((a) => [norm(a.artist), a]));
  const vistos = new Set();
  const artistas = [];
  const poner = (it) => { const k = norm(it.name); if (k && !vistos.has(k) && artistas.length < nArtistas) { vistos.add(k); artistas.push(it); } };

  /* géneros: un género popular de la planta entra entre las sugerencias (si no está ya ni se evita) */
  const generos = base.generos.slice();
  for (const g of (pop && pop.generos) || []) {
    const def = genres.find((x) => x.id === g.id);
    if (!def || (taste && taste.generos.evitar.includes(def.id)) || generos.some((x) => x.id === def.id)) continue;
    generos.unshift(pubGenre(def, 'Lo que más se escucha en la planta'));
    generos.length = Math.min(generos.length, nGeneros);
    break;
  }

  for (const a of (pop && pop.artistas) || []) {
    const sem = porNombre.get(norm(a.name));
    if (sem && !permitido(sem.genre)) continue;
    poner({ name: sem ? sem.artist : a.name, query: sem ? sem.query : (a.name + ' official music video').slice(0, 140), genre: sem ? sem.genre : '', reason: 'Lo más escuchado esta semana en la planta', emoji: sem ? sem.emoji || '🎵' : '🔥', isNew: false, popular: true });
  }

  const moods = MOODS_FRANJA[base.franja];
  const delMomento = seeds.filter((a) => permitido(a.genre) && genres.some((x) => sameGenre(a.genre, x.id, x.label) && moods.includes(x.mood)));
  for (const a of sample(delMomento.length >= nArtistas ? delMomento : seeds.filter((x) => permitido(x.genre)), nArtistas * 2, rng)) poner(card(a));
  return { franja: base.franja, razon: base.razon, generos, artistas };
}

/* — Hecho para ti: 8 afines + 4 nuevos — */
function paraTi({ taste, hour, seeds, genres, vistos = new Set(), rng = Math.random, n = 12 }) {
  const gustan = taste ? taste.generos.gustan : [];
  const evitar = taste ? taste.generos.evitar : [];
  const nNuevos = Math.min(4, Math.floor(n / 3));
  const permitidos = seeds.filter((a) => !matchesAny(a.genre, evitar, genres));
  const lista = sinVistos(permitidos.length ? permitidos : seeds, vistos, n);

  let afines = gustan.length ? lista.filter((a) => matchesAny(a.genre, gustan, genres)) : [];
  if (afines.length < n - nNuevos) {
    /* sin gustos (o pocos): se tira del ánimo de la hora */
    const moods = MOODS_FRANJA[franja(hour)];
    const delMomento = lista.filter((a) => { const g = genres.find((x) => sameGenre(a.genre, x.id, x.label)); return g && moods.includes(g.mood) && !afines.includes(a); });
    afines = afines.concat(delMomento);
  }
  const elegidosAfines = sample(afines, n - nNuevos, rng);
  const tomados = new Set(elegidosAfines.map((a) => a.artist.toLowerCase()));

  /* nuevos: de géneros que NO son los que ya le gustan, de géneros distintos entre sí */
  const nuevosPool = shuffle(lista.filter((a) => !tomados.has(a.artist.toLowerCase()) && !(gustan.length && matchesAny(a.genre, gustan, genres))), rng);
  const generosVistos = new Set();
  const nuevos = [];
  for (const a of nuevosPool) { if (nuevos.length >= nNuevos) break; if (!generosVistos.has(norm(a.genre))) { generosVistos.add(norm(a.genre)); nuevos.push(a); } }
  for (const a of nuevosPool) { if (nuevos.length >= nNuevos) break; if (!nuevos.includes(a)) nuevos.push(a); }
  nuevos.forEach((a) => tomados.add(a.artist.toLowerCase()));

  /* si faltan (pool chico), se completa con cualquier otro */
  let items = [...elegidosAfines.map((a) => card(a)), ...nuevos.map((a) => card(a, true))];
  if (items.length < n) {
    const extra = shuffle(lista.filter((a) => !tomados.has(a.artist.toLowerCase())), rng).slice(0, n - items.length);
    items = items.concat(extra.map((a) => card(a)));
  }
  return { items, context: { topGenre: gustan[0] || null } };
}

/* — Descubrir: ~70 % de lo preferido — */
function descubrir({ prefer = [], avoid = [], seeds, genres = [], vistos = new Set(), rng = Math.random, n = 12 }) {
  const lista = sinVistos(seeds.filter((a) => !matchesAny(a.genre, avoid, genres)), vistos, n);
  const pref = prefer.length ? lista.filter((a) => matchesAny(a.genre, prefer, genres)) : [];
  const nPref = Math.min(pref.length, Math.round(n * 0.7));
  const a = sample(pref, nPref, rng);
  const tomados = new Set(a.map((x) => x.artist.toLowerCase()));
  const resto = sample(lista.filter((x) => !tomados.has(x.artist.toLowerCase())), n - a.length, rng);
  return { items: [...a, ...resto].map((x) => card(x, !pref.includes(x))) };
}

/* — Artistas de un género — */
function artistas({ genero, excluir = [], seeds, genres, rng = Math.random, n = 8 }) {
  const g = genres.find((x) => x.id === genero);
  const ex = new Set(excluir.map((x) => String(x).toLowerCase()));
  const match = seeds.filter((a) => sameGenre(a.genre, genero, g && g.label) && !ex.has(a.artist.toLowerCase()));
  return { items: sample(match, n, rng).map((a) => card(a)) };
}

/* — Podcasts según la hora — */
function podcasts({ hour, seeds, rng = Math.random, n = 3 }) {
  const f = franja(hour);
  return { franja: f, items: sample(seeds[f] || [], n, rng) };
}

/* — Playlist desde texto libre — */
const MOOD_WORDS = {
  calm: /\b(relaj\w*|tranquil\w*|calma\w*|suave\w*|chill|paz)\b/,
  focus: /\b(estudi\w*|concentr\w*|trabaj\w*|enfoc\w*|lectur\w*|leer)\b/,
  energy: /\b(fiesta\w*|bail\w*|energi\w*|ejercicio|gym|corre\w*|motiv\w*|activ\w*)\b/,
  uplift: /\b(feliz|felices|aleg\w*|animo|animad\w*|positiv\w*)\b/,
  winddown: /\b(dormir|noche|descans\w*|sueno)\b/
};
const MOOD_NOMBRE = { calm: 'tranquila', focus: 'para concentrarse', energy: 'con energía', uplift: 'de buen ánimo', winddown: 'para descansar' };

function decada(t) {
  const m = /\b(?:19)?([5-9]0)s?\b/.exec(t);
  if (m) return m[1] + 's';
  const n = /\b(2000|2010|2020)s?\b/.exec(t);
  return n ? n[1] + 's' : null;
}

function playlist({ texto, genres, seeds, taste, rng = Math.random, max = 12 }) {
  const t = norm(String(texto || '').slice(0, 200));
  const dec = decada(t);
  const moods = Object.keys(MOOD_WORDS).filter((m) => MOOD_WORDS[m].test(t));
  const evitar = new Set(taste ? taste.generos.evitar : []);
  const gustan = taste ? taste.generos.gustan : [];

  const nombrados = genres.filter((g) => !evitar.has(g.id) && [norm(g.id), norm(g.label)].some((k) => k.length >= 3 && new RegExp('\\b' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(t))).slice(0, 3);
  const artistasNombrados = seeds.filter((a) => norm(a.artist).length >= 4 && t.includes(norm(a.artist))).slice(0, 3);

  let elegidos = nombrados;
  if (!elegidos.length && moods.length) {
    const candidatos = genres.filter((g) => moods.includes(g.mood) && !evitar.has(g.id));
    elegidos = weightedSample(candidatos, (g) => (g.featured ? 2 : 1) * (gustan.includes(g.id) ? 3 : 1), 4, rng);
  }
  if (!elegidos.length && !artistasNombrados.length) {
    const g = gustan.map((id) => genres.find((x) => x.id === id)).filter(Boolean);
    elegidos = g.length ? sample(g, Math.min(4, g.length), rng) : sample(genres.filter((x) => x.featured && !evitar.has(x.id)), 4, rng);
  }

  const withDec = (q) => (dec ? `${q} ${dec}`.slice(0, 140) : q.slice(0, 140));
  const consultas = [];
  const add = (query, genre) => { if (query && !consultas.some((c) => c.query === query)) consultas.push({ query, genre }); };
  for (const a of artistasNombrados) add(a.query.slice(0, 140), a.genre);
  const porGenero = Math.max(2, Math.ceil((max - consultas.length) / Math.max(1, elegidos.length)));
  for (const g of elegidos) for (const q of sample(g.queries, porGenero, rng)) { if (consultas.length < max) add(withDec(q), g.id); }
  /* si quedó corta, se completa con más del mismo estilo y luego con géneros destacados */
  for (const g of elegidos) for (const q of shuffle(g.queries, rng)) { if (consultas.length >= 6) break; add(withDec(q), g.id); }
  for (const g of sample(genres.filter((x) => x.featured && !evitar.has(x.id)), 6, rng)) { if (consultas.length >= 6) break; add(withDec(g.queries[0]), g.id); }

  const limpio = String(texto || '').replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
  const nombre = limpio.length >= 3 ? ('Mezcla: ' + limpio).slice(0, 60) : moods.length ? ('Mezcla ' + MOOD_NOMBRE[moods[0]]).slice(0, 60) : 'Mezcla para ti';
  return { nombre, descripcion: 'Armada con tus palabras y tus gustos', consultas: consultas.slice(0, max) };
}

module.exports = { franja, ahora, momento, paraTi, descubrir, artistas, podcasts, playlist, norm, sameGenre, matchesAny, weightedSample, shuffle, sample };
