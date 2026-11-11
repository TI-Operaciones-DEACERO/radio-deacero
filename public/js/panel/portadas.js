/* portadas.js — banner vivo de las tarjetas (género o artista): en vez de solo un emoji, la carátula de una canción de muestra y un miniclip
   mudo de unos segundos: SOLO, por turnos entre las tarjetas visibles (vitrina; se apaga en Apariencia), o al pasar el cursor / enfocar. Lo decorativo es aria-hidden: el nombre accesible sigue siendo el de la tarjeta.
   Pensado para la Raspberry y para redes lentas: las muestras se piden de una en una y solo cuando la tarjeta se ve; el clip solo con ratón, sin
   «reducir movimiento» ni ahorro de datos; uno a la vez y con tope de tiempo. Lo que llega del servidor solo son un id de video y un título. */
(function () {
  'use strict';
  const P = window.Panel, h = P.h, LO = window.PanelLocutor, A = P.api;
  const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
  const INTENCION_MS = 350;   /* el cursor debe quedarse un momento: pasar de largo no pide video */
  const TOPE_CLIP_MS = 30000; /* aunque se quede encima, el clip se corta */

  const entorno = () => ({
    hover: window.matchMedia('(hover: hover) and (pointer: fine)').matches,
    reducido: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    ahorro: !!(navigator.connection && navigator.connection.saveData)
  });

  /* — fila de espera: dos muestras a la vez (lo que el servidor atiende en paralelo; cada artista nuevo es una búsqueda) — */
  const A_LA_VEZ = 2;
  let enCurso = 0;
  const pendientes = [];
  function siguiente() {
    while (enCurso < A_LA_VEZ && pendientes.length) {
      const fn = pendientes.shift();
      enCurso++;
      Promise.resolve().then(fn).catch(() => { /* sin muestra: queda el emoji */ }).finally(() => { enCurso--; siguiente(); });
    }
  }
  const encolar = (fn) => { pendientes.push(fn); siguiente(); };

  /* — clip activo (solo uno en toda la página) — */
  let activo = null;
  function pararClip() {
    if (!activo) return;
    const eraAuto = activo.auto;
    clearTimeout(activo.espera); clearTimeout(activo.tope);
    if (activo.video) { try { activo.video.pause(); } catch (_) { /* nada */ } activo.video.removeAttribute('src'); activo.video.load(); activo.video.remove(); }
    activo.card.classList.remove('con-clip');
    activo = null;
    programarVitrina(eraAuto ? LO.VITRINA_PAUSA_SEG * 1000 : 4000); /* tras uno de la vitrina, el siguiente; tras uno a mano, una pausa más larga */
  }
  /* auto = lo pide la vitrina (no hace falta ratón); a mano = cursor o teclado. */
  function iniciarClip(card, auto) {
    const m = card._muestra;
    if (!m || !VIDEO_ID.test(m.id) || (activo && activo.card === card)) return;
    if (auto ? !LO.puedeVitrina(entornoVitrina()) : !LO.puedeMiniclip(entorno())) return;
    if (auto && activo) return; /* la vitrina nunca le quita el lugar a un clip pedido a mano */
    pararClip();
    clearTimeout(vitrina.timer);
    const a = (activo = { card, video: null, espera: 0, tope: 0, auto: !!auto });
    a.espera = setTimeout(() => {
      if (activo !== a) return;
      const v = h('video', { class: 'portada-clip', muted: true, playsinline: true, preload: 'auto', 'aria-hidden': 'true', tabindex: '-1' });
      v.muted = true; v.defaultMuted = true; v.disablePictureInPicture = true;
      v.addEventListener('loadedmetadata', () => { const t = LO.inicioClip(v.duration); if (t > 0) { try { v.currentTime = t; } catch (_) { /* sin seek */ } } });
      /* Sin bucle: el clip dura CLIP_SEG (5 s) desde que empieza a verse y se quita solo (WCAG 2.2.2). */
      v.addEventListener('playing', () => { if (activo !== a) return; card.classList.add('con-clip'); clearTimeout(a.tope); a.tope = setTimeout(() => { if (activo === a) pararClip(); }, LO.CLIP_SEG * 1000); });
      v.addEventListener('error', () => { if (activo === a) pararClip(); });
      v.src = '/api/play/' + encodeURIComponent(m.id) + '?mode=video';
      a.video = v;
      card.prepend(v);
      v.play().catch(() => { if (activo === a) pararClip(); });
      a.tope = setTimeout(() => { if (activo === a) pararClip(); }, TOPE_CLIP_MS);
    }, auto ? 0 : INTENCION_MS);
  }

  /* — vitrina: por turnos, solo tarjetas con portada que se ven en pantalla (no las de otra pestaña ni las que quedaron fuera del carrusel) — */
  const LS_VITRINA = 'pl_vitrina';
  const vitrina = { activa: P.store.get(LS_VITRINA) !== '0', timer: 0, ultima: null };
  const entornoVitrina = () => ({ activa: vitrina.activa, reducido: entorno().reducido, ahorro: entorno().ahorro, visible: !document.hidden });
  function seVe(c) {
    if (!c.isConnected || !c.offsetParent) return false;
    const r = c.getBoundingClientRect();
    return r.width > 0 && r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth && r.right <= window.innerWidth + 2 && r.left >= -2;
  }
  function turnoVitrina() {
    if (activo || !LO.puedeVitrina(entornoVitrina())) return programarVitrina(4000);
    const visibles = [...document.querySelectorAll('.con-portada')].filter((c) => c._muestra && seVe(c));
    const i = LO.siguienteVitrina(visibles.length, visibles.indexOf(vitrina.ultima));
    if (i < 0) return programarVitrina(4000);
    vitrina.ultima = visibles[i];
    iniciarClip(visibles[i], true);
    if (!activo) programarVitrina(2000);
  }
  function programarVitrina(ms) {
    clearTimeout(vitrina.timer);
    if (!vitrina.activa) return;
    vitrina.timer = setTimeout(turnoVitrina, ms);
  }
  function activarVitrina(si) {
    vitrina.activa = !!si;
    if (vitrina.activa) { P.store.del(LS_VITRINA); programarVitrina(500); }
    else { P.store.set(LS_VITRINA, '0'); clearTimeout(vitrina.timer); if (activo && activo.auto) pararClip(); }
  }

  function ponerPortada(card, m) {
    card._muestra = m;
    const img = h('img', { class: 'portada-img', alt: '', 'aria-hidden': 'true', decoding: 'async', width: '320', height: '180', src: '/api/thumb/' + encodeURIComponent(m.id) });
    img.addEventListener('load', () => { card.classList.add('con-portada'); });
    img.addEventListener('error', () => img.remove()); /* sin carátula: queda el emoji de siempre */
    card.prepend(h('span', { class: 'portada-vel', 'aria-hidden': 'true' }));
    card.prepend(img);
  }

  async function pedir(card) {
    const q = card._quiero;
    if (!q || card._muestra || !card.isConnected) return;
    const r = q.tipo === 'genero' ? await A.muestraGenero(q.clave) : await A.muestraArtista(q.clave, P.sid());
    if (r.ok && r.data && VIDEO_ID.test(String(r.data.id || ''))) ponerPortada(card, { id: r.data.id, duration: Number(r.data.duration) || 0 });
  }

  const io = 'IntersectionObserver' in window
    ? new IntersectionObserver((entradas) => {
      for (const e of entradas) if (e.isIntersecting) { io.unobserve(e.target); const c = e.target; encolar(() => pedir(c)); }
    }, { rootMargin: '120px' })
    : null;

  /* tipo: 'genero' (clave = id del género) | 'artista' (clave = nombre o consulta del artista) */
  function portada(card, quiero) {
    if (!card || !quiero || !quiero.clave) return;
    card._quiero = quiero;
    if (io) io.observe(card);
    card.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse' || e.pointerType === 'pen') iniciarClip(card); });
    card.addEventListener('pointerleave', () => { if (activo && activo.card === card) pararClip(); });
    card.addEventListener('focusin', () => iniciarClip(card));
    card.addEventListener('focusout', () => { if (activo && activo.card === card) pararClip(); });
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) { pararClip(); clearTimeout(vitrina.timer); } else programarVitrina(1500); });
  programarVitrina(3000);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') pararClip(); }); /* WCAG 1.4.13: se puede descartar lo que aparece al pasar o enfocar */

  P.portada = portada;
  P.vitrina = { activa: () => vitrina.activa, activar: activarVitrina };
})();
