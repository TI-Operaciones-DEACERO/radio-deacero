'use strict';
/* Lógica pura del panel completo (public/js/panel/logica.js): Me gusta, fusión, colas, fases de Bienestar, ánimos y pestañas. */
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../public/js/panel/logica');

/* los mapas de Me gusta no tienen prototipo: se comparan como objetos planos */
const plano = (m) => ({ ...m });
const T = (n, extra = {}) => ({ id: String(n).padStart(11, 'a'), title: 'Canción ' + n, channel: 'Canal', duration: 200, ...extra });

test('cleanTrack: solo campos conocidos; rechaza ids inválidos y no es mutable', () => {
  assert.equal(L.cleanTrack(null), null);
  assert.equal(L.cleanTrack({ id: 'corto', title: 'x' }), null);
  assert.equal(L.cleanTrack({ id: '<script>aaa', title: 'x' }), null);
  assert.equal(L.cleanTrack([1]), null);
  const t = L.cleanTrack({ ...T(1), extra: 'no', genre: 'jazz', duration: -5 });
  assert.deepEqual(t, { id: T(1).id, title: 'Canción 1', channel: 'Canal', duration: 0, genre: 'jazz' });
  assert.equal(L.cleanTrack({ ...T(1), genre: 'con espacio!' }).genre, undefined);
  assert.equal(L.cleanTrack({ ...T(1), title: 'x'.repeat(500) }).title.length, 300);
});

test('nextReaction: pulsar dos veces la misma reacción la quita; cambiar de una a otra la sustituye', () => {
  assert.equal(L.nextReaction(null, 'like'), 'like');
  assert.equal(L.nextReaction('like', 'like'), null);
  assert.equal(L.nextReaction('like', 'dislike'), 'dislike');
  assert.equal(L.nextReaction('dislike', 'dislike'), null);
});

test('setReaction: devuelve un mapa nuevo, deja el original intacto y deja la última reacción al final', () => {
  const m0 = {};
  const m1 = L.setReaction(m0, T(1), 'like', 10);
  assert.deepEqual(m0, {});
  assert.equal(L.reactionOf(m1, T(1).id), 'like');
  const m2 = L.setReaction(m1, T(1), 'dislike', 20);
  assert.equal(L.reactionOf(m2, T(1).id), 'dislike');
  assert.equal(L.reactionOf(m1, T(1).id), 'like'); /* el anterior no cambió */
  const m3 = L.setReaction(m2, T(1), null);
  assert.equal(L.reactionOf(m3, T(1).id), null);
  assert.deepEqual(Object.keys(m3), []);
  assert.deepEqual(plano(L.setReaction({}, { id: 'mal' }, 'like')), {}); /* canción inválida: no hace nada */
});

test('UI optimista: se revierte con restoreEntry si el servidor falla', () => {
  const base = L.setReaction({}, T(1), 'like', 5);
  const previa = base[T(1).id];
  const optimista = L.setReaction(base, T(1), L.nextReaction('like', 'dislike'), 9);
  assert.equal(L.reactionOf(optimista, T(1).id), 'dislike');
  const vuelta = L.restoreEntry(optimista, T(1).id, previa);
  assert.deepEqual(vuelta, base);
  /* si no había nada antes, revertir la quita */
  const nuevo = L.setReaction({}, T(2), 'like', 1);
  assert.deepEqual(plano(L.restoreEntry(nuevo, T(2).id, undefined)), {});
});

test('setReaction: tope de 2000, se van las más viejas', () => {
  let m = {};
  for (let i = 0; i < 2003; i++) m = L.setReaction(m, T(i), 'like', i);
  assert.equal(Object.keys(m).length, 2000);
  assert.equal(m[T(0).id], undefined);
  assert.ok(m[T(2002).id]);
});

test('listByReaction: filtra por tipo y ordena de más reciente a más vieja', () => {
  let m = {};
  m = L.setReaction(m, T(1), 'like', 1);
  m = L.setReaction(m, T(2), 'dislike', 2);
  m = L.setReaction(m, T(3), 'like', 3);
  assert.deepEqual(L.listByReaction(m, 'like').map((x) => x.track.title), ['Canción 3', 'Canción 1']);
  assert.deepEqual(L.listByReaction(m, 'dislike').map((x) => x.track.title), ['Canción 2']);
  assert.deepEqual(L.listByReaction(null, 'like'), []);
});

test('guardado local: serializar y leer de vuelta; la basura no rompe nada', () => {
  let m = L.setReaction({}, T(1, { genre: 'jazz' }), 'like', 7);
  m = L.setReaction(m, T(2), 'dislike', 8);
  const back = L.parseLocalLikes(L.serializeLikes(m));
  assert.deepEqual(back, m);
  for (const basura of ['', 'no es json', '{"a":1}', '[1,2,3]', '[{"r":"like","track":{"id":"x"}}]', 'null']) assert.deepEqual(plano(L.parseLocalLikes(basura)), {});
  assert.deepEqual(plano(L.parseLocalLikes('[{"r":"love","track":{"id":"aaaaaaaaaaa","title":"x"}}]')), {}); /* reacción desconocida */
});

test('fusión: lo local se manda a la cuenta (lo más reciente primero, máx. 500) y lo de la cuenta manda', () => {
  let local = {};
  for (let i = 0; i < 510; i++) local = L.setReaction(local, T(i), i % 2 ? 'like' : 'dislike', i);
  const items = L.toMergeItems(local);
  assert.equal(items.length, 500);
  assert.deepEqual(items[0].track, local[T(509).id].track);
  assert.deepEqual(Object.keys(items[0]).sort(), ['r', 'track']);
  const cuenta = { [T(1).id]: { r: 'dislike', at: 99, track: L.cleanTrack(T(1)) } };
  const unido = L.mergeLocalWithAccount({ [T(1).id]: { r: 'like', at: 1, track: L.cleanTrack(T(1)) }, [T(2).id]: { r: 'like', at: 2, track: L.cleanTrack(T(2)) } }, cuenta);
  assert.equal(unido[T(1).id].r, 'dislike'); /* gana la cuenta */
  assert.equal(unido[T(2).id].r, 'like'); /* lo local que no estaba, se conserva */
});

test('fromServerList: acepta lo que responde GET /api/me/reactions y descarta lo raro', () => {
  const m = L.fromServerList([{ r: 'like', at: 5, track: T(1) }, { r: 'x', at: 1, track: T(2) }, { r: 'dislike', track: { id: 'mal' } }, null]);
  assert.deepEqual(Object.keys(m), [T(1).id]);
  assert.deepEqual(plano(L.fromServerList('no')), {});
});

test('shouldLogHistory: una vez por canción', () => {
  assert.equal(L.shouldLogHistory('', T(1)), true);
  assert.equal(L.shouldLogHistory(T(1).id, T(1)), false);
  assert.equal(L.shouldLogHistory(T(1).id, T(2)), true);
  assert.equal(L.shouldLogHistory('', null), false);
  assert.equal(L.shouldLogHistory('', { id: 'corto' }), false);
});

test('trackConGenero: la canción que suena con el id de su género, o null si no hay', () => {
  assert.equal(L.trackConGenero(null), null);
  assert.equal(L.trackConGenero({ track: null }), null);
  assert.equal(L.trackConGenero({ track: { id: 'mal' } }), null);
  assert.deepEqual(L.trackConGenero({ track: T(1), genre: { id: 'jazz', label: 'Jazz' } }), { ...L.cleanTrack(T(1)), genre: 'jazz' });
});

test('queueFromTracks: empieza en la elegida, limpia y topa en 200', () => {
  const tracks = Array.from({ length: 300 }, (_, i) => T(i));
  const q = L.queueFromTracks(tracks, T(5).id);
  assert.equal(q.cmd, 'queue');
  assert.equal(q.items.length, 200);
  assert.equal(q.items[0].track.id, T(5).id);
  assert.equal(L.queueFromTracks(tracks, 'noexiste__1').items[0].track.id, T(0).id); /* id desconocido: desde el principio */
  assert.deepEqual(L.queueFromTracks([T(1), { id: 'mal' }, { ...T(2), title: '' }]).items.map((i) => i.track.id), [T(1).id]);
  assert.deepEqual(L.queueFromTracks(null).items, []);
});

test('queueFromQueries: consultas de la playlist IA → items con q; ignora vacías y recorta a 100', () => {
  const q = L.queueFromQueries([{ query: ' Soda Stereo ' }, { query: '' }, { query: 'x'.repeat(300) }, 'Zoé', null, { genre: 'rock' }]);
  assert.equal(q.cmd, 'queue');
  assert.deepEqual(q.items.map((i) => i.q.length), [11, 100, 3]);
  assert.equal(q.items[0].q, 'Soda Stereo');
});

test('energía: porcentaje redondeado y acotado', () => {
  assert.equal(L.energiaTexto(0.85), '85 %');
  assert.equal(L.energiaAncho(0.3), '30%');
  assert.equal(L.energiaTexto(2), '100 %');
  assert.equal(L.energiaTexto(-1), '0 %');
  assert.equal(L.energiaTexto(undefined), '0 %');
});

const PLAN = {
  temasPorFase: 3,
  fases: [1, 2, 3, 4, 5].map((n) => ({ n, nombre: 'Fase' + n, energia: 0.9 - n * 0.1, generos: [{ id: 'jazz', label: 'Jazz' }] }))
};

test('estadoViaje: fase y tema actuales según getState().viaje', () => {
  assert.equal(L.estadoViaje(null, {}), null);
  assert.equal(L.estadoViaje({ fases: [] }, {}), null);
  const sin = L.estadoViaje(PLAN, null);
  assert.equal(sin.activo, false);
  assert.equal(sin.total, 5);
  const e = L.estadoViaje(PLAN, { fase: 2, tema: 1, porFase: 3, continuando: false, energia: 0.6, nombre: 'Despertar' });
  assert.deepEqual({ a: e.activo, i: e.faseIdx, t: e.tema, p: e.porFase, fin: e.terminado, n: e.nombre, en: e.energia }, { a: true, i: 1, t: 1, p: 3, fin: false, n: 'Despertar', en: 0.6 });
  assert.equal(L.resumenFase(e), 'Fase 2 de 5 · Despertar · Canción 1 de 3');
});

test('estadoViaje: al terminar la fase 5 queda "terminado" (la música continúa) y no se sale de rango', () => {
  const e = L.estadoViaje(PLAN, { fase: 5, tema: 7, porFase: 3, continuando: true, energia: 0.4, nombre: 'Descansar' });
  assert.equal(e.terminado, true);
  assert.equal(e.faseIdx, 4);
  assert.match(L.resumenFase(e), /continúa/);
  assert.equal(L.estadoViaje(PLAN, { fase: 99, continuando: true }).faseIdx, 4);
  assert.equal(L.estadoViaje(PLAN, { fase: 0 }).faseIdx, 0);
  assert.equal(L.resumenFase(L.estadoViaje(PLAN, null)), '');
});

test('armarPeticionViaje: usa el ánimo si lo hay; si no, el texto; omite lo vacío', () => {
  assert.deepEqual(L.armarPeticionViaje({ estado: 'triste', texto: 'hola', destino: '', intensidad: 'media', duracion: 'larga', estilo: 'ninguno', idioma: '' }), { estado: 'triste', intensidad: 'media', duracion: 'larga', estilo: 'ninguno' });
  assert.deepEqual(L.armarPeticionViaje({ estado: '', texto: '  ando muy cansado  ', destino: 'dormir' }), { texto: 'ando muy cansado', destino: 'dormir' });
  assert.equal(L.armarPeticionViaje({ texto: 'x'.repeat(500) }).texto.length, 300);
  assert.deepEqual(L.armarPeticionViaje(null), {});
  assert.deepEqual(L.armarPeticionViaje({ estado: 5, destino: 7 }), {});
  assert.equal(L.peticionValida({}), false);
  assert.equal(L.peticionValida({ destino: 'dormir' }), false);
  assert.equal(L.peticionValida({ texto: 'x' }), true);
});

test('topAnimos: los más usados primero, completa con los de siempre, sin repetir ni inventar', () => {
  const validos = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const porOmision = ['a', 'b', 'c', 'd', 'e', 'f'];
  assert.deepEqual(L.topAnimos({}, porOmision, validos), ['a', 'b', 'c', 'd', 'e', 'f']);
  assert.deepEqual(L.topAnimos({ h: 5, c: 2, zzz: 99 }, porOmision, validos), ['h', 'c', 'a', 'b', 'd', 'e']);
  assert.deepEqual(L.topAnimos({ g: 3, h: 3 }, porOmision, validos, 3), ['g', 'h', 'a']); /* empate: orden estable */
  assert.deepEqual(L.topAnimos(null, porOmision, validos, 2), ['a', 'b']);
  assert.deepEqual(plano(L.sumarUso({ a: 1 }, 'a')), { a: 2 });
  const u = { a: 1 }; L.sumarUso(u, 'b'); assert.deepEqual(u, { a: 1 });
});

test('fuenteTexto: solo se dice cuando lo sugirió la IA (las reglas locales no se anuncian: era ruido técnico)', () => {
  assert.equal(L.fuenteTexto('gemini'), 'Sugerido por IA');
  assert.equal(L.fuenteTexto('local'), '');
  assert.equal(L.fuenteTexto(undefined), '');
});

test('avanceFase: dice cuánto falta para la siguiente fase o para el destino', () => {
  const en = (fase, tema) => L.estadoViaje(PLAN, { fase, tema, porFase: 3, continuando: false, nombre: 'F' });
  assert.equal(L.avanceFase(en(2, 1)), 'Faltan 2 canciones para pasar a la fase 3');
  assert.equal(L.avanceFase(en(2, 2)), 'Falta 1 canción para pasar a la fase 3');
  assert.equal(L.avanceFase(en(2, 3)), 'Al terminar esta canción pasas a la fase 3');
  assert.equal(L.avanceFase(en(5, 1)), 'Faltan 2 canciones para llegar a tu destino');
  assert.equal(L.avanceFase(en(5, 3)), 'Al terminar esta canción llegas a tu destino');
  assert.equal(L.avanceFase(L.estadoViaje(PLAN, { fase: 5, continuando: true })), '');
  assert.equal(L.avanceFase(L.estadoViaje(PLAN, null)), '');
  assert.equal(L.avanceFase(null), '');
});

test('estadoFase: cuántas canciones dura cada fase y en cuál vas', () => {
  const ev = L.estadoViaje(PLAN, { fase: 2, tema: 2, porFase: 3, continuando: false, nombre: 'F' });
  assert.equal(L.estadoFase(ev, 0, 3), 'Lista');
  assert.equal(L.estadoFase(ev, 1, 3), 'Canción 2 de 3');
  assert.equal(L.estadoFase(ev, 2, 3), '3 canciones');
  assert.equal(L.estadoFase(L.estadoViaje(PLAN, null), 0, 3), '3 canciones');
  assert.equal(L.estadoFase(L.estadoViaje(PLAN, null), 0, 1), '1 canción');
  assert.equal(L.estadoFase(L.estadoViaje(PLAN, { fase: 5, continuando: true }), 4, 3), 'Lista');
  assert.equal(L.estadoFase(L.estadoViaje(PLAN, null), 0, 0), 'Pendiente');
});

test('nextTabIndex: flechas con vuelta, Inicio y Fin; otras teclas no hacen nada', () => {
  assert.equal(L.nextTabIndex('ArrowRight', 0, 4), 1);
  assert.equal(L.nextTabIndex('ArrowRight', 3, 4), 0);
  assert.equal(L.nextTabIndex('ArrowLeft', 0, 4), 3);
  assert.equal(L.nextTabIndex('ArrowLeft', 2, 4), 1);
  assert.equal(L.nextTabIndex('Home', 2, 4), 0);
  assert.equal(L.nextTabIndex('End', 0, 4), 3);
  assert.equal(L.nextTabIndex('ArrowDown', 0, 4), -1);
  assert.equal(L.nextTabIndex('Enter', 0, 4), -1);
  assert.equal(L.nextTabIndex('ArrowRight', 0, 0), -1);
});

test('mensajeError: amable según el estado', () => {
  assert.match(L.mensajeError(0), /conexión/);
  assert.match(L.mensajeError(401), /nómina/);
  assert.match(L.mensajeError(429), /Demasiadas/);
  assert.match(L.mensajeError(500), /Inténtalo/);
});

test('sid: validación y generación con el mismo formato que usa /panel', () => {
  const sid = L.makeSid(new Uint8Array(12).fill(171));
  assert.equal(sid, 'ab'.repeat(12));
  assert.equal(L.validSid(sid), true);
  assert.equal(L.validSid('corto'), false);
  assert.equal(L.validSid('con espacio aaaaaaaa'), false);
  assert.equal(L.validSid(null), false);
});

test('ids que chocan con Object.prototype ("constructor" mide 11 caracteres y es un id válido) no rompen los mapas', () => {
  const raro = { id: 'constructor', title: 'Rara', channel: 'x', duration: 10 };
  assert.ok(L.cleanTrack(raro), 'pasa la validación de id');
  const vacio = {};
  assert.equal(L.reactionOf(vacio, 'constructor'), null); /* con un {} normal daría la función Object */
  assert.equal(L.reactionOf(L.setReaction({}, T(1), 'like'), 'constructor'), null);
  let m = L.setReaction({}, raro, 'like', 5);
  assert.equal(L.reactionOf(m, 'constructor'), 'like');
  assert.equal(Object.getPrototypeOf(m), null);
  assert.equal(L.nextReaction(L.reactionOf(m, 'constructor'), 'like'), null);
  m = L.setReaction(m, raro, null);
  assert.equal(L.reactionOf(m, 'constructor'), null);
  assert.equal(Object.keys(m).length, 0);
  const viaServidor = L.fromServerList([{ r: 'dislike', at: 1, track: raro }]);
  assert.equal(L.reactionOf(viaServidor, 'constructor'), 'dislike');
  assert.equal(L.reactionOf(L.mergeLocalWithAccount({}, viaServidor), 'constructor'), 'dislike');
  assert.equal(L.reactionOf(L.restoreEntry(viaServidor, 'constructor', undefined), 'constructor'), null);
  assert.deepEqual(L.listByReaction(viaServidor, 'dislike').map((x) => x.track.id), ['constructor']);
  assert.deepEqual(L.parseLocalLikes(L.serializeLikes(viaServidor))['constructor'].r, 'dislike');
});

test('sumarUso y topAnimos: un id como "constructor" no usa el prototipo', () => {
  const u = L.sumarUso({}, 'constructor');
  assert.equal(u.constructor, 1);
  assert.equal(L.sumarUso(u, 'constructor').constructor, 2);
  assert.deepEqual(L.topAnimos({}, ['a', 'b'], ['a', 'b', 'constructor'], 2), ['a', 'b']);
  assert.deepEqual(L.topAnimos(JSON.parse('{\"constructor\":3}'), ['a', 'b'], ['a', 'b', 'constructor'], 2), ['constructor', 'a']);
});
