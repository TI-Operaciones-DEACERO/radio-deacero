/* inicio.js — portada «Radio» (Inicio) del panel completo, como la del DEACERO Play anterior:
   Recomendado = carrusel «Mira lo que la IA tiene para ti» (/api/ia/ahora), «Bienestar rápido» (ánimos que llevan a Bienestar y arrancan
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

  /* Tarjeta del carrusel: color del género, emoji grande, título y razón. Es un botón; el texto completo se lee (no se corta). */
  function tarjeta({ emoji, color, titulo, sup, texto, aria, alClic }) {
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
    return h('li', {}, b);
  }

  /* Pide, muestra «Cargando…» y pinta, o un error amable con Reintentar. */
  async function cargarEn(lista, pedir, pintar, act) {
    lista.setAttribute('aria-busy', 'true');
    if (act) act.setAttribute('aria-disabled', 'true');
    lista.replaceChildren(h('li', { class: 'cargando', text: 'Cargando…' }));
    const r = await pedir();
    lista.removeAttribute('aria-busy');
    if (act) act.removeAttribute('aria-disabled');
    if (!r.ok || !r.data) {
      lista.replaceChildren(h('li', { class: 'vacio' }, [
        h('p', { text: L.mensajeError(r.status) }),
        h('button', { type: 'button', class: 'primary', text: 'Reintentar', onclick: () => cargarEn(lista, pedir, pintar, act) })
      ]));
      return false;
    }
    lista.replaceChildren(...pintar(r.data));
    return true;
  }

  /* ───────────── Recomendado: «Mira lo que la IA tiene para ti» ───────────── */
  const revisarReco = carrusel($('recoScroll'), $('recoPrev'), $('recoNext'));
  function cargarReco() {
    return cargarEn($('recoCards'), () => A.iaAhora(), (d) => {
      const gens = Array.isArray(d.generos) ? d.generos.filter((g) => g && typeof g.id === 'string' && g.label) : [];
      $('recoSub').textContent = d.razon || 'Seleccionado para este momento del día';
      $('recoFuente').textContent = L.fuenteTexto(d.fuente);
      setTimeout(revisarReco, 0);
      if (!gens.length) return [h('li', { class: 'hint', text: 'No hay sugerencias por ahora. Toca «Nuevas sugerencias» en un momento.' })];
      return gens.map((g) => tarjeta({
        emoji: g.emoji, color: g.color, sup: 'Radio continua', titulo: g.label, texto: g.razon,
        aria: 'Iniciar la radio de ' + g.label + (g.razon ? '. ' + g.razon : ''),
        alClic: () => P.radioGenero(g.id, g.label)
      }));
    }, $('recoAct'));
  }
  $('recoAct').addEventListener('click', () => { if ($('recoAct').getAttribute('aria-disabled') !== 'true') cargarReco(); });

  /* ───────────── Bienestar rápido: un ánimo lleva a Bienestar y arranca el viaje ───────────── */
  async function cargarAnimos() {
    const cont = $('bzqGrupos');
    const r = await A.bienestarOpciones();
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
    grid.replaceChildren(h('li', { class: 'cargando', text: 'Cargando géneros…' }));
    const r = await A.generos();
    const gens = r.ok ? R.generosDestacados(r.data) : [];
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
      return h('li', {}, b);
    }));
    P.remarcarSonando();
  }

  /* ───────────── Podcasts: temas (carrusel) → episodios con portada; cada uno se escucha o se ve en video ───────────── */
  const revisarPod = carrusel($('podScroll'), $('podPrev'), $('podNext'));
  let podCargados = false;
  const fmtDur = (s) => (s > 0 ? (s >= 3600 ? Math.floor(s / 3600) + ' h ' + Math.round((s % 3600) / 60) + ' min' : Math.round(s / 60) + ' min') : '');
  function episodio(t) {
    const img = h('img', { class: 'epi-img', alt: '', loading: 'lazy', decoding: 'async', width: '320', height: '180', src: '/api/thumb/' + encodeURIComponent(t.id) });
    img.addEventListener('error', () => { img.hidden = true; });
    const tocar = (video) => {
      P.cargando('Preparando el episodio', t.title);
      P.send({ cmd: 'track', kind: 'podcast', track: { id: t.id, title: t.title, channel: t.channel, duration: t.duration } });
      if (video) P.abrirVideo();
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
    });
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
  $('podAct').addEventListener('click', () => { if ($('podAct').getAttribute('aria-disabled') !== 'true') cargarPodcasts(); });
  P.on('sub', (s) => { if (s === 'podcasts' && !podCargados) cargarPodcasts(); });
  if (P.subInicio() === 'podcasts') cargarPodcasts();

  cargarReco();
  cargarAnimos();
  cargarGeneros();
})();
