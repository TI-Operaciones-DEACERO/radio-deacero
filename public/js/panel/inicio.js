/* inicio.js — portada «Radio» (Inicio) del panel completo, como la del DEACERO Play anterior:
   Recomendado = «Lo más escuchado del momento» (artistas y géneros; /api/ia/momento), «Recomendado para ti» (solo con cuenta: /api/ia/para-ti), «Bienestar rápido» (ánimos que llevan a Bienestar y arrancan
   el viaje) y una cuadrícula de géneros destacados que arranca su radio continua; Podcasts = carrusel de /api/ia/podcasts.
   Todo lo que llega del servidor se pinta con textContent (Panel.h). Se carga con la página: es la primera vista. */
(function () {
  'use strict';
  const P = window.Panel, h = P.h, L = P.L, R = P.R, A = P.api;
  const $ = (id) => document.getElementById(id);

  /* ───────────── carrusel (flechas que desplazan; en táctil se arrastra) ───────────── */
  function carrusel(scroll, prev, next) {
    const paso = () => Math.max(160, Math.round(scroll.clientWidth * 0.8));
    const reducido = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    prev.addEventListener('click', () => scroll.scrollBy({ left: -paso(), behavior: reducido() ? 'auto' : 'smooth' }));
    next.addEventListener('click', () => scroll.scrollBy({ left: paso(), behavior: reducido() ? 'auto' : 'smooth' }));
    /* Las flechas se apagan en los extremos (aria-disabled: no pierden el foco). */
    const revisar = () => {
      const fin = scroll.scrollWidth - scroll.clientWidth - 2;
      prev.setAttribute('aria-disabled', String(scroll.scrollLeft <= 2));
      next.setAttribute('aria-disabled', String(scroll.scrollLeft >= fin));
    };
    scroll.addEventListener('scroll', revisar, { passive: true });
    window.addEventListener('resize', revisar);
    /* Con Tab, la tarjeta enfocada se trae a la vista. */
    scroll.addEventListener('focusin', (e) => { if (e.target.scrollIntoView) e.target.scrollIntoView({ block: 'nearest', inline: 'nearest' }); });
    return revisar;
  }

  /* Tarjeta del carrusel: color del género, emoji grande (o la carátula de una muestra), título y razón. Es un botón; el texto completo se lee (no se corta).
     muestra = { tipo: 'genero'|'artista', clave } → banner con carátula y miniclip (portadas.js). */
  function tarjeta({ emoji, color, titulo, sup, texto, aria, alClic, muestra }) {
    const e = h('span', { class: 'aireco-emoji', 'aria-hidden': 'true' });
    P.emo(e, emoji || '🎵');
    const b = h('button', { type: 'button', class: 'aireco-card', 'aria-label': aria, onclick: alClic }, [
      e,
      h('span', { class: 'aireco-play', 'aria-hidden': 'true' }, P.fa('fa-play')),
      h('span', { class: 'aireco-txt' }, [
        sup ? h('span', { class: 'aireco-a-genre', text: sup }) : null,
        h('span', { class: 'aireco-a-name', text: titulo }),
        texto ? h('span', { class: 'aireco-a-reason', text: texto }) : null
      ])
    ]);
    const c = R.colorSeguro(color);
    if (c) b.style.setProperty('--rc', c);
    if (muestra) P.portada(b, muestra);
    return h('li', {}, b);
  }

  /* Un artista sugerido: su radio de «más como esto» empieza con una búsqueda; el locutor dice a quién se va a oír. */
  function tocarArtista(a) {
    P.cargando('Buscando lo mejor de ' + a.name, 'Después siguen canciones parecidas.');
    P.anunciarEscucha('cancion', a.name);
    P.send({ cmd: 'search', q: String(a.query || a.name).slice(0, 100) });
  }
  function tarjetaArtista(a, sup) {
    return tarjeta({
      emoji: a.emoji, sup: sup || a.genre || 'Artista', titulo: a.name, texto: a.reason,
      aria: 'Escuchar a ' + a.name + (a.reason ? '. ' + a.reason : ''),
      alClic: () => tocarArtista(a), muestra: { tipo: 'artista', clave: a.query || a.name }
    });
  }

  /* Pide, muestra «Cargando…» y pinta, o un error amable con Reintentar. */
  async function cargarEn(lista, pedir, pintar, act, esq) {
    lista.setAttribute('aria-busy', 'true');
    if (act) act.setAttribute('aria-disabled', 'true');
    lista.replaceChildren(...P.esqueleto(esq || 'tarjeta', esq === 'episodio' ? 3 : 5));
    const r = await pedir();
    lista.removeAttribute('aria-busy');
    if (act) act.removeAttribute('aria-disabled');
    if (!r.ok || !r.data) {
      lista.replaceChildren(h('li', { class: 'vacio' }, [
        h('p', { text: L.mensajeError(r.status) }),
        h('button', { type: 'button', class: 'primary', text: 'Reintentar', onclick: () => cargarEn(lista, pedir, pintar, act, esq) })
      ]));
      return false;
    }
    lista.replaceChildren(...pintar(r.data));
    return true;
  }

  /* ───────────── Lo más escuchado del momento: artistas (lo de la planta y lo de la hora) y géneros ───────────── */
  const revisarReco = carrusel($('recoScroll'), $('recoPrev'), $('recoNext'));
  function cargarReco() {
    return cargarEn($('recoCards'), () => A.iaMomento(), (d) => {
      const gens = Array.isArray(d.generos) ? d.generos.filter((g) => g && typeof g.id === 'string' && g.label) : [];
      const arts = Array.isArray(d.artistas) ? d.artistas.filter((a) => a && typeof a.name === 'string' && a.name) : [];
      $('recoSub').textContent = d.razon || 'Artistas y géneros que suenan ahora en la planta y a esta hora del día';
      $('recoFuente').textContent = L.fuenteTexto(d.fuente);
      setTimeout(revisarReco, 0);
      if (!arts.length && !gens.length) return [h('li', { class: 'hint', text: 'No hay sugerencias por ahora. Toca «Actualizar» en un momento.' })];
      const cardsA = arts.map((a) => tarjetaArtista(a, a.popular ? 'Lo más escuchado' : a.genre));
      const cardsG = gens.map((g) => tarjeta({
        emoji: g.emoji, color: g.color, sup: 'Radio continua', titulo: g.label, texto: g.razon,
        aria: 'Iniciar la radio de ' + g.label + (g.razon ? '. ' + g.razon : ''),
        alClic: () => P.radioGenero(g.id, g.label), muestra: { tipo: 'genero', clave: g.id }
      }));
      return R.intercalar(cardsA, cardsG, 2);
    }, $('recoAct'));
  }
  $('recoAct').addEventListener('click', () => { if ($('recoAct').getAttribute('aria-disabled') !== 'true') cargarReco().then((ok) => { if (ok) P.toast('Lista actualizada.'); }); });

  /* ───────────── Recomendado para ti: solo con cuenta, según lo que la persona escucha y marca con Me gusta ───────────── */
  const revisarPt = carrusel($('ptScroll'), $('ptPrev'), $('ptNext'));
  function cargarParaTi() {
    return cargarEn($('ptCards'), () => A.iaParaTi(P.sid()), (d) => {
      const items = (Array.isArray(d.items) ? d.items : []).filter((a) => a && typeof a.name === 'string' && a.name);
      const gusto = d.context && d.context.topGenre;
      $('ptSub').textContent = gusto ? 'Según lo que escuchas y tus Me gusta' : 'Aún estamos conociendo tus gustos: marca Me gusta y se afinan';
      setTimeout(revisarPt, 0);
      if (!items.length) return [h('li', { class: 'hint', text: 'Aún no hay recomendaciones. Escucha un rato y marca tus Me gusta.' })];
      return items.map((a) => tarjetaArtista(a, a.isNew ? 'Nuevo para ti' : a.genre));
    }, $('ptAct'));
  }
  $('ptAct').addEventListener('click', () => { if ($('ptAct').getAttribute('aria-disabled') !== 'true') cargarParaTi().then((ok) => { if (ok) P.toast('Recomendaciones actualizadas.'); }); });
  function alUsuario(u) {
    $('paraTiSec').hidden = !u;
    if (u) cargarParaTi(); else $('ptCards').replaceChildren();
  }

  /* ───────────── Bienestar rápido: un ánimo lleva a Bienestar y arranca el viaje ───────────── */
  async function cargarAnimos() {
    const cont = $('bzqGrupos');
    const r = await A.bienestarOpciones();
    cont.removeAttribute('aria-busy');
    if (!r.ok || !r.data || !Array.isArray(r.data.animos)) {
      cont.replaceChildren(h('div', { class: 'vacio' }, [
        h('p', { text: L.mensajeError(r.status) }),
        h('button', { type: 'button', class: 'primary', text: 'Reintentar', onclick: cargarAnimos })
      ]));
      return;
    }
    const animos = r.data.animos.filter((a) => a && typeof a.id === 'string' && a.label);
    const grupos = Array.from(new Set(animos.map((a) => a.grupo || '')));
    const partes = [];
    grupos.forEach((g, i) => {
      const id = 'bzqG' + i;
      if (g) partes.push(h('h3', { class: 'mj-cat-label', id, text: g }));
      partes.push(h('ul', { class: 'mj-quick-grid', 'aria-labelledby': g ? id : 'bzqT' }, animos.filter((a) => (a.grupo || '') === g).map((a) => {
        const e = h('span', { class: 'mj-q-emoji', 'aria-hidden': 'true' });
        P.emo(e, a.emoji);
        return h('li', {}, h('button', { type: 'button', class: 'mj-quick-btn', 'aria-label': a.label + ': iniciar viaje de Bienestar', onclick: () => irBienestar(a.id) }, [e, h('span', { class: 'mj-q-label', text: a.label })]));
      })));
    });
    cont.replaceChildren(...partes);
  }
  function irBienestar(animo) {
    P.ir('bienestar');
    P.cuandoCargue('bienestar', (v) => { if (animo && v.iniciarAnimo) v.iniciarAnimo(animo); else if (v.enfocar) v.enfocar(); });
  }
  $('bzqMas').addEventListener('click', () => irBienestar(''));

  /* ───────────── Géneros destacados: «O elige un género para iniciar Radio continua» ───────────── */
  async function cargarGeneros() {
    const grid = $('genGrid');
    grid.replaceChildren(...P.esqueleto('genero', 8));
    const r = await A.generos();
    const gens = r.ok ? R.generosDestacados(r.data) : [];
    prepararTodos(r.ok ? r.data : null);
    if (!gens.length) {
      grid.replaceChildren(h('li', { class: 'vacio' }, [h('p', { text: L.mensajeError(r.status) }), h('button', { type: 'button', class: 'primary', text: 'Reintentar', onclick: cargarGeneros })]));
      return;
    }
    grid.replaceChildren(...gens.map((g) => {
      const e = h('span', { class: 'ai-genre-ico', 'aria-hidden': 'true' });
      P.emo(e, g.emoji);
      const b = h('button', { type: 'button', class: 'ai-genre-card', 'data-genero': g.id, title: g.label + ': iniciar radio continua', onclick: () => P.radioGenero(g.id, g.label) }, [
        e,
        h('span', { class: 'ai-genre-playing', 'aria-hidden': 'true', text: 'Sonando' }),
        h('span', { class: 'ai-genre-lbl' }, [g.label, h('span', { class: 'sr-only sonando-txt' })])
      ]);
      const c = R.colorSeguro(g.color);
      if (c) b.style.setProperty('--gc', c);
      P.portada(b, { tipo: 'genero', clave: g.id });
      return h('li', {}, b);
    }));
    P.remarcarSonando();
  }

  /* ───────────── Todos los géneros: botón que abre la lista completa con filtro (se pinta al abrirla) ───────────── */
  let todosGen = null;
  function prepararTodos(lista) {
    todosGen = R.todosLosGeneros(lista);
    const btn = $('genTodosBtn');
    btn.hidden = !todosGen.length;
    btn.textContent = 'Ver todos los géneros (' + todosGen.length + ')';
  }
  function pintarTodos() {
    const q = $('genTodosQ').value;
    const gens = R.todosLosGeneros(todosGen, q);
    $('genTodosN').textContent = q.trim() ? (gens.length === 1 ? '1 género' : gens.length + ' géneros') : '';
    /* Solo texto: cientos de emojis serían cientos de imágenes (la Pi no lo agradece) */
    $('genTodosLista').replaceChildren(...(gens.length ? gens.map((g) => h('li', {}, h('button', { type: 'button', class: 'chip', 'data-genero': g.id, title: g.label + ': iniciar radio continua', onclick: () => P.radioGenero(g.id, g.label) }, [g.label, h('span', { class: 'sr-only sonando-txt' })]))) : [h('li', { class: 'vacio', text: 'Ningún género coincide.' })]));
    P.remarcarSonando();
  }
  $('genTodosBtn').addEventListener('click', () => {
    const abrir = $('genTodos').hidden;
    $('genTodos').hidden = !abrir;
    $('genTodosBtn').setAttribute('aria-expanded', String(abrir));
    $('genTodosBtn').textContent = abrir ? 'Ocultar la lista de géneros' : 'Ver todos los géneros (' + todosGen.length + ')';
    if (abrir) { pintarTodos(); $('genTodosQ').focus(); }
  });
  let tFiltro = 0;
  $('genTodosQ').addEventListener('input', () => { clearTimeout(tFiltro); tFiltro = setTimeout(pintarTodos, 150); });

  /* ───────────── Podcasts: temas (carrusel) → episodios con portada; cada uno se escucha o se ve en video ───────────── */
  const revisarPod = carrusel($('podScroll'), $('podPrev'), $('podNext'));
  let podCargados = false;
  const fmtDur = (s) => (s > 0 ? (s >= 3600 ? Math.floor(s / 3600) + ' h ' + Math.round((s % 3600) / 60) + ' min' : Math.round(s / 60) + ' min') : '');
  function episodio(t) {
    const img = h('img', { class: 'epi-img', alt: '', loading: 'lazy', decoding: 'async', width: '320', height: '180', src: '/api/thumb/' + encodeURIComponent(t.id) });
    img.addEventListener('error', () => { img.hidden = true; });
    const tocar = (video) => {
      P.cargando('Preparando el episodio', t.title);
      P.anunciarEscucha('podcast', t.title);
      P.send({ cmd: 'track', kind: 'podcast', track: { id: t.id, title: t.title, channel: t.channel, duration: t.duration } });
      if (video) { P.finCarga(); P.abrirVideo(); } /* sin la capa de carga encima del visor */
    };
    return h('li', { class: 'epi' }, [
      h('div', { class: 'epi-portada' }, [img]),
      h('p', { class: 'epi-nombre', text: t.title }),
      h('p', { class: 'epi-meta', text: [t.channel, fmtDur(t.duration)].filter(Boolean).join(' · ') }),
      h('div', { class: 'epi-acc' }, [
        h('button', { type: 'button', class: 'primary corto', 'aria-label': 'Escuchar: ' + t.title, onclick: () => tocar(false) }, [P.fa('fa-play'), ' Escuchar']),
        h('button', { type: 'button', class: 'ghost corto', 'aria-label': 'Ver video: ' + t.title, onclick: () => tocar(true) }, [P.fa('fa-tv'), ' Ver video'])
      ])
    ]);
  }
  let temaActual = '';
  function cargarEpisodios(tema) {
    temaActual = tema.query;
    $('episT').textContent = 'Episodios: ' + tema.titulo;
    for (const b of $('podCards').querySelectorAll('button[data-tema]')) b.setAttribute('aria-pressed', String(b.dataset.tema === tema.query));
    return cargarEn($('podEpis'), () => A.podcastEpisodios(String(tema.query).slice(0, 100)), (lista) => {
      const eps = (Array.isArray(lista) ? lista : []).filter((t) => t && typeof t.id === 'string' && t.title);
      return eps.length ? eps.slice(0, 12).map(episodio) : [h('li', { class: 'hint', text: 'No encontré episodios de este tema. Prueba otro.' })];
    }, null, 'episodio');
  }
  function cargarPodcasts() {
    podCargados = true;
    return cargarEn($('podCards'), () => A.iaPodcasts(), (d) => {
      const items = (Array.isArray(d.items) ? d.items : []).filter((i) => i && i.titulo && typeof i.query === 'string');
      setTimeout(revisarPod, 0);
      if (!items.length) return [h('li', { class: 'hint', text: 'No hay podcasts sugeridos por ahora.' })];
      const primero = items.find((i) => i.query === temaActual) || items[0];
      setTimeout(() => cargarEpisodios(primero), 0); /* recién abierto ya muestra episodios */
      return items.map((i) => {
        const li = tarjeta({
          emoji: '🎙️', sup: 'Tema', titulo: i.titulo, texto: i.razon,
          aria: 'Ver episodios de ' + i.titulo + (i.razon ? '. ' + i.razon : ''),
          alClic: () => { cargarEpisodios(i); $('episT').scrollIntoView({ block: 'nearest' }); }
        });
        const b = li.querySelector('button');
        if (b) { b.dataset.tema = i.query; b.setAttribute('aria-pressed', 'false'); }
        return li;
      });
    }, $('podAct'));
  }
  $('podAct').addEventListener('click', () => { if ($('podAct').getAttribute('aria-disabled') !== 'true') cargarPodcasts().then((ok) => { if (ok) P.toast('Podcasts actualizados.'); }); });
  /* ───────────── En vivo: emisoras de Monterrey por banda; cada tarjeta sintoniza (el motor la pide al servidor por su id) ───────────── */
  let vivoCargado = false;
  async function cargarEnVivo() {
    const c = $('vivoGrupos');
    c.setAttribute('aria-busy', 'true');
    c.replaceChildren(h('ul', { class: 'vivo-lista' }, P.esqueleto('fila', 6)));
    const r = await A.emisoras();
    c.removeAttribute('aria-busy');
    const grupos = r.ok && r.data ? R.gruposEmisoras(r.data.emisoras) : [];
    if (!grupos.length) {
      c.replaceChildren(h('div', { class: 'vacio' }, [h('p', { text: L.mensajeError(r.status) }), h('button', { type: 'button', class: 'primary', text: 'Reintentar', onclick: cargarEnVivo })]));
      return;
    }
    vivoCargado = true;
    c.replaceChildren(...grupos.map((g) => {
      const tid = 'vivoG-' + g.banda;
      return h('section', { class: 'vivo-grupo', 'aria-labelledby': tid }, [
        h('h3', { class: 'vivo-grupo-t', id: tid, text: g.titulo }),
        h('ul', { class: 'vivo-lista' }, g.emisoras.map((e) => h('li', {}, h('button', { type: 'button', class: 'vivo-card', 'data-emisora': e.id, onclick: () => sintonizar(e) }, [
          h('span', { class: 'vivo-frec', text: e.frecuencia }),
          h('span', { class: 'vivo-nombre', text: e.nombre }),
          h('span', { class: 'vivo-estilo', text: e.estilo }),
          h('span', { class: 'vivo-on', 'aria-hidden': 'true', text: 'Sonando' }),
          h('span', { class: 'sr-only vivo-on-txt' })
        ]))))
      ]);
    }));
    marcarVivo(P.estado());
  }
  function sintonizar(e) {
    P.cargando('Sintonizando ' + e.nombre, e.frecuencia);
    P.send({ cmd: 'emisora', emisora: { id: e.id, nombre: e.nombre, frecuencia: e.frecuencia, estilo: e.estilo } });
  }
  let vivoMarcada = null;
  function marcarVivo(s) {
    const id = s && s.track && s.track.live ? s.track.emisora : '';
    if (id === vivoMarcada) return;
    vivoMarcada = id;
    for (const b of document.querySelectorAll('[data-emisora]')) {
      const si = !!id && b.dataset.emisora === id;
      b.classList.toggle('sonando', si);
      b.querySelector('.vivo-on-txt').textContent = si ? ' (sonando ahora)' : '';
    }
  }
  P.on('state', (s) => { if (vivoCargado) marcarVivo(s); });
  P.on('sub', (s) => { if (s === 'envivo' && !vivoCargado) cargarEnVivo(); });
  if (P.subInicio() === 'envivo') cargarEnVivo();

  P.on('sub', (s) => { if (s === 'podcasts' && !podCargados) cargarPodcasts(); });
  if (P.subInicio() === 'podcasts') cargarPodcasts();

  cargarReco();
  cargarAnimos();
  cargarGeneros();
  P.on('usuario', alUsuario);
  alUsuario(P.usuario());
})();
