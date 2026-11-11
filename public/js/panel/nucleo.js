/* nucleo.js — el armazón del panel completo con el aspecto del DEACERO Play anterior: barra lateral (menú y Descubrir), barra superior
   (buscador, cuenta, apariencia y ayuda), navegación entre secciones, motor de audio OCULTO, barra de reproducción (Me gusta / No me gusta /
   playlist, progreso, volumen, letra, karaoke, visualizador, naturaleza), avisos, atajos de teclado y carga perezosa de las vistas.
   La lógica sin DOM vive en logica.js y radio-logica.js. */
(function () {
  'use strict';
  const L = window.PanelLogica, R = window.PanelRadio, LO = window.PanelLocutor, A = window.PlayApi;
  const $ = (id) => document.getElementById(id);
  const bus = new EventTarget();

  /* — utilidades de DOM: SIEMPRE createElement/textContent; nunca innerHTML con datos del servidor — */
  function h(tag, props, kids) {
    const el = document.createElement(tag);
    for (const k in props || {}) {
      const v = props[k];
      if (v === undefined || v === null || v === false) continue;
      if (k === 'text') el.textContent = v;
      else if (k === 'class') el.className = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of [].concat(kids || [])) { if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c))); }
    return el;
  }

  /* Icono del sprite del HTML (#i-play, #i-pause, #i-next, #i-plus): SVG de verdad, no un elemento desconocido. */
  function icono(id, tam) {
    const ns = 'http://www.w3.org/2000/svg';
    const s = document.createElementNS(ns, 'svg'), u = document.createElementNS(ns, 'use');
    s.setAttribute('width', tam || 22); s.setAttribute('height', tam || 22); s.setAttribute('aria-hidden', 'true');
    u.setAttribute('href', '#i-' + id);
    s.appendChild(u);
    return s;
  }
  /* Icono de Font Awesome (decorativo: el nombre accesible va en el botón). */
  const fa = (nombre, estilo) => h('i', { class: (estilo || 'fas') + ' ' + nombre, 'aria-hidden': 'true' });

  const store = {
    get(k) { try { return localStorage.getItem(k) || ''; } catch (_) { return ''; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* modo privado */ } },
    del(k) { try { localStorage.removeItem(k); } catch (_) { /* modo privado */ } }
  };

  /* Error de un campo: el mensaje (con id) queda asociado (aria-invalid + aria-describedby) y el foco vuelve al campo. */
  function errorCampo(campo, msgEl, texto) {
    msgEl.textContent = texto || ''; msgEl.hidden = !texto;
    if (texto) { campo.setAttribute('aria-invalid', 'true'); campo.setAttribute('aria-describedby', msgEl.id); campo.focus(); }
    else { campo.removeAttribute('aria-invalid'); campo.removeAttribute('aria-describedby'); }
  }

  /* — emoji como imagen SVG (Twemoji): la Raspberry no trae fuente de emoji. Mismo mecanismo que util.js; las rutas van absolutas. — */
  const NOTA = '/assets/emoji/1f3b5.svg';
  function emo(el, emoji) {
    el.textContent = '';
    if (!emoji) return el;
    const img = document.createElement('img');
    img.className = 'emo'; img.alt = ''; img.decoding = 'async'; img.width = 20; img.height = 20;
    let reintento = false;
    img.onerror = () => { if (!reintento) { reintento = true; img.src = NOTA; } else { img.remove(); } }; /* emoji sin dibujo: una nota musical */
    img.src = '/' + window.Util.emojiSrc(emoji);
    el.appendChild(img);
    return el;
  }

  /* — avisos (zona aria-live) — */
  let toastTimer = 0;
  const toastError = (msg) => toast(msg, 8000); /* los errores se quedan más tiempo en pantalla */
  function toast(msg, ms) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.classList.remove('show'); t.textContent = ''; }, ms || 4000);
  }

  /* — esqueleto: en vez de un «Cargando…» seco, la silueta de lo que va a aparecer (tarjeta, género, chip, fila). El texto «Cargando…» queda
       solo para lectores de pantalla. Sin blur ni sombras animadas: la Pi no lo aguanta (es un pulso de opacidad, y con «reducir movimiento» queda quieto). — */
  function esqueleto(tipo, n, etiqueta) {
    const tag = etiqueta || 'li';
    const out = [];
    for (let i = 0; i < (n || 4); i++) out.push(h(tag, { class: 'esq esq-' + tipo, 'aria-hidden': 'true' }));
    out.push(h(tag, { class: 'sr-only', text: 'Cargando…' })); /* sin role=status: el contenedor ya lleva aria-busy y un li con rol rompe la lista */
    return out;
  }

  /* — cargando: capa grande mientras se busca o piensa la IA (sustituye a los avisos «Buscando…», «Iniciando…», «Reproduciendo…») — */
  let carga = null;
  const anunciar = (txt) => { const el = $('srAhora'); el.textContent = R.textoAnuncio(el.textContent, txt); };
  /* La capa no debe quedar debajo de la barra (ni de «Más opciones» en el celular): se mide lo que ocupa. */
  function medirBarra() {
    const tops = ['reproductor', 'mobileTabbar'].map((id) => $(id)).filter((el) => el && el.offsetParent !== null).map((el) => el.getBoundingClientRect().top);
    document.documentElement.style.setProperty('--barra-alto', R.altoBarra(window.innerHeight, tops.length ? Math.min.apply(null, tops) : NaN) + 'px');
  }
  window.addEventListener('resize', medirBarra);
  function mostrarCarga(txt, sub, opc) {
    medirBarra();
    const s = estado;
    carga = { t0: Date.now(), id: s && s.track ? s.track.id : '', vioCarga: false, ia: !!(opc && opc.ia), sub: sub || '', vuelta: document.activeElement };
    $('carga').hidden = false;
    $('cargaTxt').textContent = txt;
    /* La capa tapa el contenido: si el foco (teclado) estaba debajo, pasa a «Ocultar» para no quedar invisible; finCarga lo devuelve. */
    if (carga.vuelta && ($('contenido').contains(carga.vuelta) || $('sidebar').contains(carga.vuelta))) $('cargaOcultar').focus({ preventScroll: true });
    pintarEspera();
    clearInterval(esperaTimer);
    esperaTimer = setInterval(pintarEspera, 1000);
    anunciar(txt);
  }
  /* El texto de abajo se vuelve más claro mientras se espera (ver PanelLocutor.mensajeEspera): nadie se queda mirando un giro sin saber qué pasa. */
  let esperaTimer = 0;
  function pintarEspera() { if (carga) $('cargaSub').textContent = LO.mensajeEspera(carga.sub, (Date.now() - carga.t0) / 1000); }
  /* La IA ya respondió: ahora se espera la música (misma capa, otro texto). */
  function cargandoMusica(txt, sub) { if (!carga) return mostrarCarga(txt, sub); carga.ia = false; carga.t0 = Date.now(); carga.sub = sub || ''; $('cargaTxt').textContent = txt; pintarEspera(); anunciar(txt); }
  /* La capa también sale sola cuando el motor busca tras un Siguiente/Anterior (cola vacía): ver PanelRadio.cargaSola.
     sola = { desde: cuándo empezó a buscar el motor, pedido: último Siguiente/Anterior, descartada: ya se quitó en esta búsqueda } */
  const sola = { desde: 0, pedido: 0, descartada: false };
  function finCarga() {
    if (!carga) return;
    const tenia = $('carga').contains(document.activeElement);
    const vuelta = carga.vuelta;
    carga = null;
    clearInterval(esperaTimer);
    sola.descartada = true; /* «Ocultar» o el tope de 90 s: no vuelve a salir sola mientras siga ESTA búsqueda */
    $('carga').hidden = true;
    if (tenia) { if (vuelta && vuelta.isConnected && vuelta.focus && !vuelta.closest('[hidden]')) vuelta.focus({ preventScroll: true }); else $('vista').focus(); }
  }
  function revisarCarga(s) {
    const cargando = !!(s && s.loading);
    if (!cargando) { sola.desde = 0; sola.descartada = false; } else if (!sola.desde) sola.desde = Date.now();
    if (!carga) {
      if (!R.escribiendo(document.activeElement) && R.cargaSola({ cargando, desde: sola.desde, ahora: Date.now(), pedido: sola.pedido, descartada: sola.descartada })) { mostrarCarga('Buscando música…'); carga.vioCarga = true; }
      return;
    }
    if (cargando) carga.vioCarga = true;
    if (R.cargaTermina(carga, s, Date.now())) finCarga();
  }
  $('cargaOcultar').addEventListener('click', finCarga);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && carga && !document.querySelector('dialog[open]') && !e.defaultPrevented) { e.preventDefault(); finCarga(); } }); /* Esc oculta la capa (WCAG 2.1.1 / 2.2.2) */

  /* — visor de video: el video (sin sonido) de lo que suena, siguiendo al audio del motor. Solo se pide mientras está abierto. — */
  const visor = $('visor'), vv = $('visorVideo');
  function abrirVideo() {
    medirBarra();
    visor.hidden = false;
    $('bVideo').setAttribute('aria-pressed', 'true');
    seguirVideo(estado);
    $('visorCerrar').focus();
  }
  function cerrarVideo(volverFoco) {
    if (visor.hidden) return;
    visor.hidden = true;
    $('bVideo').setAttribute('aria-pressed', 'false');
    vv.pause(); vv.removeAttribute('src'); vv.removeAttribute('poster'); vv.dataset.id = ''; vv.load();
    if (volverFoco) $('bVideo').focus();
  }
  function seguirVideo(s) {
    if (visor.hidden) return;
    const t = s && s.track;
    $('visorTitulo').textContent = t ? t.title || '' : 'Todavía no suena nada.';
    if (!t) return;
    if (vv.dataset.id !== t.id) {
      vv.dataset.id = t.id;
      $('visorAviso').hidden = true;
      vv.poster = '/api/thumb/' + encodeURIComponent(t.id);
      vv.src = '/api/play/' + encodeURIComponent(t.id) + '?mode=video';
    }
    if (s.paused) { if (!vv.paused) vv.pause(); return; }
    if (vv.readyState >= 1 && Number.isFinite(s.time) && Math.abs(vv.currentTime - s.time) > 0.6) { try { vv.currentTime = s.time; } catch (_) { /* sin seek */ } }
    if (vv.paused) vv.play().catch(() => {});
  }
  vv.addEventListener('error', () => { if (vv.getAttribute('src')) $('visorAviso').hidden = false; });
  $('bVideo').addEventListener('click', () => { if (visor.hidden) abrirVideo(); else cerrarVideo(true); });
  $('visorCerrar').addEventListener('click', () => cerrarVideo(true));
  visor.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); cerrarVideo(true); } });

  /* — locutor: al EMPEZAR a escuchar suena una vez «Estás escuchando Radio Deacero» (el mismo audio que / y /kiosco ponen cada 20 min), con la
       música baja mientras dura. No se repite en cada elección. Se apaga en Apariencia → Sonido; calla si la persona silencia. — */
  const LS_LOCUTOR = 'pl_locutor';
  let locutorOn = store.get(LS_LOCUTOR) !== '0';
  const loc = { habla: false, pend: null, seguro: 0, yaSono: false, audio: null };
  function duck(habla) { const p = player(); if (p && p.duck) { try { p.duck(LO.nivelDuck(habla)); } catch (_) { /* motor cargando */ } } }
  function finVoz() { clearTimeout(loc.seguro); if (!loc.habla) return; loc.habla = false; duck(false); }
  function callarJingle() { if (loc.audio) { try { loc.audio.pause(); } catch (_) { /* nada */ } loc.audio = null; } finVoz(); }
  /* Se llama DENTRO del toque de la persona (si no, el navegador no deja sonar). Los argumentos (qué se eligió) ya no se usan. */
  function anunciarEscucha() {
    if (!LO.debeJingle({ activo: locutorOn, silenciado: !!(estado && estado.muted), volumen: Number(vol.value), yaSono: loc.yaSono })) return;
    loc.yaSono = true;
    try {
      const a = new Audio('/assets/jingle.mp3');
      a.volume = LO.volumenVoz(vol.value);
      a.addEventListener('ended', callarJingle); a.addEventListener('error', callarJingle);
      loc.audio = a; loc.habla = true;
      loc.pend = { id: estado && estado.track ? estado.track.id : '' };
      duck(true);
      clearTimeout(loc.seguro);
      loc.seguro = setTimeout(callarJingle, 40000); /* por si nunca avisa que terminó */
      a.play().catch(callarJingle);
    } catch (_) { callarJingle(); }
  }
  /* El primer momento en que SUENA lo nuevo: si el aviso aún suena, la música arranca baja (y sube al terminar). */
  function revisarLocutor(s) {
    if (loc.habla && s && s.muted) callarJingle(); /* la persona silenció: el aviso también calla */
    if (!loc.pend || !LO.primerSonido(loc.pend.id, s)) return;
    loc.pend = null;
    if (loc.habla) duck(true);
  }

  /* — sesión del oyente: por pestaña (sessionStorage 'pl_sid', la misma que usa /panel/simple); el servidor lleva aparte su racha — */
  let sidLocal = '';
  function sid() {
    if (L.validSid(sidLocal)) return sidLocal;
    let s = '';
    try { s = sessionStorage.getItem('pl_sid') || ''; } catch (_) { /* sin sessionStorage */ }
    if (!L.validSid(s)) {
      s = L.makeSid(crypto.getRandomValues(new Uint8Array(12)));
      try { sessionStorage.setItem('pl_sid', s); } catch (_) { /* sin sessionStorage */ }
    }
    sidLocal = s;
    return s;
  }

  /* ─────────────── motor de audio: iframe OCULTO directo a app.js (?view=local). Se crea una vez y nunca se recarga:
     navegar entre secciones no corta la música. Sin foco, fuera del árbol de accesibilidad. ─────────────── */
  const motor = document.createElement('iframe');
  motor.id = 'motor'; motor.className = 'motor'; motor.title = 'Motor de audio';
  motor.setAttribute('aria-hidden', 'true'); motor.setAttribute('tabindex', '-1'); motor.setAttribute('allow', 'autoplay');
  motor.inert = true;
  (function () {
    const t = store.get('pl_token'); /* la clave del control remoto, si este navegador la tiene (igual que /panel/simple) */
    motor.src = '/?view=local&mode=audio&sid=' + encodeURIComponent(sid()) + (t ? '&t=' + encodeURIComponent(t) : '');
  })();
  document.body.appendChild(motor);
  /* El motor avisa con mensajes («Buscando música…», errores): se muestran como avisos del panel. */
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || e.source !== motor.contentWindow || !e.data || e.data.type !== 'toast' || typeof e.data.msg !== 'string') return;
    if (/^No |Saltando|fallaron/.test(e.data.msg)) finCarga(); /* el motor avisa un error: el loader se quita y queda el aviso */
    toast(e.data.msg.slice(0, 200), e.data.ms);
  });

  function player() {
    try { return (motor.contentWindow && motor.contentWindow.__player) || null; } catch (_) { return null; }
  }
  function esperarMotor(ms) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      (function intento() {
        const p = player();
        if (p) return resolve(p);
        if (Date.now() - t0 > (ms || 10000)) return resolve(null);
        setTimeout(intento, 250);
      })();
    });
  }
  async function send(cmd) {
    const p = await esperarMotor();
    if (!p) { toastError('El reproductor todavía está cargando. Inténtalo de nuevo en un momento.'); return false; }
    if (cmd && (cmd.cmd === 'next' || cmd.cmd === 'prev')) sola.pedido = Date.now();
    try { p.handleCommand(cmd); } catch (_) { toastError('No se pudo enviar la orden al reproductor.'); return false; }
    setTimeout(tick, 350);
    return true;
  }

  /* — estado del motor: se consulta cada segundo y se avisa a quien escuche — */
  let estado = null, ultimoId = '', esperaAnuncio = null;
  function tick() {
    const p = player();
    let s = null;
    try { s = p ? p.getState() : null; } catch (_) { s = null; }
    estado = s;
    renderBarra(s);
    renderProgreso(s);
    marcarSonando(s);
    revisarCarga(s);
    revisarLocutor(s);
    seguirVideo(s);
    const id = s && s.track ? s.track.id : '';
    if (id !== ultimoId) { ultimoId = id; bus.dispatchEvent(new CustomEvent('track', { detail: s })); }
    bus.dispatchEvent(new CustomEvent('state', { detail: s }));
    registrarHistorial(s);
    if (esperaAnuncio && s && s.track) { /* el usuario pidió Siguiente/Anterior: se avisa cuál suena (los cambios solos no se anuncian) */
      if (Date.now() - esperaAnuncio.t0 > 20000) esperaAnuncio = null;
      else if (s.track.id !== esperaAnuncio.id) { anunciar('Ahora suena: ' + s.track.title); esperaAnuncio = null; }
    }
  }
  setInterval(tick, 1000);

  /* — cuenta (la maneja cuenta.js; aquí solo se escucha) — */
  let user = null, ultimoRegistrado = '';
  const on = (ev, fn) => bus.addEventListener(ev, (e) => fn(e.detail));
  const emit = (ev, detail) => bus.dispatchEvent(new CustomEvent(ev, { detail }));

  /* Historial: una vez por canción que empieza a sonar (con cuenta, en la cuenta; sin ella, en este navegador). Si falla no se molesta a nadie. */
  async function registrarHistorial(s) {
    if (!s || !s.track || s.paused || !L.shouldLogHistory(ultimoRegistrado, s.track)) return;
    const t = L.trackConGenero(s);
    if (!t) return;
    ultimoRegistrado = t.id;
    const r = await A.registrarHistorial(t);
    if (r.ok) emit('historial');
  }

  /* ─────────────── Me gusta / No me gusta ─────────────── */
  const LS_LIKES = 'pl_likes';
  let mapa = L.parseLocalLikes(store.get(LS_LIKES)); /* id → { r, at, track } */
  let cadena = Promise.resolve(); /* las peticiones de reacciones salen en orden */

  const guardarLocal = () => { if (!user) { const s = L.serializeLikes(mapa); if (Object.keys(mapa).length) store.set(LS_LIKES, s); else store.del(LS_LIKES); } };

  function reaccionar(track, pulsada) {
    const t = L.cleanTrack(track);
    if (!t) return Promise.resolve(false);
    const previa = mapa[t.id];
    const nueva = L.nextReaction(previa && previa.r, pulsada);
    mapa = L.setReaction(mapa, t, nueva); /* optimista: se ve al instante */
    guardarLocal();
    emit('reacciones');
    renderBarra(estado, true);
    if (!user) return Promise.resolve(true);
    cadena = cadena.then(async () => {
      const r = await A.reaccionar(t, nueva);
      if (r.ok) return true;
      mapa = L.restoreEntry(mapa, t.id, previa); /* el servidor falló: se regresa a como estaba */
      emit('reacciones');
      renderBarra(estado, true);
      toastError(r.status === 401 ? 'Tu sesión terminó. Vuelve a entrar para guardar tus Me gusta.' : 'No se pudo guardar tu reacción. Inténtalo de nuevo.');
      return false;
    });
    return cadena;
  }

  async function alCambiarUsuario(u) {
    user = u || null;
    if (A.usarCuenta) A.usarCuenta(!!user); /* sin nómina, historial y playlists en este navegador */
    ultimoRegistrado = '';
    if (!user) { mapa = L.parseLocalLikes(store.get(LS_LIKES)); emit('reacciones'); renderBarra(estado, true); emit('usuario', null); return; }
    const local = L.parseLocalLikes(store.get(LS_LIKES));
    if (Object.keys(local).length) { /* lo que se marcó sin cuenta se suma a la cuenta la primera vez que se entra */
      const m = await A.fusionarReacciones(L.toMergeItems(local));
      if (m.ok) {
        store.del(LS_LIKES);
        const n = m.data && m.data.added;
        if (n) toast(n === 1 ? 'Se guardó 1 Me gusta que tenías en este navegador.' : 'Se guardaron ' + n + ' Me gusta que tenías en este navegador.');
      }
    }
    const r = await A.reacciones();
    mapa = r.ok ? L.fromServerList(r.data) : L.mergeLocalWithAccount(local, {});
    emit('reacciones');
    renderBarra(estado, true);
    emit('usuario', user);
    registrarHistorial(estado);
  }
  window.addEventListener('play:user', (e) => { alCambiarUsuario(e.detail && e.detail.user); });

  /* ─────────────── barra de reproducción ─────────────── */
  let firmaBarra = '';
  function renderBarra(s, forzar) {
    const t = s && s.track;
    const r = t ? L.reactionOf(mapa, t.id) : null;
    const cola = s && s.cola;
    const firma = [t && t.id, t && t.title, t && t.channel, s && s.genre && s.genre.id, s && s.genre && s.genre.label, s && s.paused, s && s.blocked, r, cola && cola.i, cola && cola.total].join('|');
    if (!forzar && firma === firmaBarra) return;
    firmaBarra = firma;
    document.body.classList.toggle('con-cancion', !!t);
    $('aTitulo').textContent = t ? t.title || '' : 'Elige qué escuchar';
    $('aCanal').textContent = t ? t.channel || '' : 'DEACERO Play';
    const art = $('npArt');
    const src = t ? '/api/thumb/' + encodeURIComponent(t.id) : '';
    if (art.dataset.id !== (t ? t.id : '')) {
      art.dataset.id = t ? t.id : '';
      art.hidden = true;
      if (src) { art.onload = () => { art.hidden = false; }; art.onerror = () => { art.hidden = true; }; art.src = src; } else art.removeAttribute('src');
    }
    const g = $('aGenero');
    g.textContent = '';
    if (t && s.genre && s.genre.label) { const e = h('span', { class: 'ahora-emo' }); emo(e, s.genre.emoji); g.append(e, s.genre.label); }
    g.hidden = !(t && s.genre && s.genre.label);
    $('aLista').hidden = !cola;
    if (cola) $('aListaTxt').textContent = 'Lista: canción ' + (cola.i + 1) + ' de ' + cola.total + '.';
    const pausa = !s || s.paused;
    $('bPlayIco').className = 'fas ' + (pausa ? 'fa-play' : 'fa-pause');
    $('bPlay').setAttribute('aria-label', pausa ? 'Reproducir' : 'Pausar');
    $('bPlay').title = pausa ? 'Reproducir (espacio)' : 'Pausar (espacio)';
    $('bLike').setAttribute('aria-pressed', String(r === 'like'));
    $('bDislike').setAttribute('aria-pressed', String(r === 'dislike'));
    /* los nombres de Me gusta y No me gusta son fijos; solo cambia aria-pressed */
  }

  /* Progreso y volumen: cambian cada segundo; mientras la persona arrastra no se pisan. */
  const seek = $('seek'), vol = $('vol');
  let arrastrando = false, moviendoVol = false, durActual = 0, ultimoSeekFoco = 0;
  /* Con el foco de TECLADO en la barra, el lector de pantalla leería el valor cada segundo (cambia solo): mientras tanto se actualiza
     cada 15 s. Con el ratón (sin :focus-visible) sigue al segundo. */
  const seekConFoco = () => { try { return document.activeElement === seek && seek.matches(':focus-visible'); } catch (_) { return false; } };
  function renderProgreso(s) {
    const p = R.progreso(s && s.track ? s : null);
    durActual = p.dur;
    seek.disabled = !p.buscable;
    let quieto = false;
    if (seekConFoco()) { if (Date.now() - ultimoSeekFoco < 15000) quieto = true; else ultimoSeekFoco = Date.now(); }
    if (!arrastrando && !quieto) {
      seek.value = String(Math.round(p.pct * 10));
      seek.style.setProperty('--p', p.pct + '%');
      $('tNow').textContent = s && s.track ? p.actual : '0:00';
      $('tDur').textContent = p.total;
      seek.setAttribute('aria-valuetext', s && s.track ? p.texto : 'Sin canción');
    }
    if (s && !moviendoVol && Number.isFinite(s.volume)) { vol.value = String(s.volume); vol.style.setProperty('--p', s.volume + '%'); }
    const silencio = !!(s && s.muted);
    const vt = R.textoVolumen(vol.value, silencio);
    if (vol.getAttribute('aria-valuetext') !== vt) vol.setAttribute('aria-valuetext', vt); /* solo si cambia: no se vuelve a leer */
    $('bMute').setAttribute('aria-pressed', String(silencio));
    $('bMuteIco').className = 'fas ' + R.iconoVolumen(s ? s.volume : 0, silencio);
  }
  seek.addEventListener('pointerdown', () => { arrastrando = true; });
  seek.addEventListener('input', () => {
    arrastrando = true;
    const t = R.segundosDesde(seek.value, durActual);
    seek.style.setProperty('--p', (Number(seek.value) / 10) + '%');
    if (t !== null) { $('tNow').textContent = R.fmtTiempo(t); seek.setAttribute('aria-valuetext', R.fmtTiempo(t) + ' de ' + R.fmtTiempo(durActual)); }
  });
  seek.addEventListener('change', () => {
    const t = R.segundosDesde(seek.value, durActual);
    arrastrando = false;
    if (t !== null) send({ cmd: 'seek', t });
  });
  seek.addEventListener('blur', () => { arrastrando = false; ultimoSeekFoco = 0; });
  seek.addEventListener('focus', () => { ultimoSeekFoco = Date.now(); });
  /* Teclado (WCAG 2.1.1): flechas 5 s, Re Pág / Av Pág 30 s, Inicio / Fin (la flecha nativa movería un cuarto de segundo). */
  seek.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const v = R.valorConTecla(e.key, seek.value, durActual);
    if (v === null) return;
    e.preventDefault();
    seek.value = String(v);
    seek.style.setProperty('--p', (v / 10) + '%');
    const t = R.segundosDesde(v, durActual);
    if (t === null) return;
    $('tNow').textContent = R.fmtTiempo(t);
    seek.setAttribute('aria-valuetext', R.fmtTiempo(t) + ' de ' + R.fmtTiempo(durActual));
    ultimoSeekFoco = Date.now();
    send({ cmd: 'seek', t });
  });
  vol.addEventListener('input', () => {
    moviendoVol = true;
    vol.style.setProperty('--p', vol.value + '%');
    vol.setAttribute('aria-valuetext', R.textoVolumen(vol.value, $('bMute').getAttribute('aria-pressed') === 'true'));
    const p = player();
    if (p) { try { p.handleCommand({ cmd: 'volume', set: Number(vol.value) }); } catch (_) { /* motor cargando */ } }
  });
  vol.addEventListener('change', () => { moviendoVol = false; });
  vol.addEventListener('blur', () => { moviendoVol = false; });
  $('bMute').addEventListener('click', () => send({ cmd: 'mute' }));

  const cancion = () => L.trackConGenero(estado);
  const conCancion = (fn) => () => { const t = cancion(); if (t) fn(t); else toast('Todavía no suena ninguna canción.'); };
  $('bLike').addEventListener('click', conCancion((t) => reaccionar(t, 'like')));
  $('bDislike').addEventListener('click', conCancion((t) => reaccionar(t, 'dislike')));
  $('bAdd').addEventListener('click', conCancion((t) => abrirSelector(t)));
  /* Sin aviso flotante: el propio botón ya cambia entre ▶ y ❚❚ (y su nombre accesible entre Reproducir y Pausar). */
  $('bPlay').addEventListener('click', () => {
    if (!estado || !estado.track || estado.paused) anunciarEscucha(); /* empezar a escuchar */
    send({ cmd: 'toggle' });
  });
  const pedirOtra = (cmd) => { esperaAnuncio = { id: estado && estado.track ? estado.track.id : '', t0: Date.now() }; send({ cmd }); };
  $('bNext').addEventListener('click', () => pedirOtra('next'));
  $('bPrev').addEventListener('click', () => pedirOtra('prev'));
  /* El navegador no deja sonar sin un toque: CUALQUIER toque o tecla dentro del panel es ese toque (el motor tiene allow="autoplay").
     Va en fase de captura y de forma síncrona para que cuente como gesto de la persona; el play/pausa ya lo maneja su propio botón. */
  const desbloquear = (e) => {
    if (e.target && e.target.closest && e.target.closest('#bPlay')) return;
    const p = player();
    if (p && p.unlock) { try { p.unlock(); } catch (_) { /* motor cargando */ } }
  };
  document.addEventListener('pointerdown', desbloquear, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') desbloquear(e); }, true);
  $('skipAhora').addEventListener('click', (e) => { e.preventDefault(); $('reproductor').focus(); });
  /* «Saltar al contenido»: sin cambiar la dirección (#vista no es una sección: el aviso de hashchange llevaría a Inicio) y, en el
     celular, cerrando antes el menú (con él abierto el contenido está inert y no recibe el foco). */
  $('skipVista').addEventListener('click', (e) => { e.preventDefault(); if (menuMovil) cerrarMenuMovil(false); $('vista').focus(); });
  $('aSalirLista').addEventListener('click', () => { send({ cmd: 'queue', items: [] }).then(() => toast('Saliste de la lista. Termina esta canción y sigue la radio.')); });
  /* celular: «Más opciones» muestra los botones secundarios */
  $('bMas').addEventListener('click', () => {
    const abierta = $('bMas').getAttribute('aria-expanded') !== 'true';
    $('bMas').setAttribute('aria-expanded', String(abierta));
    document.body.classList.toggle('barra-abierta', abierta);
    medirBarra();
  });

  /* ─────────────── selector de playlist (botón +) ─────────────── */
  const dlgPick = $('pickPl');
  let pickTrack = null;
  /* campo = el error es del nombre: se asocia al campo y el foco vuelve a él */
  const pickErr = (t, campo) => { if (campo || !t) errorCampo($('pickNombre'), $('pickErr'), t); else { $('pickErr').textContent = t; $('pickErr').hidden = false; } };

  async function abrirSelector(track) {
    pickTrack = track;
    pickErr('');
    $('pickSong').textContent = track.title;
    $('pickNombre').value = '';
    $('pickList').replaceChildren(h('li', { class: 'hint', text: 'Cargando tus playlists…' }));
    $('pickVacio').hidden = true;
    dlgPick.showModal();
    const r = await A.playlists();
    const lista = $('pickList');
    if (!r.ok) { lista.replaceChildren(h('li', { class: 'err', text: 'No se pudieron cargar tus playlists. Puedes crear una nueva.' })); return; }
    const pls = Array.isArray(r.data) ? r.data : [];
    $('pickVacio').hidden = pls.length > 0;
    lista.replaceChildren(...pls.map((p) => h('li', {}, h('button', { type: 'button', class: 'fila-btn', onclick: () => agregarA(p) }, [h('span', { text: p.name }), h('span', { class: 'muted', text: p.count === 1 ? '1 canción' : p.count + ' canciones' })]))));
  }

  async function agregarA(p) {
    const r = await A.agregarAPlaylist(p.id, pickTrack);
    if (!r.ok) return pickErr('No se pudo agregar. Inténtalo de nuevo.');
    dlgPick.close();
    toast(r.data && r.data.existed ? 'Esa canción ya estaba en «' + p.name + '».' : 'Agregada a «' + p.name + '».');
    emit('playlists');
  }
  $('pickForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    pickErr('');
    const nombre = $('pickNombre').value.trim();
    if (!nombre) return pickErr('Escribe un nombre para la playlist.', true);
    const b = $('pickCrear');
    b.disabled = true;
    const c = await A.crearPlaylist(nombre);
    b.disabled = false;
    if (!c.ok || !c.data || !c.data.playlist) return pickErr('No se pudo crear la playlist (puede que ya tengas el máximo).', true);
    agregarA(c.data.playlist);
  });
  $('pickCerrar').addEventListener('click', () => dlgPick.close());

  /* ─────────────── pestañas (patrón WAI-ARIA con flechas; lo usan las subpestañas de cada vista) ─────────────── */
  /* manual: las flechas solo mueven el foco; Enter o Espacio activan (para pestañas que disparan una llamada al servidor) */
  function tablist(lista, alElegir, opciones) {
    const manual = !!(opciones && opciones.manual);
    const tabs = () => Array.from(lista.querySelectorAll('[role="tab"]')).filter((x) => !x.hidden);
    function elegir(i, enfocar) {
      const t = tabs();
      t.forEach((x, j) => { x.setAttribute('aria-selected', String(j === i)); x.tabIndex = j === i ? 0 : -1; });
      if (enfocar) t[i].focus();
      alElegir(t[i], i);
    }
    lista.addEventListener('keydown', (e) => {
      const t = tabs();
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return; /* Alt+←, Ctrl+→… son del navegador */
      const i = t.indexOf(document.activeElement);
      if (i < 0) return;
      const n = L.nextTabIndex(e.key, i, t.length);
      if (n < 0) return;
      e.preventDefault();
      if (manual) { t.forEach((x, j) => { x.tabIndex = j === n ? 0 : -1; }); t[n].focus(); } else elegir(n, true);
    });
    lista.addEventListener('click', (e) => {
      const x = e.target.closest('[role="tab"]');
      if (x && lista.contains(x)) elegir(tabs().indexOf(x), false);
    });
    function elegirVista(nombre, enfocar) {
      const i = tabs().findIndex((x) => x.dataset.vista === nombre);
      if (i < 0) return false;
      elegir(i, enfocar);
      return true;
    }
    return { elegir, elegirVista, tabs };
  }

  /* — scripts bajo demanda (CSP 'self': <script src> dinámico del mismo origen). Cada archivo se pide UNA vez. — */
  const DEPS = { /* lógica pura que necesita cada módulo antes de cargarse */
    buscar: ['escucha-logica'], naturaleza: ['escucha-logica'], letras: ['escucha-logica'], visualizador: ['escucha-logica']
  };
  const scripts = {};
  function cargarScript(nombre) {
    if (!/^[a-z-]+$/.test(nombre)) return Promise.reject(new Error('módulo inválido')); /* defensa: solo nombres de archivo simples */
    if (scripts[nombre]) return scripts[nombre];
    scripts[nombre] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '/js/panel/' + nombre + '.js';
      s.onload = () => resolve();
      s.onerror = () => { s.remove(); delete scripts[nombre]; reject(new Error('no cargó ' + nombre)); };
      document.head.appendChild(s);
    });
    return scripts[nombre];
  }
  const conDeps = (nombre) => (DEPS[nombre] || []).reduce((p, d) => p.then(() => cargarScript(d)), Promise.resolve()).then(() => cargarScript(nombre));

  /* Módulos que no son vista (letras, visualizador): se registran en Panel.modulos y se abren con Panel.abrir(nombre, opciones). */
  const modulos = {};
  async function abrirModulo(nombre, opciones) {
    try { await conDeps(nombre); } catch (_) { toastError('No se pudo cargar esa función. Revisa tu conexión e inténtalo de nuevo.'); return null; }
    const m = modulos[nombre];
    if (!m) { toastError('No se pudo abrir esa función.'); return null; }
    m.abrir(opciones || {});
    return m;
  }

  /* — vistas bajo demanda: cada una se monta en su contenedor #p-<nombre> la primera vez que se abre — */
  const vistas = {};          /* nombre → { montar(el), mostrar?(), enfocar?() }: cada archivo se registra aquí al cargar */
  const cargadas = {}, cargando = {}, alCargar = {};
  function cargar(nombre) {
    const el = $('p-' + nombre);
    if (cargadas[nombre]) { if (cargadas[nombre].mostrar) cargadas[nombre].mostrar(); return; }
    if (cargando[nombre]) return;
    cargando[nombre] = true;
    el.replaceChildren(h('p', { class: 'cargando', text: 'Cargando…' }));
    const falla = () => {
      cargando[nombre] = false;
      el.replaceChildren(h('div', { class: 'vacio' }, [
        h('p', { text: 'No se pudo cargar esta sección. Revisa tu conexión e inténtalo de nuevo.' }),
        h('button', { type: 'button', class: 'primary', text: 'Reintentar', onclick: () => cargar(nombre) })
      ]));
    };
    conDeps(nombre).then(() => {
      cargando[nombre] = false;
      const v = vistas[nombre];
      if (!v) return falla();
      el.replaceChildren();
      try { v.montar(el); } catch (_) { return falla(); }
      cargadas[nombre] = v;
      if (v.mostrar) v.mostrar();
      (alCargar[nombre] || []).splice(0).forEach((fn) => fn(v));
    }, falla);
  }
  /* fn(vista) en cuanto la vista esté montada (al momento si ya lo está) */
  function cuandoCargue(nombre, fn) { if (cargadas[nombre]) fn(cargadas[nombre]); else (alCargar[nombre] = alCargar[nombre] || []).push(fn); }

  /* ─────────────── navegación: barra lateral, subpestañas de Inicio y pestañas de abajo (celular) ─────────────── */
  const PANELES = ['inicio', 'buscar', 'parati', 'favoritos', 'naturaleza'];
  let activa = 'inicio', panelActivo = 'inicio', subInicio = 'reco';

  /* Subpestañas de Inicio (Recomendado, Bienestar, Podcasts). Elegir una es navegar: actualiza menú y dirección. */
  const rsubs = $('rsubs');
  const SUB_VISTA = { reco: 'inicio', bienestar: 'bienestar', podcasts: 'podcasts' };
  const PANE_SUB = { reco: 'sp-reco', bienestar: 'p-bienestar', podcasts: 'sp-podcasts' };
  function mostrarSub(sub) {
    subInicio = PANE_SUB[sub] ? sub : 'reco';
    for (const b of rsubs.querySelectorAll('[role="tab"]')) {
      const si = b.dataset.sub === subInicio;
      b.setAttribute('aria-selected', String(si)); b.tabIndex = si ? 0 : -1;
    }
    for (const k in PANE_SUB) $(PANE_SUB[k]).hidden = k !== subInicio;
    if (subInicio === 'bienestar') cargar('bienestar');
    emit('sub', subInicio);
  }
  tablist(rsubs, (tab) => ir(SUB_VISTA[tab.dataset.sub] || 'inicio'));

  function marcarMenu() {
    const enMenu = activa === 'podcasts' ? 'inicio' : activa; /* Podcasts es una subpestaña de Inicio */
    for (const b of document.querySelectorAll('.nav-item[data-vista]')) {
      if (b.dataset.vista === enMenu) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    }
    const movil = menuMovil ? 'descubrir' : R.pestanaMovil(activa);
    for (const b of document.querySelectorAll('.mtab')) {
      if (b.dataset.mtab === movil) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    }
  }

  function ir(vista, opciones) {
    const d = R.destino(vista);
    activa = d.vista; panelActivo = d.panel;
    for (const n of PANELES) $('p-' + n).hidden = n !== d.panel;
    if (d.panel === 'inicio') mostrarSub(d.sub);
    else cargar(d.panel);
    if (d.panel === 'favoritos') cuandoCargue('favoritos', (v) => { if (v.sub) v.sub(d.sub); });
    if (menuMovil) cerrarMenuMovil(false);
    marcarMenu();
    try { history.replaceState(null, '', activa === 'inicio' ? location.pathname : '#' + activa); } catch (_) { /* sin history */ }
    emit('pestana', pestana());
    if (opciones && opciones.enfocar) $('vista').focus();
  }
  const pestana = () => (panelActivo === 'inicio' ? (subInicio === 'bienestar' ? 'bienestar' : 'inicio') : panelActivo);

  /* Barra lateral: las secciones navegan; en el celular, el menú se cierra y el foco pasa al contenido. */
  $('sidebar').addEventListener('click', (e) => {
    const b = e.target.closest('.nav-item[data-vista]');
    if (b) ir(b.dataset.vista, { enfocar: menuMovil });
  });

  /* Descubrir: cada atajo arranca la radio continua de su género. */
  function radioGenero(id, label) {
    mostrarCarga('Preparando ' + label, 'Buscando canciones que sí se pueden reproducir…');
    anunciarEscucha('genero', label);
    return send({ cmd: 'genre', id });
  }
  $('descubrir').replaceChildren(...R.DESCUBRIR.map((d) => {
    const ico = d.icono === 'bandera-mx'
      ? h('img', { class: 'nav-ico nav-flag', src: '/assets/bandera-mx.svg', alt: '', width: '18', height: '12' })
      : fa(d.icono + ' nav-ico');
    if (d.color) ico.style.color = d.color;
    return h('li', {}, h('button', { type: 'button', class: 'nav-item nav-item--disc', 'data-genero': d.genero, title: d.label + ': iniciar radio continua', onclick: () => { if (menuMovil) cerrarMenuMovil(true); radioGenero(d.genero, d.label); } }, [
      ico, h('span', { class: 'nav-txt', text: d.label }), h('span', { class: 'sr-only sonando-txt' }), fa('fa-play disc-play-ico')
    ]));
  }));
  /* Lo que suena se marca en Descubrir y en la cuadrícula de Inicio (no solo con color: también un texto para lectores de pantalla). */
  let generoMarcado = null;
  function marcarSonando(s) {
    const g = R.generoSonando(s);
    if (g === generoMarcado) return;
    generoMarcado = g;
    for (const b of document.querySelectorAll('[data-genero]')) {
      const si = !!g && b.dataset.genero === g;
      b.classList.toggle('sonando', si);
      const t = b.querySelector('.sonando-txt');
      if (t) t.textContent = si ? ' (sonando ahora)' : '';
    }
  }

  /* Contraer / expandir la barra lateral (escritorio). Se recuerda en este navegador; temas.js lo aplica antes de pintar. */
  const LS_MENU = 'pl_menu';
  function pintarToggle() {
    const min = document.documentElement.classList.contains('menu-min');
    const b = $('sideToggle');
    b.setAttribute('aria-expanded', String(!min));
    const t = min ? 'Expandir el menú lateral' : 'Contraer el menú lateral';
    b.setAttribute('aria-label', t); b.title = t;
    b.firstElementChild.className = 'fas ' + (min ? 'fa-chevron-right' : 'fa-chevron-left');
  }
  $('sideToggle').addEventListener('click', () => {
    const min = document.documentElement.classList.toggle('menu-min');
    if (min) store.set(LS_MENU, 'min'); else store.del(LS_MENU);
    pintarToggle();
  });
  pintarToggle();

  /* Celular (≤ 768 px): sin barra lateral. «Descubrir» abajo la muestra en lugar del contenido; Esc o elegir algo la cierra. */
  let menuMovil = false;
  const tabDescubrir = document.querySelector('.mtab[data-mtab="descubrir"]');
  function abrirMenuMovil() {
    menuMovil = true;
    document.body.classList.add('menu-movil');
    tabDescubrir.setAttribute('aria-expanded', 'true');
    $('contenido').inert = true;
    marcarMenu();
    const primero = document.querySelector('#sidebar .nav-item');
    if (primero) primero.focus();
  }
  function cerrarMenuMovil(volverFoco) {
    menuMovil = false;
    document.body.classList.remove('menu-movil');
    tabDescubrir.setAttribute('aria-expanded', 'false');
    $('contenido').inert = false;
    marcarMenu();
    if (volverFoco) tabDescubrir.focus();
  }
  /* Esc cierra el menú desde cualquier parte (también con el foco en el reproductor o en las pestañas de abajo), salvo con un cuadro
     abierto: ese Esc es del cuadro. El foco vuelve a «Descubrir». No hay trampa de foco a propósito: el menú no tapa el reproductor ni
     las pestañas, que siguen visibles y usables; solo el contenido (oculto) queda inert. */
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !menuMovil || e.defaultPrevented || document.querySelector('dialog[open]')) return;
    e.preventDefault();
    cerrarMenuMovil(true);
  });
  $('mobileTabbar').addEventListener('click', (e) => {
    const b = e.target.closest('.mtab');
    if (!b) return;
    const m = b.dataset.mtab;
    if (m === 'descubrir') { if (menuMovil) cerrarMenuMovil(true); else abrirMenuMovil(); return; }
    ir(m === 'biblioteca' ? 'favoritos' : m);
  });
  /* Si la ventana se agranda con el menú del celular abierto, se cierra (en escritorio la barra lateral ya se ve). */
  const mqMovil = window.matchMedia('(max-width: 768px)');
  const alCambiarAncho = () => { if (!mqMovil.matches && menuMovil) cerrarMenuMovil(false); };
  if (mqMovil.addEventListener) mqMovil.addEventListener('change', alCambiarAncho);

  /* Buscador de arriba: abre la vista Buscar con lo escrito. */
  function buscarArriba(q) {
    ir('buscar');
    cuandoCargue('buscar', (v) => { if (v.buscarTexto) v.buscarTexto(q); });
  }
  $('buscaTop').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const q = $('topQ').value.trim();
    if (!q) { toast('Escribe un artista o una canción.'); $('topQ').focus(); return; }
    buscarArriba(q);
  });

  /* Administración ya no vive aquí: es la página /admin (pide la misma clave que /remote). Un marcador viejo (#admin) lleva allá. */
  const inicial = location.hash.replace('#', '');
  if (inicial === 'admin') { location.replace('/admin'); return; }
  /* Si otro sistema mandó a la persona con /entrar y no se pudo iniciar su sesión (el servidor no dice por qué): se avisa y se limpia la dirección. */
  try {
    const u = new URL(location.href);
    if (u.searchParams.get('entrada') === 'no') {
      u.searchParams.delete('entrada');
      history.replaceState(null, '', u.pathname + u.search + u.hash);
      setTimeout(() => toastError('No se pudo iniciar tu sesión desde el enlace. Entra con tu número de nómina.'), 600);
    }
  } catch (_) { /* sin URL/history */ }

  /* ─────────────── Apariencia (tema y sonido) ─────────────── */
  const T = window.PanelTemas;
  const dlgAp = $('apariencia');
  function pintarTemas() {
    const actual = T.actual();
    $('temasGrid').replaceChildren(...T.TEMAS.map((t) => {
      const id = 'tema-' + t.id;
      const radio = h('input', { type: 'radio', name: 'tema', id, value: t.id, checked: t.id === actual, onchange: () => elegirTema(t.id, true) });
      const muestra = h('span', { class: 'tema-muestra', 'aria-hidden': 'true' });
      muestra.style.background = 'linear-gradient(135deg, ' + t.muestra[0] + ' 55%, ' + t.muestra[1] + ' 55%)';
      return h('label', { class: 'tema-op', for: id }, [radio, muestra, h('span', { text: t.nombre })]);
    }));
  }
  /* Guarda en el navegador y, con cuenta, en /api/me/prefs (clave 'tema'): así sigue a la persona entre equipos. */
  function elegirTema(id, guardarEnCuenta) {
    const t = T.guardar(id);
    if (guardarEnCuenta && user) A.guardarPrefs({ tema: t }).then((r) => { if (!r.ok && r.status !== 401) toastError('El tema se guardó solo en este navegador.'); });
    emit('tema', t);
  }
  function pintarSonido() {
    $('locutorOn').checked = locutorOn;
    $('locutorNota').textContent = 'Suena una sola vez, al empezar a escuchar, con la música baja mientras dura. Calla si silencias la música.';
  }
  $('locutorOn').addEventListener('change', () => {
    locutorOn = $('locutorOn').checked;
    if (locutorOn) store.del(LS_LOCUTOR); else { store.set(LS_LOCUTOR, '0'); callarJingle(); }
    toast(locutorOn ? 'Locutor activado.' : 'Locutor desactivado.');
  });
  $('aparienciaBtn').addEventListener('click', () => {
    pintarTemas();
    pintarSonido();
    dlgAp.showModal();
    const sel = dlgAp.querySelector('input[name="tema"]:checked');
    if (sel) sel.focus();
  });
  dlgAp.addEventListener('close', () => $('aparienciaBtn').focus());
  $('apCerrar').addEventListener('click', () => dlgAp.close());
  /* Con cuenta: el tema guardado en la cuenta manda (si es válido). */
  on('usuario', async (u) => {
    if (!u) return;
    const r = await A.prefs();
    if (r.ok && r.data && typeof r.data.tema === 'string' && T.temaValido(r.data.tema) === r.data.tema) elegirTema(r.data.tema, false);
  });

  /* ─────────────── ayuda ─────────────── */
  const dlgAyuda = $('ayuda');
  let focoAntesAyuda = null;
  function abrirAyuda() { if (dlgAyuda.open) return; focoAntesAyuda = document.activeElement; dlgAyuda.showModal(); $('ayudaCerrar').focus(); }
  $('ayudaBtn').addEventListener('click', abrirAyuda);
  $('ayudaCerrar').addEventListener('click', () => dlgAyuda.close());
  dlgAyuda.addEventListener('close', () => { const f = focoAntesAyuda; focoAntesAyuda = null; if (f && f.focus && document.contains(f)) f.focus(); });

  /* ─────────────── letras, karaoke, visualizador (módulos que se cargan al abrirlos) y naturaleza ─────────────── */
  const abrirLetras = (karaoke) => abrirModulo('letras', { karaoke });
  $('bLetra').addEventListener('click', () => abrirLetras(false));
  $('bKaraoke').addEventListener('click', () => abrirLetras(true));
  $('bVisual').addEventListener('click', () => abrirModulo('visualizador'));
  $('bNatura').addEventListener('click', () => ir('naturaleza', { enfocar: true }));

  /* ─────────────── atajos de teclado ─────────────── */
  /* WCAG 2.1.4: se pueden apagar desde la ayuda (se recuerda en este navegador). Apagados, ninguna tecla suelta actúa (tampoco «?»,
     que también es un atajo de un carácter); para volver a encenderlos está el botón de Ayuda de arriba. */
  const LS_ATAJOS = 'pl_atajos';
  let atajosOn = store.get(LS_ATAJOS) !== '0';
  $('atajosOn').checked = atajosOn;
  $('atajosOn').addEventListener('change', () => {
    atajosOn = $('atajosOn').checked;
    if (atajosOn) store.del(LS_ATAJOS); else store.set(LS_ATAJOS, '0');
    toast(atajosOn ? 'Atajos de una tecla activados.' : 'Atajos de una tecla desactivados. Esta ayuda sigue en el botón de Ayuda de arriba.');
  });
  const enfocarBuscar = () => { const q = $('topQ'); q.focus(); q.select(); };
  /* Ir a una sección con el teclado: el foco queda en su botón del menú (o en el contenido si el menú no se ve). */
  function irConFoco(v) {
    ir(v);
    const b = document.querySelector('#sidebar .nav-item[data-vista="' + v + '"]');
    if (b && b.offsetParent !== null) b.focus(); else $('vista').focus();
  }
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.isComposing) return;
    const t = e.target || {};
    const accion = L.atajoDeTecla({
      key: e.key, tag: t.tagName, editable: !!t.isContentEditable, role: t.getAttribute ? t.getAttribute('role') : null,
      ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey, shift: e.shiftKey
    });
    if (!accion || !atajosOn) return;
    /* con un cuadro abierto los atajos se apagan, salvo en Letras/Karaoke (espacio, N, L, K siguen sirviendo) */
    const abierto = document.querySelector('dialog[open]');
    if (abierto && !(abierto.id === 'letras' && ['toggle', 'next', 'letras', 'karaoke'].includes(accion))) return;
    e.preventDefault();
    if (accion === 'toggle') { if (estado && estado.track) { if (estado.paused) anunciarEscucha(); send({ cmd: 'toggle' }); } }
    else if (accion === 'next') pedirOtra('next');
    else if (accion === 'letras' || accion === 'karaoke') {
      const m = modulos.letras;
      if (m && m.abierto()) { if ((accion === 'karaoke') === m.karaoke()) m.cerrar(); else m.modo(accion === 'karaoke'); }
      else abrirLetras(accion === 'karaoke');
    } else if (accion === 'buscar') enfocarBuscar();
    else if (accion === 'ayuda') abrirAyuda();
    else if (accion.indexOf('pestana:') === 0) {
      const v = R.vistaDeAtajo(Number(accion.slice(8)));
      if (v) irConFoco(v);
    }
  });

  /* Para las vistas */
  window.Panel = {
    h, emo, icono, fa, esqueleto, anunciarEscucha, errorCampo, toast, toastError, store, tablist, vistas, modulos, L, R, api: A,
    sid, player, send, on, emit, ir, cuandoCargue, radioGenero, cargando: mostrarCarga, cargandoMusica, finCarga, abrirVideo,
    remarcarSonando: () => { generoMarcado = null; marcarSonando(estado); },
    estado: () => estado,
    usuario: () => user,
    pestana,
    subInicio: () => subInicio,
    abrir: abrirModulo,
    abrirCuenta: () => { if (window.PlayCuenta) window.PlayCuenta.abrir(); },
    reacciones: { mapa: () => mapa, de: (id) => L.reactionOf(mapa, id), alternar: reaccionar, lista: (r) => L.listByReaction(mapa, r) },
    selectorPlaylist: abrirSelector
  };

  /* Primera sección: la de la dirección (#bienestar, #buscar…). */
  ir(inicial || 'inicio');
  /* Si cambia el # a mano o con un marcador (la navegación propia usa replaceState y no dispara este evento). */
  window.addEventListener('hashchange', () => { const v = location.hash.replace('#', ''); if (R.destino(v).vista !== activa) ir(v); });
  tick();
})();
