'use strict';
/* Portada «Radio» del panel completo (public/js/panel/radio-logica.js): atajos de Descubrir, géneros destacados, barra de reproducción,
   etiquetas del carácter de cada fase de Bienestar y a dónde lleva cada sección del menú. Lógica pura, sin DOM. */
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../public/js/panel/radio-logica');
const genres = require('../data/genres.json');
const B = require('../src/bienestar');

const ids = new Set(genres.map((g) => g.id));

test('Descubrir: los 9 atajos del DEACERO Play anterior, en su orden, y cada uno apunta a un género que existe', () => {
  assert.deepEqual(R.DESCUBRIR.map((d) => d.label), [
    'Clásicos Inolvidables', 'Mexicanas', 'Últimos Lanzamientos', 'Rock en Español', 'Pop Latino', 'Electrónica', 'Hip-Hop & Trap', 'Jazz & Chill', 'Baladas'
  ]);
  for (const d of R.DESCUBRIR) {
    assert.ok(ids.has(d.genero), d.label + ' → ' + d.genero + ' no está en data/genres.json');
    assert.match(d.icono, /^(fa-[a-z0-9-]+|bandera-mx)$/, d.label);
  }
  assert.equal(new Set(R.DESCUBRIR.map((d) => d.id)).size, 9, 'ids únicos');
  assert.equal(R.DESCUBRIR.find((d) => d.label === 'Rock en Español').genero, 'rock-espanol');
});

test('géneros destacados de la portada: existen, sin repetir, entre 8 y 16', () => {
  assert.ok(R.DESTACADOS.length >= 8 && R.DESTACADOS.length <= 16);
  assert.equal(new Set(R.DESTACADOS).size, R.DESTACADOS.length);
  for (const id of R.DESTACADOS) assert.ok(ids.has(id), id);
});

test('generosDestacados: toma de /api/genres los destacados en el orden de la lista y omite los que falten', () => {
  const api = [{ id: 'jazz', label: 'Jazz', emoji: '🎷', color: '#ff9f4a' }, { id: R.DESTACADOS[0], label: 'Primero', emoji: '☕', color: '#123' }, { id: 'no-existe', label: 'x' }];
  const out = R.generosDestacados(api);
  assert.equal(out[0].id, R.DESTACADOS[0]);
  assert.ok(out.every((g) => R.DESTACADOS.includes(g.id)));
  assert.deepEqual(R.generosDestacados(null), []);
  assert.deepEqual(R.generosDestacados('basura'), []);
});

test('colorSeguro: solo colores hexadecimales (van a una variable CSS)', () => {
  assert.equal(R.colorSeguro('#F59B23'), '#F59B23');
  assert.equal(R.colorSeguro('#abc'), '#abc');
  assert.equal(R.colorSeguro('red'), '');
  assert.equal(R.colorSeguro('#12345'), '');
  assert.equal(R.colorSeguro('#fff;background:url(x)'), '');
  assert.equal(R.colorSeguro(undefined), '');
});

test('fmtTiempo: m:ss y h:mm:ss; sin dato, guiones', () => {
  assert.equal(R.fmtTiempo(0), '0:00');
  assert.equal(R.fmtTiempo(83.9), '1:23');
  assert.equal(R.fmtTiempo(3725), '1:02:05');
  assert.equal(R.fmtTiempo(-5), '0:00');
  assert.equal(R.fmtTiempo(NaN), '–:––');
  assert.equal(R.fmtTiempo(undefined), '–:––');
});

test('progreso: sale de getState() (time + duration del motor o de la pista)', () => {
  const p = R.progreso({ time: 30, duration: 120, track: { id: 'x', duration: 999 } });
  assert.equal(p.pct, 25);
  assert.equal(p.actual, '0:30');
  assert.equal(p.total, '2:00');
  assert.equal(p.texto, '0:30 de 2:00');
  assert.equal(p.buscable, true);
  /* sin duración del motor: la de la pista */
  assert.equal(R.progreso({ time: 50, track: { duration: 200 } }).pct, 25);
  /* no se pasa del 100 % ni baja de 0 */
  assert.equal(R.progreso({ time: 500, duration: 100 }).pct, 100);
  assert.equal(R.progreso({ time: -3, duration: 100 }).pct, 0);
  /* sin canción o sin duración: no se puede adelantar */
  const nada = R.progreso(null);
  assert.equal(nada.buscable, false);
  assert.equal(nada.pct, 0);
  assert.equal(nada.total, '–:––');
  assert.equal(R.progreso({ time: 12, track: { duration: 0 } }).buscable, false);
});

test('segundosDesde: posición del deslizador (0–1000) → segundos, dentro de la canción', () => {
  assert.equal(R.segundosDesde(500, 200), 100);
  assert.equal(R.segundosDesde(0, 200), 0);
  assert.equal(R.segundosDesde(2000, 200), 200);
  assert.equal(R.segundosDesde(-4, 200), 0);
  assert.equal(R.segundosDesde('abc', 200), null);
  assert.equal(R.segundosDesde(500, 0), null);
});

test('iconoVolumen: silencio, bajo y alto', () => {
  assert.equal(R.iconoVolumen(80, false), 'fa-volume-high');
  assert.equal(R.iconoVolumen(30, false), 'fa-volume-low');
  assert.equal(R.iconoVolumen(0, false), 'fa-volume-xmark');
  assert.equal(R.iconoVolumen(80, true), 'fa-volume-xmark');
});

test('etiquetaCaracter: los 11 caracteres de Bienestar en español; uno desconocido no muestra nada', () => {
  assert.deepEqual(R.CARACTERES, {
    'calma-profunda': 'Calma profunda', calma: 'Calma', melancolia: 'Melancolía', foco: 'Concentración', despertar: 'Despertar',
    nostalgia: 'Nostalgia', tension: 'Soltar la tensión', fluir: 'Fluir', animo: 'Buen ánimo', descarga: 'Descarga', energia: 'Energía'
  });
  assert.equal(R.etiquetaCaracter('foco'), 'Concentración');
  assert.equal(R.etiquetaCaracter('constructor'), '');
  assert.equal(R.etiquetaCaracter(undefined), '');
});

test('etiquetaCaracter: cubre todos los caracteres que puede devolver un plan de Bienestar', () => {
  const VACIO = { generos: { gustan: [], evitar: [] }, artistas: { gustan: [], evitar: [] }, total: 0 };
  const vistos = new Set();
  const ops = B.opciones ? B.opciones() : null;
  const estados = ops && Array.isArray(ops.animos) ? ops.animos.map((a) => a.id) : ['estresado', 'agotado', 'tranquilo', 'motivado'];
  const destinos = ops && Array.isArray(ops.destinos) ? ops.destinos.map((d) => d.id) : [undefined];
  for (const estado of estados) {
    for (const destino of destinos) {
      const p = B.planViaje({ estado, destino, genres, taste: VACIO, rng: () => 0.5 });
      for (const f of p.fases) vistos.add(f.caracter);
    }
  }
  assert.ok(vistos.size > 3);
  for (const c of vistos) assert.notEqual(R.etiquetaCaracter(c), '', 'sin etiqueta: ' + c);
});

test('destino: cada sección del menú lleva a su panel (y subpestaña); lo desconocido, a Inicio', () => {
  assert.deepEqual(R.destino('inicio'), { vista: 'inicio', panel: 'inicio', sub: 'reco' });
  assert.deepEqual(R.destino('bienestar'), { vista: 'bienestar', panel: 'inicio', sub: 'bienestar' });
  assert.deepEqual(R.destino('podcasts'), { vista: 'podcasts', panel: 'inicio', sub: 'podcasts' });
  assert.deepEqual(R.destino('historial'), { vista: 'historial', panel: 'favoritos', sub: 'historial' });
  assert.deepEqual(R.destino('favoritos'), { vista: 'favoritos', panel: 'favoritos', sub: 'likes' });
  assert.deepEqual(R.destino('buscar'), { vista: 'buscar', panel: 'buscar', sub: '' });
  assert.deepEqual(R.destino('admin'), { vista: 'admin', panel: 'admin', sub: '' });
  assert.deepEqual(R.destino('<img>'), R.destino('inicio'));
  assert.deepEqual(R.destino('constructor'), R.destino('inicio'));
  assert.deepEqual(R.destino(undefined), R.destino('inicio'));
});

test('vistaDeAtajo: 1–9 siguen el orden del menú; Administración solo si se ve', () => {
  assert.equal(R.vistaDeAtajo(1, false), 'inicio');
  assert.equal(R.vistaDeAtajo(2, false), 'buscar');
  assert.equal(R.vistaDeAtajo(3, false), 'bienestar');
  const sinAdmin = R.MENU.filter((v) => v !== 'admin');
  assert.equal(R.vistaDeAtajo(sinAdmin.length, false), sinAdmin[sinAdmin.length - 1]);
  assert.equal(R.vistaDeAtajo(sinAdmin.length + 1, false), null);
  assert.equal(R.vistaDeAtajo(R.MENU.indexOf('admin') + 1, true), 'admin');
  assert.equal(R.vistaDeAtajo(0, true), null);
  assert.equal(R.vistaDeAtajo('x', true), null);
});

test('pestanaMovil: qué pestaña de abajo se marca en el celular', () => {
  assert.equal(R.pestanaMovil('inicio'), 'inicio');
  assert.equal(R.pestanaMovil('podcasts'), 'inicio');
  assert.equal(R.pestanaMovil('bienestar'), 'bienestar');
  assert.equal(R.pestanaMovil('favoritos'), 'biblioteca');
  assert.equal(R.pestanaMovil('historial'), 'biblioteca');
  assert.equal(R.pestanaMovil('naturaleza'), 'descubrir');
  assert.equal(R.pestanaMovil('parati'), 'descubrir');
});

test('generoSonando: el id del género de la radio (no las búsquedas, podcasts ni listas)', () => {
  assert.equal(R.generoSonando({ genre: { id: 'jazz' } }), 'jazz');
  assert.equal(R.generoSonando({ genre: { id: 'search' } }), '');
  assert.equal(R.generoSonando({ genre: { id: 'podcast' } }), '');
  assert.equal(R.generoSonando({ genre: { id: 'lista' } }), '');
  assert.equal(R.generoSonando(null), '');
});

test('cargaTermina: el loader se va cuando suena otra canción, cuando el motor dejó de cargar sin lograrlo, o a los 90 s', () => {
  const R2 = require('../public/js/panel/radio-logica.js');
  const c = { t0: 1000, id: 'viejaviejav', vioCarga: false };
  assert.equal(R2.cargaTermina(c, { track: { id: 'viejaviejav' }, loading: true }, 1500), false, 'sigue buscando');
  assert.equal(R2.cargaTermina(c, { track: { id: 'nuevanuevan' }, loading: false }, 3000), true, 'ya suena otra');
  assert.equal(R2.cargaTermina({ t0: 1000, id: 'x', vioCarga: true }, { track: { id: 'x' }, loading: false }, 5000), true, 'terminó sin canción nueva (error)');
  assert.equal(R2.cargaTermina({ t0: 1000, id: 'x', vioCarga: false }, { track: { id: 'x' }, loading: false }, 1400), false, 'aún no empieza a cargar');
  assert.equal(R2.cargaTermina({ t0: 1000, id: 'x', vioCarga: false }, null, 92000), true, 'tope de 90 s');
  assert.equal(R2.cargaTermina({ t0: 1000, id: '', vioCarga: false, ia: true }, { track: null, loading: false }, 30000), false, 'una consulta a la IA sin canción aún no termina sola');
});

/* Capa «Buscando música…» que aparece SOLA (el motor busca sin que el panel haya mostrado un loader): antes salía al abrir la página
   (precarga del arranque, sin que la persona pidiera nada) y «Ocultar» no servía: volvía al segundo, y otra vez al pasar los 90 s. */
test('cargaSola: solo tras Siguiente/Anterior de la persona, pasados 700 ms, y no vuelve si se ocultó en esta misma búsqueda', () => {
  const base = { cargando: true, desde: 10000, pedido: 9900, descartada: false };
  assert.equal(R.cargaSola({ ...base, ahora: 10500 }), false, 'aún no pasan 700 ms');
  assert.equal(R.cargaSola({ ...base, ahora: 10800 }), true, 'la persona pidió Siguiente y tarda');
  assert.equal(R.cargaSola({ ...base, pedido: 0, ahora: 30000 }), false, 'precarga del arranque: nadie pidió nada, no se tapa la pantalla');
  assert.equal(R.cargaSola({ ...base, desde: 200000, pedido: 1000, ahora: 230000 }), false, 'la pidió hace mucho (p. ej. terminó la canción sola): no se tapa');
  assert.equal(R.cargaSola({ ...base, pedido: 12000, ahora: 13000 }), true, 'pidió Siguiente mientras el motor ya buscaba: se le muestra');
  assert.equal(R.cargaSola({ ...base, descartada: true, ahora: 99999 }), false, 'la ocultó (o pasaron los 90 s): no vuelve en esta búsqueda');
  assert.equal(R.cargaSola({ ...base, cargando: false, ahora: 30000 }), false, 'ya no busca');
  assert.equal(R.cargaSola({ ...base, desde: 0, ahora: 30000 }), false, 'sin inicio conocido');
});
