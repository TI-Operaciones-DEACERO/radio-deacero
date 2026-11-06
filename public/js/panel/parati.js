/* parati.js — vista "Para ti": Ahora (géneros por la hora), Hecho para ti, Descubrir, Podcasts y Playlist IA.
   Todo lo que llega del servidor se pinta con textContent (Panel.h). `fuente` indica si la sugerencia la dio la IA o las reglas locales. */
(function () {
  'use strict';
  const P = window.Panel, h = P.h, L = P.L, A = P.api;
  const NO_GENERO = ['search', 'podcast', 'lista']; /* "géneros" internos del motor: no sirven como preferencia */

  /* ───────────── piezas comunes ───────────── */
  function tarjeta({ emoji, titulo, texto, nuevo, alClic }) {
    const e = h('span', { class: 'card-e' });
    P.emo(e, emoji || '🎵');
    const b = h('button', { type: 'button', class: 'card', onclick: alClic }, [
      e,
      h('span', { class: 'card-t', text: titulo }),
      texto ? h('span', { class: 'card-s', text: texto }) : null,
      nuevo ? h('span', { class: 'insignia', text: 'Nuevo' }) : null
    ]);
    return b;
  }
  const rejilla = (cards) => h('div', { class: 'rejilla' }, cards);
  const fuenteEl = (fuente) => h('p', { class: 'fuente', text: L.fuenteTexto(fuente) });
  const vacio = (t) => h('p', { class: 'hint', text: t });

  function tocarGenero(g) {
    P.toast('Cambiando a ' + g.label + '…', 2500);
    P.send({ cmd: 'genre', id: g.id });
  }
  function tocarConsulta(nombre, query) {
    P.toast('Buscando «' + nombre + '»…', 2500);
    P.send({ cmd: 'search', q: String(query).slice(0, 100) });
  }

  /* Pide, muestra "Cargando…", y pinta o muestra un error amable con Reintentar. */
  async function cargarEn(cuerpo, pedir, pintar) {
    cuerpo.setAttribute('aria-busy', 'true');
    cuerpo.replaceChildren(h('p', { class: 'cargando', text: 'Cargando…' }));
    const r = await pedir();
    cuerpo.removeAttribute('aria-busy');
    if (!r.ok || !r.data) {
      cuerpo.replaceChildren(h('div', { class: 'vacio' }, [
        h('p', { text: L.mensajeError(r.status) }),
        h('button', { type: 'button', class: 'primary', text: 'Reintentar', onclick: () => cargarEn(cuerpo, pedir, pintar) })
      ]));
      return false;
    }
    cuerpo.replaceChildren(...pintar(r.data));
    return true;
  }

  /* Un panel de sub-pestaña con su título, el botón Actualizar y el cuerpo. */
  function panelSub(id, titulo, intro, pedir, pintar) {
    const cuerpo = h('div', { class: 'cuerpo' });
    const act = h('button', { type: 'button', class: 'ghost corto', text: 'Actualizar', onclick: () => cargarEn(cuerpo, pedir, pintar) });
    const el = h('div', { class: 'subpnl', role: 'tabpanel', id: 'sp-' + id, 'aria-labelledby': 'st-' + id, tabindex: '0', hidden: true }, [
      h('div', { class: 'sub-cab' }, [h('h2', { text: titulo }), act]),
      intro ? h('p', { class: 'hint', text: intro }) : null,
      cuerpo
    ]);
    return { el, cargar: () => cargarEn(cuerpo, pedir, pintar) };
  }

  /* ───────────── las cinco sub-vistas ───────────── */
  function subAhora() {
    return panelSub('ahora', 'Ahora', 'Géneros que van bien con esta hora del día.', () => A.iaAhora(), (d) => {
      const gens = Array.isArray(d.generos) ? d.generos : [];
      return [
        d.razon ? h('p', { class: 'razon', text: d.razon }) : null,
        fuenteEl(d.fuente),
        gens.length ? rejilla(gens.map((g) => tarjeta({ emoji: g.emoji, titulo: g.label, texto: g.razon, alClic: () => tocarGenero(g) }))) : vacio('No hay sugerencias por ahora.')
      ];
    });
  }

  function subParaTi() {
    return panelSub('parati', 'Hecho para ti', 'Artistas y canciones según lo que te gusta y lo que has escuchado.', () => A.iaParaTi(P.sid()), (d) => {
      const items = Array.isArray(d.items) ? d.items : [];
      return [
        fuenteEl(d.fuente),
        items.length ? rejilla(items.map((i) => tarjeta({ emoji: i.emoji, titulo: i.name, texto: i.reason, nuevo: i.isNew, alClic: () => tocarConsulta(i.name, i.query) }))) : vacio('Aún no hay sugerencias. Escucha un rato y marca tus Me gusta para afinarlas.')
      ];
    });
  }

  function subDescubrir() {
    return panelSub('descubrir', 'Descubrir', 'Artistas nuevos, con un poco de lo que ya te gusta.', () => {
      const s = P.estado();
      const g = s && s.genre && s.genre.id && !NO_GENERO.includes(s.genre.id) ? [s.genre.id] : [];
      return A.iaDescubrir(P.sid(), g, []);
    }, (d) => {
      const items = Array.isArray(d.items) ? d.items : [];
      return [
        fuenteEl(d.fuente),
        items.length ? rejilla(items.map((i) => tarjeta({ emoji: i.emoji, titulo: i.name, texto: i.reason, nuevo: i.isNew, alClic: () => tocarConsulta(i.name, i.query) }))) : vacio('Ya viste todo por ahora. Vuelve a actualizar en un rato.')
      ];
    });
  }

  function subPodcasts() {
    return panelSub('podcasts', 'Podcasts', 'Para escuchar a esta hora.', () => A.iaPodcasts(), (d) => {
      const items = Array.isArray(d.items) ? d.items : [];
      return items.length ? [rejilla(items.map((i) => tarjeta({ emoji: '🎙️', titulo: i.titulo, texto: i.razon, alClic: () => tocarConsulta(i.titulo, i.query) })))] : [vacio('No hay podcasts sugeridos por ahora.')];
    });
  }

  /* — Playlist IA: texto → lista de consultas; Reproducir todo usa la cola del motor; Guardar necesita cuenta — */
  function subPlaylist() {
    const campo = h('input', { id: 'plTexto', type: 'text', maxlength: '200', autocomplete: 'off', placeholder: 'Por ejemplo: música tranquila para concentrarme' });
    const crear = h('button', { type: 'submit', class: 'primary', text: 'Crear playlist' });
    const salida = h('div', { class: 'cuerpo' }); /* sin aria-live: se anuncia solo el resumen ("Lista lista: N canciones") */
    const form = h('form', { class: 'form-linea', novalidate: true }, [h('label', { for: 'plTexto', text: 'Describe lo que quieres escuchar' }), campo, h('div', { class: 'row izq' }, [crear])]);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const q = campo.value.trim();
      if (!q) { P.toast('Escribe qué quieres escuchar.'); campo.focus(); return; }
      crear.disabled = true;
      const bien = await cargarEn(salida, () => A.iaPlaylist(q), (d) => pintarPlaylist(d));
      crear.disabled = false;
      if (bien && ultimaN) P.toast('Lista lista: ' + ultimaN + (ultimaN === 1 ? ' canción.' : ' canciones.'));
    });
    const el = h('div', { class: 'subpnl', role: 'tabpanel', id: 'sp-playlist', 'aria-labelledby': 'st-playlist', tabindex: '0', hidden: true }, [
      h('div', { class: 'sub-cab' }, [h('h2', { text: 'Playlist IA' })]),
      h('p', { class: 'hint', text: 'Cuéntanos qué quieres escuchar y armamos una lista de canciones.' }),
      form, salida
    ]);
    return { el, cargar: () => {} };
  }

  let ultimaN = 0;
  function pintarPlaylist(d) {
    const consultas = (Array.isArray(d.consultas) ? d.consultas : []).filter((c) => c && typeof c.query === 'string' && c.query.trim());
    ultimaN = consultas.length;
    if (!consultas.length) return [vacio('No se pudo armar una lista con ese texto. Prueba describiéndolo de otra manera.')];
    const progreso = h('p', { class: 'hint', role: 'status' });
    const guardar = h('button', { type: 'button', class: 'ghost', text: 'Guardar como playlist' });
    guardar.addEventListener('click', () => guardarPlaylist(d, consultas, guardar, progreso));
    return [
      h('h3', { class: 'pl-nombre', text: d.nombre || 'Mezcla para ti' }),
      d.descripcion ? h('p', { class: 'hint', text: d.descripcion }) : null,
      fuenteEl(d.fuente),
      h('div', { class: 'row izq' }, [
        h('button', { type: 'button', class: 'primary', text: 'Reproducir todo', onclick: () => { P.toast('Reproduciendo la lista…', 2500); P.send(L.queueFromQueries(consultas)); } }),
        guardar
      ]),
      progreso,
      h('ol', { class: 'lista-cons' }, consultas.map((c) => h('li', {}, [
        h('span', { class: 'lc-t', text: c.query }),
        h('button', { type: 'button', class: 'ico ghost-ico', 'aria-label': 'Reproducir ' + c.query, title: 'Reproducir solo esta', onclick: () => tocarConsulta(c.query, c.query) }, P.icono('play', 22))
      ])))
    ];
  }

  /* Cada consulta se resuelve a una canción concreta (una búsqueda del servidor) y se agrega a una playlist nueva de la cuenta. */
  async function guardarPlaylist(d, consultas, boton, progreso) {
    if (!P.usuario()) { P.toast('Para guardar la playlist entra con tu nómina.'); P.abrirCuenta(); return; }
    boton.disabled = true;
    progreso.textContent = 'Creando la playlist…';
    const c = await A.crearPlaylist(d.nombre || 'Mezcla para ti');
    if (!c.ok || !c.data || !c.data.playlist) { progreso.textContent = c.status === 400 ? 'No se pudo crear la playlist (puede que ya tengas el máximo).' : L.mensajeError(c.status); boton.disabled = false; return; }
    const pl = c.data.playlist;
    let ok = 0;
    for (let i = 0; i < consultas.length; i++) {
      progreso.textContent = 'Buscando canciones para guardar: ' + (i + 1) + ' de ' + consultas.length + '…';
      const r = await A.resolverConsulta(P.sid(), consultas[i].query.slice(0, 100));
      const t = r.ok && r.data && L.cleanTrack(r.data.track);
      if (!t || !t.title) continue;
      const a = await A.agregarAPlaylist(pl.id, t);
      if (a.ok) ok++;
    }
    boton.disabled = false;
    progreso.textContent = 'Listo: «' + pl.name + '» quedó con ' + ok + ' de ' + consultas.length + ' canciones. La encuentras en Favoritos.';
    P.toast('Playlist «' + pl.name + '» guardada.');
    P.emit('playlists');
  }

  /* ───────────── armado ───────────── */
  function montar(el) {
    el.classList.add('vista-int');
    const subs = [
      { id: 'ahora', titulo: 'Ahora', v: subAhora() },
      { id: 'parati', titulo: 'Hecho para ti', v: subParaTi() },
      { id: 'descubrir', titulo: 'Descubrir', v: subDescubrir() },
      { id: 'podcasts', titulo: 'Podcasts', v: subPodcasts() },
      { id: 'playlist', titulo: 'Playlist IA', v: subPlaylist() }
    ];
    const lista = h('div', { class: 'tablist sub', role: 'tablist', 'aria-label': 'Sugerencias' }, subs.map((s, i) => h('button', {
      type: 'button', class: 'tab', role: 'tab', id: 'st-' + s.id, 'aria-selected': String(i === 0), 'aria-controls': 'sp-' + s.id, tabindex: i === 0 ? '0' : '-1', text: s.titulo
    })));
    el.append(h('h1', { class: 'vt', text: 'Para ti' }), h('nav', { class: 'subtabs', 'aria-label': 'Tipos de sugerencias' }, lista), ...subs.map((s) => s.v.el));
    const cargado = {};
    const t = P.tablist(lista, (_, i) => {
      subs.forEach((s, j) => { s.v.el.hidden = j !== i; });
      if (!cargado[subs[i].id]) { cargado[subs[i].id] = true; subs[i].v.cargar(); }
    }, { manual: true }); /* las flechas mueven el foco; Enter o Espacio activan (cada pestaña llama a la IA) */
    t.elegir(0, false);
  }

  P.vistas.parati = { montar };
})();
