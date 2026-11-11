/* buscar.js — vista Buscar: canción o artista a pantalla completa con GET /api/buscar?q=&sid= (lista de hasta 10 resultados).
   Tocar un resultado lo pone a sonar UNA vez en el motor ({ cmd:'track', kind:'search' }) y luego sigue la radio.
   Con cuenta: Me gusta y agregar a playlist (los mismos de la barra, vía Panel.reacciones y Panel.selectorPlaylist). */
(function () {
  'use strict';
  const P = window.Panel, h = P.h, E = window.EscuchaLogica, U = window.Util;
  let campo, estadoEl, lista, boton, ultima = '', pedido = 0, resultados = [];

  const dur = (t) => (t.duration > 0 ? ' · ' + U.fmtTime(t.duration) : '');

  function pintar() {
    lista.replaceChildren(...resultados.map((t) => {
      const r = P.reacciones.de(t.id);
      return h('li', { class: 'fila' }, [
        h('div', { class: 'fila-info' }, [h('span', { class: 'fila-t', text: t.title }), h('span', { class: 'fila-s', text: (t.channel || '') + dur(t) })]),
        h('div', { class: 'fila-acc' }, [
          h('button', { type: 'button', class: 'ico ghost-ico', 'data-f': 'play', 'aria-label': 'Reproducir ' + t.title, title: 'Reproducir', onclick: () => tocar(t) }, P.icono('play', 22)),
          h('button', { type: 'button', class: 'ico ghost-ico', 'data-f': 'video', 'aria-label': 'Ver video: ' + t.title, title: 'Ver video', onclick: () => tocar(t, true) }, P.fa('fa-tv')),
          h('button', { type: 'button', class: 'ico ghost-ico', 'data-f': 'like', 'aria-pressed': String(r === 'like'), 'aria-label': 'Me gusta: ' + t.title, title: 'Me gusta', onclick: () => P.reacciones.alternar(t, 'like') }, P.emo(h('span'), '👍')),
          h('button', { type: 'button', class: 'ico ghost-ico', 'aria-haspopup': 'dialog', 'aria-label': 'Agregar a una playlist: ' + t.title, title: 'Agregar a una playlist', onclick: () => P.selectorPlaylist(t) }, P.icono('plus', 22))
        ])
      ]);
    }));
  }

  async function tocar(t, video) {
    P.cargando('Preparando «' + t.title + '»', 'Después siguen canciones parecidas.');
    P.anunciarEscucha('cancion', t.title);
    if (!(await P.send({ cmd: 'track', kind: 'search', track: t }))) { P.finCarga(); return; }
    if (video) { P.finCarga(); P.abrirVideo(); } /* el video (sin sonido) sigue al audio, como en los podcasts; sin la capa de carga encima */
  }

  async function buscar() {
    const q = E.consultaBusqueda(campo.value);
    if (!q) { P.errorCampo(campo, estadoEl, E.mensajeBusqueda(400, 'FALTA_Q')); return; }
    P.errorCampo(campo, estadoEl, '');
    if (q === ultima && resultados.length) return;
    const yo = ++pedido;
    boton.disabled = true;
    lista.setAttribute('aria-busy', 'true');
    estadoEl.hidden = false;
    estadoEl.textContent = 'Buscando «' + q + '»…';
    lista.replaceChildren(...P.esqueleto('fila', 4));
    const r = await P.api.buscar(P.sid(), q);
    if (yo !== pedido) return; /* llegó tarde: ya se buscó otra cosa */
    boton.disabled = false;
    lista.removeAttribute('aria-busy');
    if (!r.ok) { resultados = []; pintar(); estadoEl.textContent = E.mensajeBusqueda(r.status, r.data && r.data.error); return; }
    ultima = q;
    resultados = E.limpiarResultados(r.data);
    pintar();
    estadoEl.textContent = resultados.length ? (resultados.length === 1 ? '1 resultado' : resultados.length + ' resultados') + ' para «' + q + '».' : 'No encontramos nada para «' + q + '». Prueba con otras palabras.';
  }

  function montar(el) {
    el.classList.add('vista-int', 'buscar');
    campo = h('input', { id: 'buscaQ', type: 'search', maxlength: '100', autocomplete: 'off', enterkeyhint: 'search', placeholder: 'Canción, artista o álbum' });
    boton = h('button', { type: 'submit', class: 'primary', text: 'Buscar' });
    estadoEl = h('p', { class: 'busca-estado', id: 'buscaEstado', role: 'status', 'aria-live': 'polite', hidden: true });
    lista = h('ul', { class: 'filas', 'aria-label': 'Resultados de la búsqueda' });
    const form = h('form', { class: 'form-linea busca-form', role: 'search', novalidate: true }, [
      h('label', { for: 'buscaQ', text: '¿Qué quieres escuchar?' }),
      h('div', { class: 'campo-fila' }, [campo, boton])
    ]);
    form.addEventListener('submit', (ev) => { ev.preventDefault(); buscar(); });
    el.append(h('h1', { class: 'vt', text: 'Buscar' }), h('p', { class: 'hint', text: 'Lo que elijas suena una vez y después sigue la radio. Atajo: tecla /' }), form, estadoEl, lista);
    P.on('reacciones', () => { if (resultados.length) { const a = document.activeElement, f = a && a.getAttribute('data-f'), i = f ? Array.from(lista.querySelectorAll('[data-f="' + f + '"]')).indexOf(a) : -1; pintar(); if (i >= 0) { const b = lista.querySelectorAll('[data-f="' + f + '"]')[i]; if (b) b.focus(); } } });
  }

  P.vistas.buscar = {
    montar,
    enfocar() { if (campo) { campo.focus(); campo.select(); } },
    /* Desde el buscador de la barra superior: busca ese texto aquí. */
    buscarTexto(q) { if (!campo) return; campo.value = String(q || '').slice(0, 100); buscar(); }
  };
})();
