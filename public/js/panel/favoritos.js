/* favoritos.js — vista Favoritos: Mis Me gusta, Playlists e Historial.
   Sin cuenta se ven los Me gusta de este navegador; playlists e historial piden entrar con la nómina. Todo con textContent (Panel.h). */
(function () {
  'use strict';
  const P = window.Panel, h = P.h, L = P.L, A = P.api, U = window.Util;
  const els = {};
  let activa = 'likes', abierta = null, subtabs = null; /* abierta = id de la playlist que se está viendo */

  /* ───────────── piezas comunes ───────────── */
  const cuentaTxt = (n) => (n === 1 ? '1 canción' : n + ' canciones');
  const duracion = (t) => (t && t.duration > 0 ? ' · ' + U.fmtTime(t.duration) : '');

  /* Sin nómina todo se guarda en este navegador: se avisa arriba, con la opción de entrar. */
  function avisoLocal(el) {
    if (P.usuario() || !el.firstChild) return;
    el.prepend(h('div', { class: 'aviso-local' }, [
      h('p', { class: 'aviso', text: 'Se guarda solo en este navegador. Entra con tu nómina para tenerlo en tu cuenta, en cualquier equipo.' }),
      h('button', { type: 'button', class: 'ghost corto', text: 'Entrar con mi nómina', onclick: () => P.abrirCuenta() })
    ]));
  }
  function errorCon(r, reintentar) {
    return h('div', { class: 'vacio' }, [h('p', { text: L.mensajeError(r.status) }), h('button', { type: 'button', class: 'primary', text: 'Reintentar', onclick: reintentar })]);
  }

  /* Fila de canción: título, canal·duración y las acciones que se pasen. */
  function fila(t, acciones, extra) {
    return h('li', { class: 'fila' }, [
      h('div', { class: 'fila-info' }, [h('span', { class: 'fila-t', text: t.title || '(sin título)' }), h('span', { class: 'fila-s', text: (t.channel || '') + duracion(t) + (extra || '') })]),
      h('div', { class: 'fila-acc' }, acciones)
    ]);
  }
  const btnPlay = (t, alClic) => h('button', { type: 'button', 'data-f': 'play', class: 'ico ghost-ico', 'aria-label': 'Reproducir ' + (t.title || 'canción'), title: 'Reproducir', onclick: alClic }, P.icono('play', 22));
  const btnTexto = (texto, aria, alClic, clase) => h('button', { type: 'button', 'data-f': texto === 'Quitar' ? 'quitar' : false, class: clase || 'ghost corto', text: texto, 'aria-label': aria, onclick: alClic });

  /* Foco al repintar: se anota dónde estaba y, ya repintado, vuelve al mismo lugar (al siguiente «Quitar», por ejemplo) o, si ese elemento ya no existe, al título de la sección. */
  function foco(cont) {
    const a = document.activeElement;
    if (!a || !cont.contains(a)) return () => {};
    const tipo = a.getAttribute('data-f') || '';
    const i = tipo ? Array.from(cont.querySelectorAll('[data-f="' + tipo + '"]')).indexOf(a) : -1;
    return () => {
      if (cont.contains(document.activeElement)) return;
      const lista = tipo ? Array.from(cont.querySelectorAll('[data-f="' + tipo + '"]')) : [];
      const t = lista.length && i >= 0 ? lista[Math.min(i, lista.length - 1)] : cont.querySelector('h2');
      if (!t) return;
      if (!t.matches('button, a, input, select')) t.tabIndex = -1;
      t.focus();
    };
  }

  /* ───────────── Mis Me gusta ───────────── */
  function pintarLikes() { const v = foco(els.likes); pintarLikesInt(); v(); }
  function pintarLikesInt() {
    const lista = P.reacciones.lista('like').map((x) => x.track);
    const partes = [h('div', { class: 'sub-cab' }, [h('h2', { text: 'Mis Me gusta' }), h('span', { class: 'contador', 'aria-live': 'polite', text: cuentaTxt(lista.length) })])];
    if (!P.usuario()) {
      partes.push(h('p', { class: 'aviso', text: 'Estos Me gusta se guardan solo en este navegador. Entra con tu nómina y se guardan en tu cuenta para que los tengas donde sea.' }));
      partes.push(h('div', { class: 'row izq' }, [h('button', { type: 'button', class: 'ghost', text: 'Entrar con mi nómina', onclick: () => P.abrirCuenta() })]));
    }
    if (!lista.length) {
      partes.push(h('p', { class: 'hint', text: 'Todavía no tienes Me gusta. Mientras suena una canción, toca el pulgar hacia arriba de la barra de abajo.' }));
    } else {
      partes.push(h('div', { class: 'row izq' }, [h('button', { type: 'button', class: 'primary', text: 'Reproducir todo', onclick: () => { P.cargando('Preparando tus Me gusta'); P.send(L.queueFromTracks(lista)); } })]));
      partes.push(h('ul', { class: 'filas' }, lista.map((t) => fila(t, [
        btnPlay(t, () => P.send(L.queueFromTracks(lista, t.id))),
        btnTexto('Quitar', 'Quitar de Me gusta: ' + t.title, () => P.reacciones.alternar(t, 'like'))
      ]))));
    }
    els.likes.replaceChildren(...partes);
  }

  /* ───────────── Playlists ───────────── */
  async function pintarPlaylists() { const v = foco(els.playlists); await pintarPlaylistsInt(); avisoLocal(els.playlists); v(); }
  async function pintarPlaylistsInt() {
    if (abierta) return pintarDetalle(abierta);
    els.playlists.setAttribute('aria-busy', 'true');
    els.playlists.replaceChildren(h('p', { class: 'cargando', text: 'Cargando tus playlists…' }));
    const r = await A.playlists();
    els.playlists.removeAttribute('aria-busy');
    if (abierta) return;
    if (!r.ok) { els.playlists.replaceChildren(errorCon(r, pintarPlaylists)); return; }
    const pls = Array.isArray(r.data) ? r.data : [];
    const nombre = h('input', { id: 'plNuevo', type: 'text', maxlength: '60', autocomplete: 'off', placeholder: 'Nombre de la playlist' });
    const err = h('p', { class: 'err', id: 'plNuevoErr', role: 'alert', hidden: true });
    const crear = h('button', { type: 'submit', class: 'primary', text: 'Crear' });
    const form = h('form', { class: 'form-linea', novalidate: true }, [h('label', { for: 'plNuevo', text: 'Nueva playlist' }), h('div', { class: 'campo-fila' }, [nombre, crear]), err]);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      P.errorCampo(nombre, err, '');
      const n = nombre.value.trim();
      if (!n) { P.errorCampo(nombre, err, 'Escribe un nombre para la playlist.'); return; }
      crear.disabled = true;
      const c = await A.crearPlaylist(n);
      crear.disabled = false;
      if (!c.ok) { P.errorCampo(nombre, err, c.status === 400 ? 'No se pudo crear: revisa el nombre o puede que ya tengas el máximo de playlists.' : L.mensajeError(c.status)); return; }
      P.toast('Playlist «' + n + '» creada.');
      pintarPlaylists();
    });
    els.playlists.replaceChildren(
      h('div', { class: 'sub-cab' }, [h('h2', { text: 'Playlists' }), h('span', { class: 'contador', text: pls.length === 1 ? '1 playlist' : pls.length + ' playlists' })]),
      form,
      pls.length
        ? h('ul', { class: 'filas' }, pls.map((p) => h('li', {}, h('button', { type: 'button', class: 'fila-btn', 'aria-label': 'Abrir la playlist ' + p.name + ', ' + cuentaTxt(p.count), onclick: () => { abierta = p.id; pintarPlaylists(); } }, [h('span', { text: p.name }), h('span', { class: 'muted', text: cuentaTxt(p.count) })]))))
        : h('p', { class: 'hint', text: 'Todavía no tienes playlists. Crea la primera arriba, o usa el botón + de la barra mientras suena una canción.' })
    );
  }

  async function pintarDetalle(id) { const v = foco(els.playlists); await pintarDetalleInt(id); v(); }
  async function pintarDetalleInt(id) {
    els.playlists.setAttribute('aria-busy', 'true');
    els.playlists.replaceChildren(h('p', { class: 'cargando', text: 'Cargando la playlist…' }));
    const r = await A.playlist(id);
    els.playlists.removeAttribute('aria-busy');
    if (abierta !== id) return;
    if (!r.ok || !r.data) {
      if (r.status === 404) { abierta = null; pintarPlaylists(); return; }
      els.playlists.replaceChildren(errorCon(r, () => pintarDetalle(id)), h('button', { type: 'button', class: 'link', text: 'Volver a mis playlists', onclick: () => { abierta = null; pintarPlaylists(); } }));
      return;
    }
    const pl = r.data;
    const tracks = Array.isArray(pl.tracks) ? pl.tracks : [];
    const nombre = h('input', { id: 'plRen', type: 'text', maxlength: '60', value: pl.name, autocomplete: 'off' });
    const ren = h('form', { class: 'form-linea', novalidate: true }, [h('label', { for: 'plRen', text: 'Cambiar nombre' }), h('div', { class: 'campo-fila' }, [nombre, h('button', { type: 'submit', class: 'ghost', text: 'Guardar nombre' })])]);
    ren.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const n = nombre.value.trim();
      if (!n) { P.toast('Escribe un nombre para la playlist.'); return; }
      const x = await A.renombrarPlaylist(id, n);
      if (!x.ok) { P.toastError(L.mensajeError(x.status)); return; }
      P.toast('Nombre actualizado.');
      pintarDetalle(id);
    });
    els.playlists.replaceChildren(
      h('button', { type: 'button', class: 'link', text: '‹ Mis playlists', onclick: () => { abierta = null; pintarPlaylists(); } }),
      h('div', { class: 'sub-cab' }, [h('h2', { text: pl.name }), h('span', { class: 'contador', text: cuentaTxt(tracks.length) })]),
      h('div', { class: 'row izq' }, [
        tracks.length ? h('button', { type: 'button', class: 'primary', text: 'Reproducir todo', onclick: () => { P.cargando('Preparando «' + pl.name + '»'); P.send(L.queueFromTracks(tracks)); } }) : null,
        h('button', { type: 'button', class: 'ghost danger-b', text: 'Borrar playlist', onclick: async () => {
          if (!window.confirm('¿Borrar la playlist «' + pl.name + '»? Esto no se puede deshacer.')) return;
          const x = await A.borrarPlaylist(id);
          if (!x.ok && x.status !== 404) { P.toastError(L.mensajeError(x.status)); return; }
          P.toast('Playlist borrada.');
          abierta = null;
          pintarPlaylists();
        } })
      ]),
      ren,
      tracks.length
        ? h('ul', { class: 'filas' }, tracks.map((t) => fila(t, [
          btnPlay(t, () => P.send(L.queueFromTracks(tracks, t.id))),
          btnTexto('Quitar', 'Quitar de la playlist: ' + t.title, async () => {
            const x = await A.quitarDePlaylist(id, t.id);
            if (!x.ok && x.status !== 404) { P.toastError(L.mensajeError(x.status)); return; }
            pintarDetalle(id);
          })
        ])))
        : h('p', { class: 'hint', text: 'Esta playlist está vacía. Mientras suena una canción, usa el botón + de la barra de abajo para agregarla.' })
    );
  }

  /* ───────────── Historial ───────────── */
  const fechaTxt = (at) => { try { return ' · ' + new Date(at).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; } };

  async function pintarHistorial() { const v = foco(els.historial); await pintarHistorialInt(); avisoLocal(els.historial); v(); }
  async function pintarHistorialInt() {
    els.historial.setAttribute('aria-busy', 'true');
    els.historial.replaceChildren(h('p', { class: 'cargando', text: 'Cargando tu historial…' }));
    const r = await A.historial(100);
    els.historial.removeAttribute('aria-busy');
    if (!r.ok) { els.historial.replaceChildren(errorCon(r, pintarHistorial)); return; }
    const items = (Array.isArray(r.data) ? r.data : []).filter((x) => x && x.track);
    els.historial.replaceChildren(
      h('div', { class: 'sub-cab' }, [h('h2', { text: 'Historial' }), h('span', { class: 'contador', text: cuentaTxt(items.length) })]),
      items.length ? h('div', { class: 'row izq' }, [h('button', { type: 'button', class: 'ghost danger-b', text: 'Borrar historial', onclick: async () => {
        if (!window.confirm('¿Borrar todo tu historial de reproducción?')) return;
        const x = await A.borrarHistorial();
        if (!x.ok) { P.toastError(L.mensajeError(x.status)); return; }
        P.toast('Historial borrado.');
        pintarHistorial();
      } })]) : null,
      items.length
        ? h('ul', { class: 'filas' }, items.map((x) => fila(x.track, [btnPlay(x.track, () => { P.cargando('Preparando «' + x.track.title + '»', 'Después siguen canciones parecidas.'); P.send({ cmd: 'track', kind: 'song', track: x.track }); })], fechaTxt(x.at))))
        : h('p', { class: 'hint', text: 'Aún no hay nada en tu historial. Las canciones que escuches con tu cuenta aparecerán aquí.' })
    );
  }

  /* ───────────── armado ───────────── */
  const SUBS = [
    { id: 'likes', titulo: 'Mis Me gusta', pintar: pintarLikes },
    { id: 'playlists', titulo: 'Playlists', pintar: pintarPlaylists },
    { id: 'historial', titulo: 'Historial', pintar: pintarHistorial }
  ];

  function montar(el) {
    el.classList.add('vista-int');
    const lista = h('div', { class: 'tablist sub', role: 'tablist', 'aria-label': 'Tu biblioteca' }, SUBS.map((s, i) => h('button', {
      type: 'button', class: 'tab', role: 'tab', id: 'ft-' + s.id, 'aria-selected': String(i === 0), 'aria-controls': 'fp-' + s.id, tabindex: i === 0 ? '0' : '-1', text: s.titulo
    })));
    for (const s of SUBS) els[s.id] = h('div', { class: 'subpnl', role: 'tabpanel', id: 'fp-' + s.id, 'aria-labelledby': 'ft-' + s.id, tabindex: '0', hidden: s.id !== 'likes' });
    el.append(h('h1', { class: 'vt', text: 'Favoritos' }), h('nav', { class: 'subtabs', 'aria-label': 'Secciones de Favoritos' }, lista), ...SUBS.map((s) => els[s.id]));
    subtabs = P.tablist(lista, (_, i) => {
      activa = SUBS[i].id;
      SUBS.forEach((s) => { els[s.id].hidden = s.id !== activa; });
      SUBS[i].pintar();
    });
    pintarLikes();

    P.on('reacciones', () => { if (activa === 'likes') pintarLikes(); });
    P.on('playlists', () => { if (activa === 'playlists' && P.pestana() === 'favoritos') pintarPlaylists(); });
    P.on('usuario', () => { abierta = null; SUBS.find((s) => s.id === activa).pintar(); });
  }

  P.vistas.favoritos = {
    montar,
    mostrar() { SUBS.find((s) => s.id === activa).pintar(); },
    /* Desde el menú (Historial, Favoritos y playlists): abre esa subpestaña. */
    sub(id) { const i = SUBS.findIndex((s) => s.id === id); if (subtabs && i >= 0 && SUBS[i].id !== activa) subtabs.elegir(i, false); }
  };
})();
