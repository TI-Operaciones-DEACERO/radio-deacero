/* nucleo.js — el cascarón del panel completo: pestañas, puente con el motor de audio, barra "ahora suena" con Me gusta / No me gusta / playlist,
   avisos y carga de las vistas (bienestar.js, parati.js, favoritos.js) cuando se abre su pestaña. La lógica sin DOM vive en logica.js. */
(function () {
  'use strict';
  const L = window.PanelLogica, U = window.Util, A = window.PlayApi;
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
    img.src = '/' + U.emojiSrc(emoji);
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

  /* — sesión del oyente: la misma que usa /panel (sessionStorage 'pl_sid'); si no hay, se lee del motor o se crea — */
  let sidLocal = '';
  function sid() {
    try {
      const f = $('radio').contentDocument.querySelector('iframe.engine');
      const s = f && new URL(f.src, location.href).searchParams.get('sid');
      if (L.validSid(s)) return s;
    } catch (_) { /* el panel aún no carga */ }
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

  /* — puente con el motor de audio (el iframe del iframe: /panel → iframe.engine → window.__player) — */
  function player() {
    try {
      const e = $('radio').contentDocument.querySelector('iframe.engine');
      return (e && e.contentWindow && e.contentWindow.__player) || null;
    } catch (_) { return null; }
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
    try { p.handleCommand(cmd); } catch (_) { toastError('No se pudo enviar la orden al reproductor.'); return false; }
    setTimeout(tick, 350);
    return true;
  }

  /* — estado del motor: se consulta cada segundo y se avisa a quien escuche — */
  let estado = null, ultimoId = '';
  function tick() {
    const p = player();
    let s = null;
    try { s = p ? p.getState() : null; } catch (_) { s = null; }
    estado = s;
    renderBarra(s);
    const id = s && s.track ? s.track.id : '';
    if (id !== ultimoId) { ultimoId = id; bus.dispatchEvent(new CustomEvent('track', { detail: s })); }
    bus.dispatchEvent(new CustomEvent('state', { detail: s }));
    registrarHistorial(s);
    if (esperaAnuncio && s && s.track) { /* el usuario pidió Siguiente: se avisa cuál suena (los cambios solos no se anuncian) */
      if (Date.now() - esperaAnuncio.t0 > 20000) esperaAnuncio = null;
      else if (s.track.id !== esperaAnuncio.id) { toast('Ahora suena: ' + s.track.title); esperaAnuncio = null; }
    }
  }
  let esperaAnuncio = null;
  setInterval(tick, 1000);

  /* — cuenta (la maneja cuenta.js; aquí solo se escucha) — */
  let user = null, ultimoRegistrado = '';
  const on = (ev, fn) => bus.addEventListener(ev, (e) => fn(e.detail));
  const emit = (ev, detail) => bus.dispatchEvent(new CustomEvent(ev, { detail }));

  /* Historial: una vez por canción que empieza a sonar, solo con cuenta. Si falla no se molesta a nadie. */
  async function registrarHistorial(s) {
    if (!user || !s || !s.track || s.paused || !L.shouldLogHistory(ultimoRegistrado, s.track)) return;
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

  /* ─────────────── barra "ahora suena" ─────────────── */
  const bar = $('ahora');
  emo($('bDislike'), '👎'); emo($('bLike'), '👍'); $('bAdd').appendChild(icono('plus', 26));
  let firmaBarra = '';
  function renderBarra(s, forzar) {
    const t = s && s.track;
    bar.hidden = !t;
    $('skipAhora').hidden = !t;
    document.body.classList.toggle('con-barra', !!t);
    if (!t) { firmaBarra = ''; return; }
    const r = L.reactionOf(mapa, t.id);
    const cola = s.cola;
    const firma = [t.id, t.title, t.channel, s.genre && s.genre.id, s.genre && s.genre.label, s.paused, s.blocked, r, cola && cola.i, cola && cola.total].join('|');
    if (!forzar && firma === firmaBarra) return;
    firmaBarra = firma;
    $('aTitulo').textContent = t.title || '';
    $('aCanal').textContent = t.channel || '';
    const g = $('aGenero');
    g.textContent = '';
    if (s.genre && s.genre.label) { const e = h('span', { class: 'ahora-emo' }); emo(e, s.genre.emoji); g.append(e, s.genre.label); }
    g.hidden = !(s.genre && s.genre.label);
    $('aLista').hidden = !cola;
    if (cola) $('aListaTxt').textContent = 'Lista: canción ' + (cola.i + 1) + ' de ' + cola.total + '.';
    const pausa = s.paused;
    $('bPlayUse').setAttribute('href', pausa ? '#i-play' : '#i-pause');
    $('bPlay').setAttribute('aria-label', pausa ? 'Reproducir' : 'Pausar');
    $('bPlay').title = pausa ? 'Reproducir' : 'Pausar';
    $('bLike').setAttribute('aria-pressed', String(r === 'like'));
    $('bDislike').setAttribute('aria-pressed', String(r === 'dislike'));
    /* los nombres de 👍 y 👎 son fijos; solo cambia aria-pressed */
  }

  const cancion = () => L.trackConGenero(estado);
  $('bLike').addEventListener('click', () => { const t = cancion(); if (t) reaccionar(t, 'like'); });
  $('bDislike').addEventListener('click', () => { const t = cancion(); if (t) reaccionar(t, 'dislike'); });
  $('bAdd').addEventListener('click', () => { const t = cancion(); if (t) abrirSelector(t); });
  $('bPlay').addEventListener('click', async () => {
    if (!(await send({ cmd: 'toggle' }))) return;
    await new Promise((r) => setTimeout(r, 600));
    const s = player() && player().getState();
    if (s && s.track) toast((s.paused ? 'En pausa: ' : 'Ahora suena: ') + s.track.title);
  });
  $('bNext').addEventListener('click', () => { esperaAnuncio = { id: estado && estado.track ? estado.track.id : '', t0: Date.now() }; send({ cmd: 'next' }); });
  $('skipAhora').addEventListener('click', (e) => { e.preventDefault(); bar.focus(); });
  $('aSalirLista').addEventListener('click', () => { send({ cmd: 'queue', items: [] }).then(() => toast('Saliste de la lista. Termina esta canción y sigue la radio.')); });

  /* ─────────────── selector de playlist (botón ➕) ─────────────── */
  const dlgPick = $('pickPl');
  let pickTrack = null;
  /* campo = el error es del nombre: se asocia al campo y el foco vuelve a él */
  const pickErr = (t, campo) => { if (campo || !t) errorCampo($('pickNombre'), $('pickErr'), t); else { $('pickErr').textContent = t; $('pickErr').hidden = false; } };

  async function abrirSelector(track) {
    if (!user) { toast('Para guardar en playlists entra con tu nómina.'); if (window.PlayCuenta) window.PlayCuenta.abrir(); return; }
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

  /* ─────────────── pestañas (patrón WAI-ARIA con flechas) ─────────────── */
  /* manual: las flechas solo mueven el foco; Enter o Espacio activan (para pestañas que disparan una llamada al servidor) */
  function tablist(lista, alElegir, opciones) {
    const manual = !!(opciones && opciones.manual);
    const tabs = () => Array.from(lista.querySelectorAll('[role="tab"]')).filter((x) => !x.hidden); /* las ocultas (Administración sin acceso) no cuentan */
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
    /* por nombre de vista (data-vista); devuelve false si esa pestaña no está visible */
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
    buscar: ['escucha-logica'], naturaleza: ['escucha-logica'], letras: ['escucha-logica'], visualizador: ['escucha-logica'], admin: ['admin-logica']
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

  /* Módulos que no son pestaña (letras, visualizador): se registran en Panel.modulos y se abren con Panel.abrir(nombre, opciones). */
  const modulos = {};
  async function abrirModulo(nombre, opciones) {
    try { await conDeps(nombre); } catch (_) { toastError('No se pudo cargar esa función. Revisa tu conexión e inténtalo de nuevo.'); return null; }
    const m = modulos[nombre];
    if (!m) { toastError('No se pudo abrir esa función.'); return null; }
    m.abrir(opciones || {});
    return m;
  }

  /* — vistas bajo demanda — */
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

  const NOMBRES = ['radio', 'buscar', 'bienestar', 'parati', 'favoritos', 'naturaleza', 'admin'];
  let activa = 'radio';
  function mostrar(nombre) {
    if (!NOMBRES.includes(nombre)) nombre = 'radio';
    activa = nombre;
    for (const n of NOMBRES) {
      const p = $('p-' + n);
      if (n === 'radio') { /* el motor nunca se descarga: fuera de la vista se aparta, pero sigue vivo y sonando */
        p.classList.toggle('off', nombre !== 'radio');
        p.toggleAttribute('inert', nombre !== 'radio');
        p.setAttribute('aria-hidden', String(nombre !== 'radio'));
      } else p.hidden = n !== nombre;
    }
    if (nombre !== 'radio') cargar(nombre);
    try { history.replaceState(null, '', nombre === 'radio' ? location.pathname : '#' + nombre); } catch (_) { /* sin history */ }
    emit('pestana', nombre);
  }
  const principal = tablist($('tabs'), (tab) => mostrar(tab.dataset.vista));
  const inicial = location.hash.replace('#', '');
  if (NOMBRES.includes(inicial) && inicial !== 'radio' && inicial !== 'admin') principal.elegirVista(inicial, false);

  /* ─────────────── Administración: la pestaña solo aparece si el servidor dice que hay acceso ─────────────── */
  const tabAdmin = $('tab-admin');
  async function revisarAdmin(avisar) {
    const r = await A.adminEstado();
    const ok = r.ok;
    tabAdmin.hidden = !ok;
    $('claveOlvidar').hidden = !A.clave.hay();
    if (!ok && activa === 'admin') principal.elegirVista('radio', false);
    if (ok && (inicial === 'admin' || avisar) && activa !== 'admin') principal.elegirVista('admin', false);
    if (avisar) toast(ok ? 'Listo: ya tienes la pestaña Administración.' : 'Sin acceso a Administración.');
    return r;
  }
  revisarAdmin(false);

  /* ─────────────── Apariencia (tema) y clave de administración ─────────────── */
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
  $('aparienciaBtn').addEventListener('click', () => {
    pintarTemas();
    errorCampo($('claveIn'), $('claveErr'), '');
    $('claveOlvidar').hidden = !A.clave.hay();
    dlgAp.showModal();
    const sel = dlgAp.querySelector('input[name="tema"]:checked');
    if (sel) sel.focus();
  });
  dlgAp.addEventListener('close', () => $('aparienciaBtn').focus());
  $('apCerrar').addEventListener('click', () => dlgAp.close());
  $('claveForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const v = $('claveIn').value.trim();
    if (!v) return errorCampo($('claveIn'), $('claveErr'), 'Pega la clave de administración.');
    A.clave.poner(v);
    const r = await revisarAdmin(false);
    if (!r.ok) {
      A.clave.olvidar();
      $('claveOlvidar').hidden = true;
      return errorCampo($('claveIn'), $('claveErr'), r.status === 0 ? L.mensajeError(0) : 'La clave no es correcta.');
    }
    $('claveIn').value = '';
    dlgAp.close();
    principal.elegirVista('admin', true);
    toast('Listo: ya tienes la pestaña Administración.');
  });
  $('claveOlvidar').addEventListener('click', async () => {
    A.clave.olvidar();
    await revisarAdmin(false);
    toast(tabAdmin.hidden ? 'Clave olvidada en este navegador.' : 'Clave olvidada. Desde este equipo sigues teniendo acceso.');
  });
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

  /* ─────────────── letras, karaoke y visualizador (módulos que se cargan al abrirlos) ─────────────── */
  const abrirLetras = (karaoke) => abrirModulo('letras', { karaoke });
  $('bLetra').addEventListener('click', () => abrirLetras(false));
  $('bKaraoke').addEventListener('click', () => abrirLetras(true));
  $('bVisual').addEventListener('click', () => abrirModulo('visualizador'));

  /* barra compacta (≤ 600 px): «Más opciones» muestra los botones secundarios */
  $('bMas').addEventListener('click', () => {
    const abierta = $('bMas').getAttribute('aria-expanded') !== 'true';
    $('bMas').setAttribute('aria-expanded', String(abierta));
    document.body.classList.toggle('barra-abierta', abierta);
  });

  /* ─────────────── atajos de teclado ─────────────── */
  /* WCAG 2.1.4: se pueden apagar desde la ayuda (se recuerda en este navegador). Apagados, ninguna tecla suelta actúa (tampoco «?»,
     que también es un atajo de un carácter); para volver a encenderlos está el botón «?» del encabezado. */
  const LS_ATAJOS = 'pl_atajos';
  let atajosOn = store.get(LS_ATAJOS) !== '0';
  $('atajosOn').checked = atajosOn;
  $('atajosOn').addEventListener('change', () => {
    atajosOn = $('atajosOn').checked;
    if (atajosOn) store.del(LS_ATAJOS); else store.set(LS_ATAJOS, '0');
    toast(atajosOn ? 'Atajos de una tecla activados.' : 'Atajos de una tecla desactivados. Esta ayuda sigue en el botón «?» de arriba.');
  });
  const enfocarBuscar = () => { if (principal.elegirVista('buscar', false)) cuandoCargue('buscar', (v) => { if (v.enfocar) v.enfocar(); }); };
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
    if (accion === 'toggle') { if (estado && estado.track) send({ cmd: 'toggle' }); }
    else if (accion === 'next') { esperaAnuncio = { id: estado && estado.track ? estado.track.id : '', t0: Date.now() }; send({ cmd: 'next' }); }
    else if (accion === 'letras' || accion === 'karaoke') {
      const m = modulos.letras;
      if (m && m.abierto()) { if ((accion === 'karaoke') === m.karaoke()) m.cerrar(); else m.modo(accion === 'karaoke'); }
      else abrirLetras(accion === 'karaoke');
    } else if (accion === 'buscar') enfocarBuscar();
    else if (accion === 'ayuda') abrirAyuda();
    else if (accion.indexOf('pestana:') === 0) {
      const lista = principal.tabs();
      const i = Number(accion.slice(8)) - 1;
      if (lista[i]) principal.elegir(i, true);
    }
  });

  /* Para las vistas */
  window.Panel = {
    h, emo, icono, errorCampo, toast, toastError, store, tablist, vistas, modulos, L, api: A,
    sid, player, send, on, emit,
    estado: () => estado,
    usuario: () => user,
    pestana: () => activa,
    abrir: abrirModulo,
    abrirCuenta: () => { if (window.PlayCuenta) window.PlayCuenta.abrir(); },
    reacciones: { mapa: () => mapa, de: (id) => L.reactionOf(mapa, id), alternar: reaccionar, lista: (r) => L.listByReaction(mapa, r) },
    selectorPlaylist: abrirSelector,
    revisarAdmin
  };
  tick();
})();
