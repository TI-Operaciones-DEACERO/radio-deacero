'use strict';
/* bienestar.js — Viaje ISO: empezar donde está la persona y llevarla poco a poco a donde quiere llegar. Funciones puras, sin red
 * ni IA: lo que decide es la energía (0–1) de cada género (data/genres.json) y la curva de 5 fases. Con la misma semilla da el mismo plan.
 * La reproducción la hace el radio en modo `viaje` (radio.js), una sesión por oyente. */

const plain = (s) => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

/* energía = qué tan activo está el ánimo (0–1); kw = pistas para reconocerlo en texto libre */
const ANIMOS = [
  { id: 'estresado', label: 'Estresado', emoji: '😰', grupo: 'Para calmar', energia: 0.85, kw: /estres|tension|presion/ },
  { id: 'ansioso', label: 'Ansioso', emoji: '😟', grupo: 'Para calmar', energia: 0.8, kw: /ansios|nervios|inquiet|preocup/ },
  { id: 'frustrado', label: 'Frustrado', emoji: '😤', grupo: 'Para calmar', energia: 0.75, kw: /frustr|irrit|molest|harto/ },
  { id: 'triste', label: 'Triste', emoji: '😢', grupo: 'Para calmar', energia: 0.25, kw: /trist|melanc|llor|deprim|desanim/ },
  { id: 'abrumado', label: 'Abrumado', emoji: '😨', grupo: 'Para calmar', energia: 0.7, kw: /abruma|agobi|sobrepasad|demasiad/ },
  { id: 'enojado', label: 'Enojado', emoji: '😠', grupo: 'Para calmar', energia: 0.85, kw: /enoj|enfad|furios|rabia|coraje/ },
  { id: 'agotado', label: 'Agotado', emoji: '😴', grupo: 'Para activar', energia: 0.12, kw: /agotad|cansad|fatiga|sin energia|rendid|sueno/ },
  { id: 'sin-animo', label: 'Sin ánimo', emoji: '😐', grupo: 'Para activar', energia: 0.2, kw: /sin animo|desmotiv|sin ganas|flojera|desgana/ },
  { id: 'aburrido', label: 'Aburrido', emoji: '🥱', grupo: 'Para activar', energia: 0.3, kw: /aburr|monoton|tedio/ },
  { id: 'disperso', label: 'Disperso', emoji: '🌀', grupo: 'Para activar', energia: 0.5, kw: /dispers|distraid|no me concentro|sin poder concentr/ },
  { id: 'bloqueado', label: 'Bloqueado', emoji: '🧊', grupo: 'Para activar', energia: 0.35, kw: /bloquead|trabad|no puedo arrancar|estancad/ },
  { id: 'apatico', label: 'Apático', emoji: '😶', grupo: 'Para activar', energia: 0.25, kw: /apatic|indiferen|nada me emociona/ },
  { id: 'tranquilo', label: 'Tranquilo', emoji: '😌', grupo: 'Para acompañar', energia: 0.3, kw: /tranquil|calma|relajad|en paz/ },
  { id: 'enfocado', label: 'Enfocado', emoji: '🎯', grupo: 'Para acompañar', energia: 0.55, kw: /enfocad|concentrad/ },
  { id: 'contento', label: 'Contento', emoji: '😊', grupo: 'Para acompañar', energia: 0.7, kw: /content|feliz|alegre|buen humor|bien/ },
  { id: 'motivado', label: 'Motivado', emoji: '🚀', grupo: 'Para acompañar', energia: 0.8, kw: /motivad|con impulso|con ganas|entusias/ },
  { id: 'nostalgico', label: 'Nostálgico', emoji: '🥰', grupo: 'Para acompañar', energia: 0.4, kw: /nostalg|sentimental|extrano|recuerd/ },
  { id: 'con-energia', label: 'Con energía', emoji: '⚡', grupo: 'Para acompañar', energia: 0.9, kw: /con energia|energico|pila|hiperactiv/ }
];

const DESTINOS = [
  { id: 'relajar', label: 'Relajarme', emoji: '😌', energia: 0.3 },
  { id: 'concentrar', label: 'Concentrarme', emoji: '🎯', energia: 0.55 },
  { id: 'energia', label: 'Con energía', emoji: '⚡', energia: 0.9 },
  { id: 'animo', label: 'Buen ánimo', emoji: '😊', energia: 0.75 },
  { id: 'dormir', label: 'Dormir', emoji: '🌙', energia: 0.1 },
  { id: 'fluir', label: 'Fluir', emoji: '🌊', energia: 0.65 }
];

const LATINO = /latin|salsa|bachata|cumbia|reggaeton|bolero|ranchera|mariachi|banda|norte|tropical|vallenato|merengue|bossa|trova|regional|corrido|mexic|tango|flamenco|sertanejo|samba|forro|brasil|colombia|argent|espan/;
const ESTILOS = [
  { id: 'ninguno', label: 'Sin preferencia', re: null },
  { id: 'instrumental', label: 'Instrumental / Lo-fi', re: /instrument|lofi|lo fi|ambient|chillhop|study|downtempo|meditat|drone|new age/ },
  { id: 'piano', label: 'Piano / Acústico', re: /piano|acoust|acust|guitar|folk|singer|unplugged/ },
  { id: 'latino', label: 'Latino', re: LATINO },
  { id: 'cumbia', label: 'Cumbia / Tropical', re: /cumbia|tropical|salsa|bachata|merengue|vallenato|mambo|timba/ },
  { id: 'pop-rock', label: 'Pop / Rock', re: /\bpop\b|rock|indie|alternativ|punk|grunge/ },
  { id: 'rnb', label: 'R&B / Chill', re: /r&b|rnb|soul|chill|funk|motown/ },
  { id: 'electronica', label: 'Electrónica', re: /electr|house|techno|trance|edm|downtempo|ambient|synth|chillwave|idm|dub/ },
  { id: 'clasica', label: 'Clásica', re: /clasic|classical|orquest|baroc|opera|concerto|symphon|sinfon|neoclassic/ },
  { id: 'naturaleza', label: 'Naturaleza', re: /natur|ambient|sound|rain|ocean|forest|spa|meditat|zen|healing/ },
  { id: 'jazz', label: 'Jazz / Soul', re: /jazz|soul|blues|bossa|swing|bebop/ }
];
const IDIOMAS = [
  { id: 'espanol', label: 'Español', test: (t) => LATINO.test(t) },
  { id: 'ingles', label: 'Inglés', test: (t) => !LATINO.test(t) },
  { id: 'instrumental', label: 'Instrumental', test: (t) => /instrument|lofi|lo fi|ambient|piano|clasic|classical|study|focus|meditat|nature|sound|orquest|jazz|chillhop|downtempo/.test(t) }
];
const DURACIONES = [{ id: 'corta', label: 'Corta', temas: 2, hint: '~10 temas' }, { id: 'media', label: 'Media', temas: 3, hint: '~15 temas' }, { id: 'larga', label: 'Larga', temas: 5, hint: '~25 temas' }];
const INTENSIDADES = [{ id: 'suave', label: 'Suave', hint: 'relajar' }, { id: 'media', label: 'Media', hint: 'equilibrio' }, { id: 'intensa', label: 'Intensa', hint: 'activar' }];

/* Forma de la curva: suave se queda más tiempo cerca del origen, intensa se mueve rápido al principio. */
const FORMA = { suave: (t) => Math.pow(t, 1.6), media: (t) => t, intensa: (t) => Math.pow(t, 0.6) };

const NOMBRES = {
  baja: ['Reconocer', 'Aflojar', 'Soltar', 'Calmar', 'Descansar'],
  sube: ['Reconocer', 'Despertar', 'Activar', 'Impulsar', 'Brillar'],
  igual: ['Reconocer', 'Asentar', 'Fluir', 'Profundizar', 'Mantener']
};
const CIERRES = [
  'Llegaste. Si quieres, la música sigue contigo en este mismo punto.',
  'Viaje completo. Seguimos en esta energía mientras la necesites.',
  'Buen trayecto. La música continúa aquí, sin prisa.',
  'Destino alcanzado. Puedes quedarte en este ritmo todo el tiempo que quieras.'
];

const byId = (list, id) => (typeof id === 'string' ? list.find((x) => x.id === id) : undefined);
const opcion = (list, id, def) => byId(list, id) || byId(list, def);

const opciones = () => ({
  animos: ANIMOS.map(({ id, label, emoji, grupo }) => ({ id, label, emoji, grupo })),
  destinos: DESTINOS.map(({ id, label, emoji }) => ({ id, label, emoji })),
  estilos: ESTILOS.map(({ id, label }) => ({ id, label })),
  idiomas: IDIOMAS.map(({ id, label }) => ({ id, label })),
  duraciones: DURACIONES.map(({ id, label, hint }) => ({ id, label, hint })),
  intensidades: INTENSIDADES.map(({ id, label, hint }) => ({ id, label, hint }))
});

/* Texto libre → id de ánimo (o null). */
function animoDeTexto(texto) {
  const t = plain(texto).slice(0, 300);
  if (!t.trim()) return null;
  const a = ANIMOS.find((x) => x.kw.test(t));
  return a ? a.id : null;
}

/* Muestra n sin repetir, con probabilidad proporcional al peso. */
function weightedSample(items, weight, n, rng) {
  const pool = items.map((x) => ({ x, w: Math.max(1e-4, weight(x)) }));
  const out = [];
  while (out.length < n && pool.length) {
    let r = rng() * pool.reduce((s, p) => s + p.w, 0);
    let i = 0;
    for (; i < pool.length - 1; i++) { r -= pool[i].w; if (r <= 0) break; }
    out.push(pool.splice(i, 1)[0].x);
  }
  return out;
}

const textoDe = (g) => plain(`${g.id} ${g.label} ${g.desc || ''}`);

/* Géneros de una fase: cerca de su energía, del estilo e idioma pedidos, distintos de los de la fase anterior.
 * Orden de relajación: ampliar tolerancia → quitar idioma → quitar estilo (cada paso se avisa en el plan). */
function generosDeFase({ target, genres, taste, estilo, idioma, prev, rng, avisos }) {
  const evitar = new Set(taste.generos.evitar);
  const gustan = new Set(taste.generos.gustan);
  const libres = genres.filter((g) => !evitar.has(g.id) && !prev.has(g.id) && Number.isFinite(g.energy));
  const etapas = [
    { e: estilo, i: idioma, tols: [0.12, 0.2, 0.3] },
    { e: estilo, i: null, tols: [0.12, 0.2, 0.3], aviso: 'No hay suficiente música de ese idioma en esta parte del viaje: usamos géneros afines.' },
    { e: null, i: null, tols: [0.12, 0.2, 0.3, 0.45, 1], aviso: 'No hay suficiente música tranquila de ese estilo: usamos géneros afines.' }
  ];
  for (const et of etapas) {
    for (const tol of et.tols) {
      const pool = libres.filter((g) => Math.abs(g.energy - target) <= tol && (!et.e || et.e.re.test(textoDe(g))) && (!et.i || et.i(textoDe(g))));
      if (pool.length >= 2) {
        if (et.aviso && !avisos.includes(et.aviso)) avisos.push(et.aviso);
        const w = (g) => (g.featured ? 1.5 : 1) * (gustan.has(g.id) ? 3 : 1) / (0.05 + Math.abs(g.energy - target));
        return weightedSample(pool, w, 4, rng);
      }
    }
  }
  return weightedSample(libres, () => 1, 4, rng); /* inalcanzable en la práctica: siempre hay géneros libres */
}

function planViaje({ estado, texto, destino, intensidad, duracion, estilo, idioma, genres, taste, rng = Math.random }) {
  const animo = opcion(ANIMOS, estado || animoDeTexto(texto), 'tranquilo');
  const dest = byId(DESTINOS, destino);
  const inten = opcion(INTENSIDADES, intensidad, 'media');
  const dur = opcion(DURACIONES, duracion, 'media');
  const est = byId(ESTILOS, estilo);
  const idi = byId(IDIOMAS, idioma);
  const tst = taste || { generos: { gustan: [], evitar: [] }, artistas: { gustan: [], evitar: [] }, total: 0 };

  /* El ánimo se acerca a lo que pide la música (compresión hacia el centro: un estresado no arranca con música frenética). */
  const inicio = 0.5 + (animo.energia - 0.5) * 0.7;
  let fin = dest ? dest.energia : 0.65;
  const dir = fin >= inicio ? 1 : -1;
  if (inten.id === 'intensa') fin = clamp(fin + dir * 0.05, 0.08, 0.98);
  const forma = FORMA[inten.id];
  const energias = [0, 1, 2, 3, 4].map((i) => clamp(inicio + (fin - inicio) * forma(i / 4), 0, 1));

  const avisos = [];
  const fases = [];
  let prev = new Set();
  const tipo = Math.abs(fin - inicio) < 0.15 ? 'igual' : dir > 0 ? 'sube' : 'baja';
  for (let i = 0; i < 5; i++) {
    const gs = generosDeFase({ target: energias[i], genres, taste: tst, estilo: est && est.re ? est : null, idioma: idi ? idi.test : null, prev, rng, avisos });
    prev = new Set(gs.map((g) => g.id));
    fases.push({ n: i + 1, nombre: NOMBRES[tipo][i], energia: Math.round(energias[i] * 1000) / 1000, generos: gs.map((g) => ({ id: g.id, label: g.label, emoji: g.emoji, color: g.color, energy: g.energy })) });
  }

  const verbo = tipo === 'igual' ? 'nos mantenemos' : tipo === 'sube' ? 'subimos' : 'bajamos';
  return {
    animo: { id: animo.id, label: animo.label, emoji: animo.emoji, grupo: animo.grupo },
    destino: dest ? { id: dest.id, label: dest.label, emoji: dest.emoji, energia: dest.energia } : null,
    intensidad: inten.id, duracion: dur.id, estilo: est ? est.id : 'ninguno', idioma: idi ? idi.id : null,
    temasPorFase: dur.temas,
    analisis: `Te sientes ${animo.label.toLowerCase()}. Empezamos cerca de ese ritmo (${Math.round(energias[0] * 100)} % de energía) y ${verbo} poco a poco${dest ? ' hacia ' + dest.label.toLowerCase() : ''}.`,
    cierre: CIERRES[Math.floor(rng() * CIERRES.length)],
    avisos,
    fases
  };
}

/* Tras la última fase la música NO se corta: se sigue con géneros de esa energía final. */
function generosContinuacion(plan, genres, taste) {
  const fin = plan.fases[plan.fases.length - 1].energia;
  const evitar = new Set(taste ? taste.generos.evitar : []);
  const libres = genres.filter((g) => !evitar.has(g.id) && Number.isFinite(g.energy));
  for (const tol of [0.12, 0.2, 0.3, 0.45]) {
    const c = libres.filter((g) => Math.abs(g.energy - fin) <= tol);
    if (c.length >= 8 || tol === 0.45) return c.sort((a, b) => Math.abs(a.energy - fin) - Math.abs(b.energy - fin)).slice(0, 12);
  }
  return libres.slice(0, 12);
}

/* Firma de un título para no repetir "la misma canción" con otro sufijo: (En vivo), (Remaster), [Official Video], ft. X... */
function firma(titulo) {
  let t = plain(titulo).replace(/\([^)]*\)|\[[^\]]*\]/g, ' ');
  t = t.replace(/\s[-–—|]\s.*(remaster|live|en vivo|official|audio|video|version|lyric|letra|hd|mix).*$/i, ' ');
  t = t.replace(/\b(ft|feat|featuring)\b.*$/i, ' ');
  return t.replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

module.exports = { opciones, animoDeTexto, planViaje, generosContinuacion, firma, ANIMOS, DESTINOS };
