'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRadio } = require('../src/radio');

/* rng determinista (LCG) para que los tests no sean aleatorios */
function seeded(seed = 7) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
}

const mkGenres = (n) => Array.from({ length: n }, (_, i) => ({
  id: `g${i + 1}`, label: `Género ${i + 1}`, emoji: '🎵', color: '#fff', featured: true, queries: [`q-g${i + 1}`]
}));

/* search falso: 10 canciones fijas por consulta (se agotan al repetir la consulta) */
const mkSearch = () => async (q) =>
  Array.from({ length: 10 }, (_, i) => ({ id: `${q}-${i}`, title: `T ${q} ${i}`, channel: 'C', duration: 200 }));

/* search falso con catálogo "infinito": cada llamada trae canciones nuevas */
const mkEndlessSearch = () => {
  let n = 0;
  return async (q) => {
    n++;
    return Array.from({ length: 10 }, (_, i) => ({ id: `${q}-${n}-${i}`, title: `T ${q} ${n} ${i}`, channel: 'C', duration: 200 }));
  };
};

async function take(radio, n, opts) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(await radio.next(i === 0 ? opts : undefined));
  return out;
}

test('cambia de género cada 4–6 canciones', async () => {
  const radio = createRadio({ genres: mkGenres(8), search: mkSearch(), rng: seeded() });
  const seq = (await take(radio, 60)).map((r) => r.genre.id);

  const runs = [];
  for (const g of seq) {
    if (runs.length && runs.at(-1).g === g) runs.at(-1).n++;
    else runs.push({ g, n: 1 });
  }
  assert.ok(runs.length >= 8, `hubo ${runs.length} tramos`);
  for (const r of runs.slice(0, -1)) assert.ok(r.n >= 4 && r.n <= 6, `tramo de ${r.n}`);
});

test('un género nuevo no repite ninguno de los 3 anteriores', async () => {
  const radio = createRadio({ genres: mkGenres(8), search: mkEndlessSearch(), rng: seeded(3) });
  const seq = (await take(radio, 80)).map((r) => r.genre.id);
  const order = seq.filter((g, i) => i === 0 || g !== seq[i - 1]);
  for (let i = 3; i < order.length; i++) {
    assert.ok(!order.slice(i - 3, i).includes(order[i]), `${order[i]} repetido en ${order.slice(i - 3, i)}`);
  }
});

test('no repite canciones', async () => {
  const radio = createRadio({ genres: mkGenres(6), search: mkSearch(), rng: seeded(11) });
  const ids = (await take(radio, 50)).map((r) => r.track.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('marca genreChanged y genreLeft', async () => {
  const radio = createRadio({ genres: mkGenres(6), search: mkSearch(), rng: seeded(), perGenre: [4, 4] });
  const rs = await take(radio, 9);
  assert.deepEqual(rs.map((r) => r.genreChanged), [true, false, false, false, true, false, false, false, true]);
  assert.deepEqual(rs.slice(0, 4).map((r) => r.genreLeft), [3, 2, 1, 0]);
});

test('género pedido con catálogo agotado: repite canciones antiguas en vez de fallar durante su racha', async () => {
  const search = async () => [{ id: 'x1', title: 'A', channel: 'C', duration: 200 }, { id: 'x2', title: 'B', channel: 'C', duration: 200 }];
  const radio = createRadio({ genres: mkGenres(3), search, rng: seeded(), perGenre: [7, 7] });
  const rs = await take(radio, 7, { genre: 'g1' });
  assert.equal(rs.length, 7);
  assert.ok(rs.every((r) => r.genre.id === 'g1'));
});

test('género pedido a mano: dura una racha (como los automáticos) y luego vuelve a rotar solo', async () => {
  const radio = createRadio({ genres: mkGenres(6), search: mkEndlessSearch(), rng: seeded(), perGenre: [4, 4] });
  const first = await radio.next({ genre: 'g2' });
  assert.equal(first.genre.id, 'g2');
  assert.equal(first.genreChanged, true);
  assert.equal(first.genreLeft, 3);
  const rest = await take(radio, 3);
  assert.ok(rest.every((r) => r.genre.id === 'g2' && !r.genreChanged), 'las otras 3 de la racha siguen en g2');
  const next = await radio.next();
  assert.notEqual(next.genre.id, 'g2', 'terminada la racha vuelve la rotación automática');
  assert.equal(next.genreChanged, true);
  const after = await take(radio, 20);
  assert.ok(new Set(after.map((r) => r.genre.id)).size >= 2, 'y sigue rotando');
});

test('género pedido a mano: la racha dura entre 4 y 6 canciones', async () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const radio = createRadio({ genres: mkGenres(8), search: mkEndlessSearch(), rng: seeded(seed) });
    const rs = await take(radio, 12, { genre: 'g3' });
    const n = rs.findIndex((r) => r.genre.id !== 'g3');
    assert.ok(n >= 4 && n <= 6, `racha de ${n} con semilla ${seed}`);
  }
});

test('pedir el mismo género que ya suena empieza una racha nueva', async () => {
  const radio = createRadio({ genres: mkGenres(6), search: mkEndlessSearch(), rng: seeded(), perGenre: [4, 4] });
  await radio.next({ genre: 'g2' });
  await take(radio, 2);
  const again = await radio.next({ genre: 'g2' });
  assert.equal(again.genre.id, 'g2');
  assert.equal(again.genreLeft, 3, 'racha completa otra vez');
});

test('género desconocido → error UNKNOWN_GENRE', async () => {
  const radio = createRadio({ genres: mkGenres(3), search: mkSearch() });
  await assert.rejects(radio.next({ genre: 'nope' }), (e) => e.code === 'UNKNOWN_GENRE');
});

test('si un género no da resultados, prueba otro', async () => {
  const search = async (q) => {
    if (q === 'q-g1') throw new Error('sin red');
    return mkSearch()(q);
  };
  const radio = createRadio({ genres: mkGenres(2), search, rng: () => 0 });
  const r = await radio.next();
  assert.equal(r.genre.id, 'g2');
});

test('si nada responde → NO_SOURCE', async () => {
  const radio = createRadio({ genres: mkGenres(3), search: async () => { throw new Error('x'); }, rng: seeded() });
  await assert.rejects(radio.next(), (e) => e.code === 'NO_SOURCE');
});

test('prefiere canciones (≤ 15 min) a mezclas largas del mismo resultado', async () => {
  const search = async () => [
    { id: 'mix1', title: 'Mix 3 h', channel: 'C', duration: 10800 },
    { id: 'song1', title: 'Canción', channel: 'C', duration: 200 },
    { id: 'mix2', title: 'Mix 2 h', channel: 'C', duration: 7200 }
  ];
  const radio = createRadio({ genres: mkGenres(3), search, rng: seeded() });
  const r = await radio.next();
  assert.equal(r.track.id, 'song1');
});

test('si el género solo trae mezclas largas, usa una y pasa de género después', async () => {
  const mixes = (q) => [{ id: `${q}-m1`, title: 'Mix', channel: 'C', duration: 10800 }, { id: `${q}-m2`, title: 'Mix 2', channel: 'C', duration: 9000 }];
  const radio = createRadio({ genres: mkGenres(6), search: async (q) => mixes(q), rng: seeded(2), perGenre: [4, 6] });
  const a = await radio.next();
  const b = await radio.next();
  assert.ok(a.track.duration > 900, 'sonó una mezcla en vez de fallar');
  assert.equal(b.genreChanged, true, 'tras una mezcla de horas no se queda en el mismo género');
  assert.notEqual(b.genre.id, a.genre.id);
});

test('query: es una pauta única — no altera el género ni la racha; la lista sigue donde iba', async () => {
  const search = async (q) => {
    if (q === 'bad bunny') return [{ id: 'bb1', title: 'Bad Bunny - Tití', channel: 'BB', duration: 240 }, { id: 'bb2', title: 'Otra', channel: 'BB', duration: 200 }];
    return mkEndlessSearch()(q);
  };
  const radio = createRadio({ genres: mkGenres(6), search, rng: seeded(4), perGenre: [4, 4] });
  const a = await radio.next();
  await radio.next();
  const q = await radio.next({ query: 'bad bunny' });
  assert.equal(q.track.id, 'bb1');
  assert.equal(q.genre.id, 'search');
  assert.match(q.genre.label, /bad bunny/i);
  assert.equal(q.genreChanged, true);

  const c = await radio.next();
  assert.equal(c.genre.id, a.genre.id, 'después de la búsqueda vuelve al mismo género');
  assert.equal(c.genreChanged, false);
  assert.equal(c.genreLeft, 1, 'la racha sigue desde donde iba (4 → 3, 2, [búsqueda], 1)');

  const again = await radio.next({ query: 'bad bunny' });
  assert.equal(again.track.id, 'bb2', 'no repite la que ya sonó');
});

test('query durante una racha pedida: la racha sigue donde iba y luego rota', async () => {
  const search = async (q) => (q === 'x' ? [{ id: 'x1', title: 'X', channel: 'C', duration: 200 }] : mkEndlessSearch()(q));
  const radio = createRadio({ genres: mkGenres(5), search, rng: seeded(8), perGenre: [4, 4] });
  await radio.next({ genre: 'g2' });
  await radio.next({ query: 'x' });
  const rest = await take(radio, 3);
  assert.ok(rest.every((r) => r.genre.id === 'g2'), 'las 3 que faltaban de la racha');
  const next = await radio.next();
  assert.notEqual(next.genre.id, 'g2', 'después rota');
});

test('query sin resultados → NO_SOURCE y no altera el estado', async () => {
  const search = async (q) => (q === 'nada' ? [] : mkEndlessSearch()(q));
  const radio = createRadio({ genres: mkGenres(4), search, rng: seeded(6) });
  const first = await radio.next({ genre: 'g1' });
  await assert.rejects(radio.next({ query: 'nada' }), (e) => e.code === 'NO_SOURCE');
  const after = await radio.next();
  assert.equal(after.genre.id, first.genre.id);
});

test('si fijar un género falla, el radio conserva el estado anterior', async () => {
  const search = async (q) => (q === 'q-g2' ? [] : mkEndlessSearch()(q));
  const radio = createRadio({ genres: mkGenres(4), search, rng: seeded(9) });
  const first = await radio.next({ genre: 'g1' });
  await assert.rejects(radio.next({ genre: 'g2' }), (e) => e.code === 'NO_SOURCE');
  const after = await radio.next();
  assert.equal(after.genre.id, first.genre.id, 'sigue en g1 (su racha no se perdió)');
  assert.equal(after.genreChanged, false);
});

test('un género fijo que falla no salta a otro género', async () => {
  const radio = createRadio({ genres: mkGenres(3), search: async () => [], rng: seeded() });
  await assert.rejects(radio.next({ genre: 'g1' }), (e) => e.code === 'NO_SOURCE');
});

test('llamadas simultáneas se serializan (sin canciones duplicadas)', async () => {
  const radio = createRadio({ genres: mkGenres(5), search: mkSearch(), rng: seeded(5) });
  const rs = await Promise.all([radio.next(), radio.next(), radio.next(), radio.next()]);
  assert.equal(new Set(rs.map((r) => r.track.id)).size, 4);
});

test('reutiliza el pool: no busca en cada canción', async () => {
  let searches = 0;
  const search = async (q) => { searches++; return mkSearch()(q); };
  const radio = createRadio({ genres: mkGenres(4), search, rng: seeded(), perGenre: [5, 5] });
  await take(radio, 5);
  assert.equal(searches, 1);
});

/* probe: antes de ofrecer una canción se comprueba que se puede reproducir */
const fallaSiTerminaEn = (...fin) => async (id) => !fin.some((f) => id.endsWith(f));

test('probe: la racha nunca entrega una canción que no se puede reproducir', async () => {
  const probados = [];
  const probe = async (id) => { probados.push(id); return !/-[0-4]$/.test(id); }; /* fallan las 5 primeras de cada consulta */
  const radio = createRadio({ genres: mkGenres(4), search: mkEndlessSearch(), rng: seeded(3), probe });
  const rs = await take(radio, 25);
  assert.equal(rs.length, 25);
  assert.ok(rs.every((r) => !/-[0-4]$/.test(r.track.id)), 'todas se pudieron reproducir');
  assert.ok(probados.length > rs.length, 'se sondearon más de las que se entregaron');
});

test('probe: una búsqueda ofrece el siguiente resultado si el primero no se puede reproducir', async () => {
  const search = async () => [{ id: 'x1', title: 'A', channel: 'C', duration: 200 }, { id: 'x2', title: 'B', channel: 'C', duration: 200 }, { id: 'x3', title: 'C', channel: 'C', duration: 200 }];
  const radio = createRadio({ genres: mkGenres(3), search, rng: seeded(), probe: fallaSiTerminaEn('x1') });
  const r = await radio.next({ query: 'algo' });
  assert.equal(r.track.id, 'x2');
});

test('probe: si ningún resultado de la búsqueda se puede reproducir → NO_SOURCE y no se altera la racha', async () => {
  const search = async (q) => (q === 'nada' ? [1, 2, 3, 4, 5].map((n) => ({ id: `m${n}`, title: 'M', channel: 'C', duration: 200 })) : mkEndlessSearch()(q));
  const probe = async (id) => !id.startsWith('m');
  const radio = createRadio({ genres: mkGenres(4), search, rng: seeded(6), probe, perGenre: [4, 4] });
  const first = await radio.next();
  await assert.rejects(radio.next({ query: 'nada' }), (e) => e.code === 'NO_SOURCE');
  const after = await radio.next();
  assert.equal(after.genre.id, first.genre.id, 'la racha sigue donde iba');
  assert.equal(after.genreLeft, first.genreLeft - 1);
});

test('probe: no sondea más de 3 canciones por elección', async () => {
  const probados = [];
  const search = async () => Array.from({ length: 10 }, (_, i) => ({ id: `y${i}`, title: 'Y', channel: 'C', duration: 200 }));
  const radio = createRadio({ genres: mkGenres(3), search, rng: seeded(), probe: async (id) => { probados.push(id); return false; } });
  await assert.rejects(radio.next({ query: 'y' }), (e) => e.code === 'NO_SOURCE');
  assert.equal(probados.length, 3);
});

test('probe: una canción que falló no se vuelve a sondear enseguida', async () => {
  const llamadas = [];
  const search = async () => [{ id: 'x1', title: 'A', channel: 'C', duration: 200 }, { id: 'x2', title: 'B', channel: 'C', duration: 200 }, { id: 'x3', title: 'C', channel: 'C', duration: 200 }];
  const probe = async (id) => { llamadas.push(id); return id !== 'x1'; };
  const radio = createRadio({ genres: mkGenres(3), search, rng: seeded(), probe });
  assert.equal((await radio.next({ query: 'algo' })).track.id, 'x2');
  assert.equal((await radio.next({ query: 'algo' })).track.id, 'x3');
  assert.equal(llamadas.filter((i) => i === 'x1').length, 1, 'x1 solo se sondeó una vez');
});

test('probe: las que fallan se vuelven a intentar cuando pasa el tiempo (p. ej. se corrigió el reloj)', async () => {
  let t = 1000;
  const search = async () => [{ id: 'x1', title: 'A', channel: 'C', duration: 200 }, { id: 'x2', title: 'B', channel: 'C', duration: 200 }];
  let sano = false;
  const probe = async (id) => id !== 'x1' || sano;
  const radio = createRadio({ genres: mkGenres(3), search, rng: seeded(), probe, now: () => t, badTtlMs: 60000 });
  assert.equal((await radio.next({ query: 'a' })).track.id, 'x2');
  sano = true; t += 61000;
  assert.equal((await radio.next({ query: 'a' })).track.id, 'x1', 'ya se reintenta x1');
});

test('probe: en la rotación sondea hasta 6 canciones por elección y no se rinde con la mitad rotas', async () => {
  const probados = [];
  const search = async () => Array.from({ length: 10 }, (_, i) => ({ id: `z${i}`, title: 'Z', channel: 'C', duration: 200 }));
  const radio = createRadio({ genres: mkGenres(1), search, rng: seeded(), perGenre: [4, 4], probe: async (id) => { probados.push(id); return Number(id.slice(1)) >= 5; } });
  const r = await radio.next();
  assert.ok(Number(r.track.id.slice(1)) >= 5);
  assert.ok(probados.length <= 6, 'a lo más 6 sondeos en una elección');
});
