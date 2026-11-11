/* radio-logica.js — lógica pura de la portada «Radio» y del armazón del panel completo (sin DOM ni red): atajos de Descubrir, géneros
   destacados, barra de reproducción (tiempo, progreso, volumen), etiquetas del carácter de las fases de Bienestar y a dónde lleva cada
   sección del menú. Se prueba con node:test (test/panel-radio.test.js). */
(function (root) {
  'use strict';

  const tiene = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);

  /* — Descubrir: los atajos de género de la barra lateral del DEACERO Play anterior. Cada uno arranca la radio continua de un género
     que existe en data/genres.json (lo comprueba la prueba). `icono` es una clase de Font Awesome, o 'bandera-mx' (dibujo propio). — */
  const DESCUBRIR = [
    { id: 'clasicos', label: 'Clásicos Inolvidables', genero: 'mix-80s', icono: 'fa-star', color: '#f59e0b' },
    { id: 'mexicanas', label: 'Mexicanas', genero: 'regional-mexicano-mix', icono: 'bandera-mx', color: '' },
    { id: 'lanzamientos', label: 'Últimos Lanzamientos', genero: 'pop', icono: 'fa-fire-flame-curved', color: '#ef4444' },
    { id: 'rock', label: 'Rock en Español', genero: 'rock-espanol', icono: 'fa-guitar', color: '#a78bfa' },
    { id: 'poplatino', label: 'Pop Latino', genero: 'latin', icono: 'fa-sun', color: '#f472b6' },
    { id: 'electronica', label: 'Electrónica', genero: 'electronic', icono: 'fa-bolt', color: '#38bdf8' },
    { id: 'hiphop', label: 'Hip-Hop & Trap', genero: 'hiphop', icono: 'fa-microphone', color: '#fb923c' },
    { id: 'jazz', label: 'Jazz & Chill', genero: 'jazz', icono: 'fa-wine-glass', color: '#34d399' },
    { id: 'baladas', label: 'Baladas', genero: 'romantic', icono: 'fa-heart', color: '#f87171' }
  ];

  /* Cuadrícula «O elige un género para iniciar Radio continua» de la portada: géneros destacados, en este orden. */
  const DESTACADOS = ['lofi', 'pop-espanol', 'rock-espanol', 'reggaeton', 'cumbia', 'salsa', 'banda', 'grupero', 'mix-80s', 'mix-90s', 'classicrock', 'jazz', 'electronic', 'romantic'];

  /* Lo que responde /api/genres → los destacados que existan, en el orden de DESTACADOS. */
  function generosDestacados(lista) {
    if (!Array.isArray(lista)) return [];
    const porId = new Map(lista.filter((g) => g && typeof g.id === 'string').map((g) => [g.id, g]));
    return DESTACADOS.filter((id) => porId.has(id)).map((id) => porId.get(id));
  }

  /* El color de un género va a una variable CSS: solo hexadecimal. */
  const colorSeguro = (c) => (typeof c === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(c) ? c : '');

  /* Géneros internos del motor: no son «la radio de un género». */
  const NO_GENERO = ['search', 'podcast', 'lista'];
  const generoSonando = (s) => (s && s.genre && typeof s.genre.id === 'string' && !NO_GENERO.includes(s.genre.id) ? s.genre.id : '');

  /* — barra de reproducción — */
  function fmtTiempo(s) {
    if (typeof s !== 'number' || !Number.isFinite(s)) return '–:––';
    s = Math.max(0, Math.floor(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = String(s % 60).padStart(2, '0');
    return h ? h + ':' + String(m).padStart(2, '0') + ':' + ss : m + ':' + ss;
  }
  const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);

  /* Posición de lo que suena según getState(): duración del motor (o la de la pista), porcentaje y textos. */
  function progreso(s) {
    const t = s && s.track;
    const dur = num(s && s.duration) > 0 ? s.duration : t && num(t.duration) > 0 ? t.duration : 0;
    const pos = Math.max(0, Math.min(num(s && s.time), dur || Infinity));
    const pct = dur ? Math.round((pos / dur) * 1000) / 10 : 0;
    const actual = fmtTiempo(pos), total = dur ? fmtTiempo(dur) : '–:––';
    return { pos, dur, pct, actual, total, texto: dur ? actual + ' de ' + total : actual, buscable: dur > 0 };
  }
  /* Valor del deslizador (0–1000) → segundos; null si no se puede. */
  function segundosDesde(valor, dur) {
    const v = Number(valor);
    if (!Number.isFinite(v) || !(dur > 0)) return null;
    return Math.round((Math.min(1000, Math.max(0, v)) / 1000) * dur * 10) / 10;
  }
  const iconoVolumen = (vol, silencio) => (silencio || !(vol > 0) ? 'fa-volume-xmark' : vol < 50 ? 'fa-volume-low' : 'fa-volume-high');

  /* Teclado en la barra de progreso (WCAG 2.1.1): el deslizador va de 0 a 1000, así que una flecha nativa movería 0.1 % (un cuarto de
     segundo). Flechas = 5 s, Re Pág / Av Pág = 30 s, Inicio / Fin = principio y final. Regresa el nuevo valor 0–1000, o null si la tecla
     no es de movimiento o no hay duración. */
  const PASOS_SEEK = { ArrowRight: 5, ArrowUp: 5, ArrowLeft: -5, ArrowDown: -5, PageUp: 30, PageDown: -30 };
  function valorConTecla(key, valor, dur) {
    if (!(dur > 0) || typeof key !== 'string') return null;
    if (key === 'Home') return 0;
    if (key === 'End') return 1000;
    if (!tiene(PASOS_SEEK, key)) return null;
    const v = Number(valor);
    const seg = (Number.isFinite(v) ? Math.min(1000, Math.max(0, v)) : 0) / 1000 * dur + PASOS_SEEK[key];
    return Math.round((Math.min(dur, Math.max(0, seg)) / dur) * 1000);
  }
  /* Lo que el lector de pantalla dice del volumen (aria-valuetext): «85 %» o «85 %, silenciado». */
  function textoVolumen(vol, silencio) {
    const v = Math.round(Math.min(100, Math.max(0, num(Number(vol)))));
    return v + ' %' + (silencio ? ', silenciado' : '');
  }

  /* — Bienestar: carácter musical de cada fase (lo manda el servidor en plan.fases[i].caracter) — */
  const CARACTERES = {
    'calma-profunda': 'Calma profunda', calma: 'Calma', melancolia: 'Melancolía', foco: 'Concentración', despertar: 'Despertar',
    nostalgia: 'Nostalgia', tension: 'Soltar la tensión', fluir: 'Fluir', animo: 'Buen ánimo', descarga: 'Descarga', energia: 'Energía'
  };
  const etiquetaCaracter = (id) => (typeof id === 'string' && tiene(CARACTERES, id) ? CARACTERES[id] : '');

  /* — navegación: cada sección del menú → panel que se muestra y su subpestaña — */
  const DESTINOS = {
    inicio: ['inicio', 'reco'], bienestar: ['inicio', 'bienestar'], podcasts: ['inicio', 'podcasts'],
    buscar: ['buscar', ''], naturaleza: ['naturaleza', ''], parati: ['parati', ''],
    favoritos: ['favoritos', 'likes'], historial: ['favoritos', 'historial'], admin: ['admin', '']
  };
  function destino(vista) {
    const v = typeof vista === 'string' && tiene(DESTINOS, vista) ? vista : 'inicio';
    return { vista: v, panel: DESTINOS[v][0], sub: DESTINOS[v][1] };
  }
  /* Orden del menú lateral: también el de los atajos 1–9. */
  const MENU = ['inicio', 'buscar', 'bienestar', 'naturaleza', 'historial', 'favoritos', 'parati', 'admin'];
  function vistaDeAtajo(n, adminVisible) {
    const lista = MENU.filter((v) => v !== 'admin' || adminVisible);
    const i = Number(n) - 1;
    return Number.isInteger(i) && i >= 0 && i < lista.length ? lista[i] : null;
  }
  /* Pestañas de abajo en el celular: Inicio, Bienestar, Descubrir (el menú) y Biblioteca. */
  function pestanaMovil(vista) {
    const v = destino(vista).vista;
    if (v === 'inicio' || v === 'podcasts') return 'inicio';
    if (v === 'bienestar') return 'bienestar';
    if (v === 'favoritos' || v === 'historial') return 'biblioteca';
    return 'descubrir';
  }

  /* Loader grande del panel: c = { t0, id (canción que sonaba al pedir), vioCarga (el motor ya empezó a cargar), ia (aún se consulta a la IA) }.
     Se va cuando suena OTRA canción, cuando el motor terminó de cargar sin lograrlo (hubo error: ya lo avisó) o, por si acaso, a los 90 s. */
  function cargaTermina(c, s, ahora) {
    if (!c) return true;
    if (ahora - c.t0 > 90000) return true;
    const id = s && s.track ? s.track.id : '';
    if (id && id !== c.id) return true;
    if (c.ia) return false;
    return !!(c.vioCarga && s && !s.loading);
  }

  /* ¿Aparece SOLA la capa «Buscando música…» (el motor busca y ningún botón del panel mostró la suya)? o = { cargando, desde (ms en que
     empezó a buscar), ahora, pedido (ms del último Siguiente/Anterior de la persona; 0 = ninguno), descartada (la ocultó o pasaron los 90 s
     en ESTA búsqueda) }. Solo si la persona pidió algo hace poco: la precarga del arranque o el cambio de canción al terminar no tapan la pantalla. */
  function cargaSola(o) {
    if (!o || !o.cargando || o.descartada || !(o.desde > 0) || !(o.pedido > 0)) return false;
    if (o.desde - o.pedido > 10000) return false;
    return o.ahora - o.desde > 700;
  }

  /* Región #srAhora: un texto igual al que ya tiene no se vuelve a leer; se alterna un espacio duro al final para que sí se anuncie. */
  function textoAnuncio(previo, txt) {
    const t = String(txt == null ? '' : txt);
    return t && String(previo == null ? '' : previo) === t ? t + ' ' : t;
  }

  /* ¿El foco está en un campo donde se escribe? (la capa de carga que sale sola no le estorba) */
  const NO_ESCRIBE = new Set(['button', 'checkbox', 'radio', 'range', 'color', 'file', 'submit', 'reset', 'image', 'hidden']);
  function escribiendo(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    const tag = String(el.tagName || '').toUpperCase();
    if (tag === 'TEXTAREA') return true;
    return tag === 'INPUT' && !NO_ESCRIBE.has(String(el.type || 'text').toLowerCase());
  }

  /* Alto que ocupan la barra de reproducción y las pestañas desde abajo (topBarra = su borde superior en px). Sin medida: 90. */
  function altoBarra(alto, topBarra) {
    if (!Number.isFinite(topBarra) || !Number.isFinite(alto)) return 90;
    return Math.round(Math.min(alto, Math.max(0, alto - topBarra)));
  }

  const api = {
    textoAnuncio, escribiendo, altoBarra,
    DESCUBRIR, DESTACADOS, generosDestacados, colorSeguro, generoSonando,
    fmtTiempo, progreso, segundosDesde, iconoVolumen, valorConTecla, textoVolumen,
    CARACTERES, etiquetaCaracter, cargaTermina, cargaSola,
    destino, MENU, vistaDeAtajo, pestanaMovil
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PanelRadio = api;
})(typeof window !== 'undefined' ? window : globalThis);
