'use strict';
/* Panel: lo que la persona elige marca lo que sigue. Tras una búsqueda o una canción concreta, «siguiente» trae música PARECIDA (racha de esa
 * búsqueda / artista), no lo que sonaba antes. Lo que pide ahora gana a lo que el reproductor había pedido por adelantado. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRadio } = require('../src/radio');

const genres = ['a', 'b', 'c'].map((id) => ({ id, label: id, emoji: 'x', color: '#000', featured: true, queries: [id] }));
let n = 0;
const id11 = (s) => (s.replace(/[^a-z]/gi, '') + String(++n).padStart(11, '0')).slice(-11);
const mkSearch = () => async (q, k = 5) => Array.from({ length: Math.min(k, 8) }, () => ({ id: id11(q), title: q + ' tema ' + n, channel: q, duration: 200 }));
const SID = 'oyente-semilla-1';

test('oyente: después de una búsqueda, «siguiente» sigue con esa búsqueda (racha), no con el género anterior', async () => {
  const r = createRadio({ genres, search: mkSearch(), rng: () => 0 });
  await r.next({ session: SID, genre: 'a' });
  const b = await r.next({ session: SID, query: 'luis miguel' });
  assert.match(b.track.title, /luis miguel/);
  const sig = await r.next({ session: SID });
  assert.match(sig.track.title, /luis miguel/, 'la siguiente sale de la misma búsqueda');
  assert.notEqual(sig.track.id, b.track.id);
  assert.equal(sig.genre.label, 'luis miguel');
  assert.ok(Number.isInteger(sig.genreLeft), 'hay racha');
});

test('oyente: semilla (canción elegida) → las siguientes salen de esa semilla; al acabar la racha vuelve la rotación', async () => {
  const r = createRadio({ genres, search: mkSearch(), rng: () => 0, perGenre: [2, 2] });
  const x = await r.next({ session: SID, semilla: 'Selena Gomez' });
  assert.match(x.track.title, /Selena Gomez/);
  assert.equal(x.genreLeft, 1);
  const y = await r.next({ session: SID });
  assert.match(y.track.title, /Selena Gomez/);
  const z = await r.next({ session: SID });
  assert.ok(genres.some((g) => g.id === z.genre.id), 'terminada la racha, sigue la radio');
});

test('pedir un género termina la racha de la semilla', async () => {
  const r = createRadio({ genres, search: mkSearch(), rng: () => 0 });
  await r.next({ session: SID, semilla: 'Shakira' });
  const g = await r.next({ session: SID, genre: 'b' });
  assert.equal(g.genre.id, 'b');
  assert.equal((await r.next({ session: SID })).genre.id, 'b');
});

test('pantallas (sin sesión): la búsqueda sigue siendo pauta única (la lista sigue como iba)', async () => {
  const r = createRadio({ genres, search: mkSearch(), rng: () => 0 });
  await r.next({ genre: 'a' });
  await r.next({ query: 'algo' });
  assert.equal((await r.next({})).genre.id, 'a');
});

test('lo que se pide ahora gana: las peticiones «siguiente» que esperaban en fila se descartan (STALE)', async () => {
  let soltar;
  const freno = new Promise((res) => { soltar = res; });
  const base = mkSearch();
  let primera = true;
  const search = async (q, k) => { if (primera) { primera = false; await freno; } return base(q, k); };
  const r = createRadio({ genres, search, rng: () => 0 });
  const p1 = r.next({ session: SID });            /* en curso (busca lento) */
  await new Promise((res) => setImmediate(res));  /* ya empezó: está buscando */
  const p2 = r.next({ session: SID });            /* precarga en fila */
  const p3 = r.next({ session: SID });            /* precarga en fila */
  const pg = r.next({ session: SID, genre: 'c' }); /* lo que la persona pidió */
  soltar();
  await p1;
  await assert.rejects(p2, (e) => e.code === 'STALE');
  await assert.rejects(p3, (e) => e.code === 'STALE');
  assert.equal((await pg).genre.id, 'c');
  assert.equal((await r.next({ session: SID })).genre.id, 'c', 'después de lo pedido, las nuevas peticiones sí se atienden');
});

test('oyente: se comprueban varias canciones A LA VEZ (no una tras otra)', async () => {
  let activas = 0, maxActivas = 0;
  const probe = async (id) => { activas++; maxActivas = Math.max(maxActivas, activas); await new Promise((r) => setTimeout(r, 40)); activas--; return !id.startsWith('mala'); };
  const search = async () => [
    { id: 'mala0000001', title: 'm1', duration: 100 }, { id: 'mala0000002', title: 'm2', duration: 100 },
    { id: 'buena000001', title: 'b1', duration: 100 }, { id: 'buena000002', title: 'b2', duration: 100 }];
  const r = createRadio({ genres: genres.slice(0, 1), search, probe, rng: () => 0 });
  const t0 = Date.now();
  const x = await r.next({ session: SID, genre: 'a' });
  assert.match(x.track.id, /^buena/);
  assert.ok(maxActivas >= 2, 'comprobaciones en paralelo');
  assert.ok(Date.now() - t0 < 110, 'tarda como UNA comprobación, no como tres');
});
