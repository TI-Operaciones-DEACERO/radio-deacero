/* letras.js — Letra y Karaoke a pantalla completa para lo que suena (GET /api/lyrics?…&sid=). Se carga al abrirla (L, K o los botones de la barra).
   Letra con tiempos: se resalta la línea según __player.getState().time. Solo texto: se desplaza en proporción a time/duration.
   Karaoke = la misma letra grande y centrada. No toca el audio del motor: solo lee su estado. */
(function () {
  'use strict';
  const P = window.Panel, h = P.h, E = window.EscuchaLogica;
  const reducido = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let dlg, tituloEl, estadoEl, cuerpo, bKaraoke, bSeguir;
  let karaoke = false, timer = 0, trackId = '', letra = null, idx = -2, pedido = 0, pausaAuto = 0, focoPrevio = null, seguir = true;
  const cache = new Map(); /* id de canción → letra normalizada (máx. 30) */
  /* La zona de estado es aria-live y paso() corre 4 veces por segundo: solo se escribe si el texto cambia (si no, se volvería a leer). */
  const estado = (t) => { if (estadoEl.textContent !== t) estadoEl.textContent = t; };

  function crear() {
    tituloEl = h('h2', { id: 'letrasTitulo', class: 'capa-t' });
    estadoEl = h('p', { class: 'capa-estado', role: 'status', 'aria-live': 'polite' });
    cuerpo = h('div', { class: 'letra-cuerpo', tabindex: '0', role: 'region', 'aria-label': 'Letra de la canción' });
    bKaraoke = h('button', { type: 'button', class: 'ghost corto', 'aria-pressed': 'false', text: 'Karaoke', title: 'Karaoke (K)', 'aria-keyshortcuts': 'K', onclick: () => modo(!karaoke) });
    /* WCAG 2.2.2: el desplazamiento automático (contenido que se mueve más de 5 s) se puede detener */
    bSeguir = h('button', { type: 'button', class: 'ghost corto', 'aria-pressed': 'true', text: 'Seguir la canción', title: 'Desplazar la letra sola', onclick: () => {
      seguir = !seguir; bSeguir.setAttribute('aria-pressed', String(seguir)); pausaAuto = 0; idx = -2; paso();
    } });
    const cerrar = h('button', { type: 'button', class: 'ico ghost-ico', 'aria-label': 'Cerrar la letra', title: 'Cerrar (Esc)', onclick: () => dlg.close() }, P.icono('close', 22));
    /* el nombre del cuadro es «Letra» o «Karaoke» + el título (sin canción, al menos el modo) */
    dlg = h('dialog', { id: 'letras', class: 'capa', 'aria-labelledby': 'letrasModo letrasTitulo' }, [
      h('div', { class: 'capa-cab' }, [h('div', { class: 'capa-tit' }, [h('p', { class: 'capa-sup', id: 'letrasModo', text: 'Letra' }), tituloEl]), h('div', { class: 'capa-acc' }, [bKaraoke, bSeguir, cerrar])]),
      estadoEl, cuerpo
    ]);
    dlg.addEventListener('close', () => {
      clearInterval(timer); timer = 0;
      const f = focoPrevio; focoPrevio = null;
      if (f && f.focus && document.contains(f)) f.focus();
    });
    /* si la persona desplaza a mano, el desplazamiento automático espera unos segundos */
    const manual = () => { pausaAuto = Date.now() + 6000; };
    cuerpo.addEventListener('wheel', manual, { passive: true });
    cuerpo.addEventListener('touchstart', manual, { passive: true });
    cuerpo.addEventListener('keydown', (e) => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(e.key)) manual(); });
    document.body.appendChild(dlg);
  }

  function modo(k) {
    karaoke = !!k;
    dlg.classList.toggle('karaoke', karaoke);
    bKaraoke.setAttribute('aria-pressed', String(karaoke));
    dlg.querySelector('.capa-sup').textContent = karaoke ? 'Karaoke' : 'Letra';
    dlg.querySelector('.capa-acc .ico').setAttribute('aria-label', karaoke ? 'Cerrar el karaoke' : 'Cerrar la letra');
    idx = -2; pausaAuto = 0;
    paso();
  }

  const estadoMotor = () => { const p = P.player(); try { return p ? p.getState() : null; } catch (_) { return null; } };

  function pintarLineas() {
    cuerpo.replaceChildren(...letra.lineas.map((l) => h('p', { class: 'letra-linea' + (l.text ? '' : ' vacia'), text: l.text || ' ' })));
    cuerpo.scrollTop = 0;
    idx = -2;
  }

  async function cargarLetra(t) {
    trackId = t.id; letra = null; idx = -2;
    tituloEl.textContent = t.title || '';
    cuerpo.replaceChildren();
    if (cache.has(t.id)) { letra = cache.get(t.id); return mostrarLetra(); }
    estado('Buscando la letra…');
    const yo = ++pedido;
    const r = await P.api.letra(P.sid(), t);
    if (yo !== pedido || trackId !== t.id) return;
    letra = r.ok ? E.normalizarLetra(r.data) : E.normalizarLetra(null);
    if (r.ok || r.status === 404) { cache.set(t.id, letra); if (cache.size > 30) cache.delete(cache.keys().next().value); }
    if (!r.ok && r.status !== 404) { estado(r.status === 401 ? 'No se pudo pedir la letra (falta la sesión del reproductor). Toca Radio y vuelve a intentarlo.' : P.L.mensajeError(r.status)); return; }
    mostrarLetra();
  }
  function mostrarLetra() {
    if (letra.tipo === 'ninguna') { estado('No encontramos la letra de esta canción.'); return; }
    estado(letra.tipo === 'synced' ? 'Letra sincronizada.' : 'Esta letra no trae tiempos: se desplaza según el avance de la canción.');
    pintarLineas();
    paso();
  }

  function centrar(el) {
    if (!el) return;
    const top = el.offsetTop - cuerpo.clientHeight / 2 + el.offsetHeight / 2;
    cuerpo.scrollTo({ top: Math.max(0, top), behavior: reducido() ? 'auto' : 'smooth' });
  }

  /* Cada 250 ms: si cambió la canción se pide su letra; si no, se mueve el resaltado/desplazamiento. */
  function paso() {
    const s = estadoMotor();
    const t = s && s.track;
    if (!t) { if (trackId) { trackId = ''; letra = null; cuerpo.replaceChildren(); tituloEl.textContent = ''; } estado('No está sonando nada.'); return; }
    if (t.id !== trackId) { cargarLetra(t); return; }
    if (!letra || letra.tipo === 'ninguna') return;
    const kids = cuerpo.children;
    const time = Number(s.time) || 0, dur = Number(t.duration) || 0;
    let i;
    if (letra.tipo === 'synced') i = E.lineaActiva(letra.lineas, time + 0.25);
    else if (karaoke) i = E.lineaProporcional(time, dur, letra.lineas.length);
    else {
      /* texto sin tiempos en modo normal: solo desplazamiento proporcional, sin resaltar (sería inventar el ritmo) */
      if (seguir && Date.now() > pausaAuto) { const y = E.desplazamientoProporcional(time, dur, cuerpo.scrollHeight, cuerpo.clientHeight); if (Math.abs(cuerpo.scrollTop - y) > 2) cuerpo.scrollTop = y; }
      return;
    }
    if (i === idx) return;
    idx = i;
    for (let k = 0; k < kids.length; k++) {
      kids[k].classList.toggle('on', k === i);
      kids[k].classList.toggle('pasada', k < i);
      if (k === i) kids[k].setAttribute('aria-current', 'true'); else kids[k].removeAttribute('aria-current');
    }
    if (seguir && Date.now() > pausaAuto) centrar(kids[Math.max(0, i)]);
  }

  function abrir(op) {
    if (!dlg) crear();
    if (!dlg.open) { focoPrevio = document.activeElement; dlg.showModal(); }
    modo(!!op.karaoke);
    if (!timer) timer = setInterval(paso, 250);
    paso();
    dlg.querySelector('.capa-acc .ico').focus();
  }

  P.modulos.letras = {
    abrir,
    cerrar: () => { if (dlg && dlg.open) dlg.close(); },
    abierto: () => !!(dlg && dlg.open),
    karaoke: () => karaoke,
    modo
  };
})();
