/* app.js — reproductor: cola, historial, modo audio/video, género, letra, visualizador. */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const U = window.Util;
  const media = $('media');   /* audio: siempre suena; es el reloj maestro */
  const vid = $('vid');       /* video sin sonido: solo en modo video, sigue al audio */
  const params = new URLSearchParams(location.search);
  /* Dos vistas con el mismo reproductor: la normal y /kiosco (video de fondo difuminado + reloj grande). */
  const VIEW = /^\/kiosco\/?$/.test(location.pathname) || params.get('view') === 'kiosco' ? 'kiosco' : 'normal';
  document.body.dataset.view = VIEW;
  /* ?view=local: motor de /panel (va dentro de un iframe invisible). Reproduce aquí y NO es una pantalla: no escucha las órdenes
     de /remote, no reporta su estado al servidor (no pisa el de la pantalla real) y avisa a /panel con mensajes. */
  const LOCAL = params.get('view') === 'local';
  const SID = LOCAL ? params.get('sid') || '' : ''; /* racha propia: el servidor la lleva aparte de la de las pantallas */
  /* Pantalla panorámica alimentada con 1920×1080 y estirada por el panel: ?estirar=2 diseña la vista al ancho real
     (el doble) y la comprime a la mitad, así las letras salen con su forma normal. 1 = pantalla normal. */
  const ESTIRAR = Math.min(4, Math.max(1, Number(params.get('estirar')) || 1));
  document.body.style.setProperty('--k', ESTIRAR);

  const state = {
    mode: 'audio',
    queue: [],          /* próximas pistas ya pedidas al servidor */
    current: null,      /* { track, genre, genreChanged } */
    history: U.createHistory(50),
    genres: [],
    loading: false,
    carga: 0,           /* número de la carga vigente: lo que elige la persona abre una nueva y la anterior, al volver, se tira */
    failures: 0,
    toppingUp: false,
    gen: 0,             /* sube con cada elección de la persona: lo pedido antes (precargas en vuelo) ya no entra en la cola */
    semilla: '',        /* «más como esto» pendiente: la primera precarga tras una canción elegida la lleva */
    plan: null,         /* cola externa (orden 'queue' de /panel/completo): { items, i } o null */
    seeking: false,
    lyrics: { open: false, lines: null, idx: -1, timer: 0 }
  };

  /* ── utilidades ─────────────────────────────────────────────── */
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* modo privado */ } }
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  /* Si la página se abre desde otro equipo, el token viaja en cada petición (?t=). */
  const TOKEN = params.get('t') || '';
  const withT = (u) => (TOKEN ? u + (u.includes('?') ? '&' : '?') + 't=' + encodeURIComponent(TOKEN) : u);
  const playUrl = (id, mode) => withT('/api/play/' + id + '?mode=' + mode);
  const thumbUrl = (id) => withT('/api/thumb/' + id);

  let toastTimer = 0;
  function toast(msg, ms) {
    if (LOCAL) { try { parent.postMessage({ type: 'toast', msg, ms }, location.origin); } catch (_) { /* sin panel */ } return; }
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms || 3200);
  }

  async function getJson(url) {
    const r = await fetch(withT(url));
    if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { status: r.status });
    return r.json();
  }

  /* ── cola y servidor ────────────────────────────────────────── */
  function fetchNext(opts) {
    const q = new URLSearchParams();
    if (opts && opts.genre) q.set('genre', opts.genre);
    if (opts && opts.change) q.set('change', '1');
    if (opts && opts.query) q.set('q', opts.query);
    if (opts && opts.semilla) q.set('semilla', opts.semilla);
    if (SID) q.set('sid', SID);
    return getJson('/api/next' + (q.toString() ? '?' + q : ''));
  }

  /* Reintenta con espera creciente: sin conexión no se queda mudo ni rompe nada. Con «yo»: si mientras tanto la persona eligió
     otra cosa (otra carga), deja de intentar y devuelve null. */
  async function fetchNextPatient(opts, yo) {
    for (let i = 0; ; i++) {
      if (yo !== undefined && yo !== state.carga) return null;
      try { return await fetchNext(opts); }
      catch (e) {
        if (e.status === 400 || e.status === 409) throw e;
        setStatus('Sin conexión con YouTube — reintentando…');
        await sleep(Math.min(3000 * (i + 1), 30000));
      }
    }
  }

  /* En modo video, pide 1 byte del video de la SIGUIENTE pista: así yt-dlp ya lo resolvió cuando le toque. */
  function warmVideo(item) {
    if (state.mode !== 'video' || !item) return;
    fetch(playUrl(item.track.id, 'video'), { headers: { range: 'bytes=0-0' } }).then((r) => r.body && r.body.cancel()).catch(() => {});
  }

  /* Precarga 2 pistas. Si mientras tanto la persona eligió otra cosa (gen cambió), lo que llega ya no sirve: se tira y se precarga de nuevo. */
  async function topUp() {
    const gen = state.gen;
    if (state.toppingUp === gen) return;
    state.toppingUp = gen;
    try {
      while (state.queue.length < 2) {
        const semilla = state.semilla;
        const item = await fetchNext(semilla ? { semilla } : undefined);
        if (gen !== state.gen) return;
        if (semilla && state.semilla === semilla) state.semilla = '';
        state.queue.push(item);
      }
    } catch (_) { /* se reintenta en la siguiente pista */ }
    finally { if (state.toppingUp === gen) state.toppingUp = false; }
    if (gen !== state.gen) return;
    warmVideo(state.queue[0]);
    renderUpNext();
  }

  /* ── reproducción ───────────────────────────────────────────── */
  function setAccent(color) {
    const glow = $('glow');
    glow.style.opacity = '0';
    setTimeout(() => { document.documentElement.style.setProperty('--accent', color || '#F59B23'); glow.style.opacity = '1'; }, 250);
  }

  function setStatus(msg) { $('channel').textContent = msg; }

  function renderGenre(g, changed) {
    U.setEmoji($('gpEmoji'), g.emoji || '🎵');
    $('gpLabel').textContent = g.label;
    const pill = $('genrePill');
    pill.style.borderColor = g.color || '';
    if (changed) { pill.classList.remove('pop'); void pill.offsetWidth; pill.classList.add('pop'); }
  }

  function setBusy(on) {
    document.body.classList.toggle('busy', on);
    if (on) $('upnext').textContent = 'Buscando música…';
  }

  function renderUpNext() {
    const n = state.queue[0];
    const el = $('upnext');
    if (!n) { el.textContent = ''; return; }
    const sw = state.current && n.genre.id !== state.current.genre.id ? ' · ' + n.genre.label : '';
    el.innerHTML = 'Sigue: <b></b>' + sw.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    el.querySelector('b').textContent = n.track.title;
  }

  function setArt(id) {
    const img = $('artImg');
    img.classList.remove('on');
    img.onload = () => img.classList.add('on');
    img.onerror = () => img.classList.remove('on');
    img.src = thumbUrl(id);
  }

  function loadSrc() {
    media.src = playUrl(state.current.track.id, 'audio');
    syncVideoSource();
    startPlayback();
  }

  /* El video solo se pide en modo video; al volver a audio se libera. */
  function syncVideoSource() {
    if (state.mode === 'video' && state.current) {
      vid.poster = thumbUrl(state.current.track.id); /* se ve la carátula hasta el primer cuadro (no un recuadro negro) */
      vid.src = playUrl(state.current.track.id, 'video');
      vid.addEventListener('loadedmetadata', () => {
        try { vid.currentTime = media.currentTime; } catch (_) { /* sin seek */ }
        if (!media.paused) vid.play().catch(() => {});
      }, { once: true });
    } else if (vid.getAttribute('src')) {
      vid.pause(); vid.removeAttribute('src'); vid.removeAttribute('poster'); vid.load();
    }
  }

  function startPlayback() {
    const p = media.play();
    if (p && p.then) p.then(() => { $('start').hidden = true; }, (e) => { if (e.name === 'NotAllowedError') $('start').hidden = false; });
  }

  function playItem(item) {
    state.current = item;
    const t = item.track;
    $('title').textContent = t.title;
    $('title').classList.toggle('long', t.title.length > 60); /* letra más chica para que se lea completo */
    $('channel').textContent = t.channel || '';
    $('tNow').textContent = '0:00';
    $('tDur').textContent = U.fmtTime(t.duration);
    setRange($('seek'), 0);
    document.title = '▶ ' + t.title;
    setArt(t.id);
    setAccent(item.genre.color);
    renderGenre(item.genre, item.genreChanged);
    renderUpNext();
    setMediaSession(item);
    loadSrc();
    reportState();
    if (state.lyrics.open) loadLyrics();
  }

  /* Una carga a la vez, pero lo que elige la persona (género, búsqueda, canción, lista) no espera a la anterior: abre otra y la vieja,
     al volver, ve que ya no es la vigente y no toca nada. Antes esas órdenes se descartaban si, p. ej., la precarga del arranque
     seguía buscando (red lenta o sin YouTube): la persona tocaba y no pasaba nada. */
  function abrirCarga(ocupado) { state.loading = true; if (ocupado) setBusy(true); return ++state.carga; }
  function cerrarCarga(yo) { if (yo === state.carga) { state.loading = false; setBusy(false); } }
  const vigente = (yo) => yo === state.carga;

  async function advance() {
    if (state.loading) return; /* «siguiente» dos veces seguidas no salta dos canciones */
    const yo = abrirCarga(false);
    const antes = state.current;
    try {
      if (state.plan) { if (antes) state.history.push(antes); setBusy(true); if (await playPlan(state.plan.i + 1)) return; } /* siguiente de la lista; al acabar, sigue la radio */
      else if (antes) state.history.push(antes);
      if (!state.queue.length) setBusy(true);
      const item = state.queue.shift() || await fetchNextPatient(undefined, yo);
      if (!item || !vigente(yo)) return; /* la persona eligió otra cosa mientras se buscaba */
      playItem(item);
      topUp();
    } finally { cerrarCarga(yo); }
  }

  function prev() {
    if (state.plan) { /* dentro de una lista: reinicia la pista o vuelve a la anterior de la lista */
      if (media.currentTime > 3 || state.plan.i === 0 || state.loading) { media.currentTime = 0; return; }
      const yo = abrirCarga(true);
      playPlan(state.plan.i - 1).finally(() => cerrarCarga(yo));
      return;
    }
    if (media.currentTime > 3 || state.history.size() === 0) { media.currentTime = 0; return; }
    const p = state.history.pop();
    if (state.current) state.queue.unshift(state.current);
    playItem(p);
  }

  /* Un solo intento: si falla se avisa y se sigue con lo que suena. */
  /* keepQueue: pauta única (búsqueda): la cola y la racha se quedan como estaban. */
  async function switchTo(opts, { keepQueue = false } = {}) {
    const yo = abrirCarga(true);
    if (!keepQueue) { state.gen++; state.semilla = ''; }
    try {
      const item = await fetchNext(opts);
      if (!vigente(yo)) return; /* llegó tarde: ya se eligió otra cosa */
      if (!keepQueue) state.queue.length = 0;
      if (state.current) state.history.push(state.current);
      playItem(item);
      topUp();
    } catch (_) {
      if (vigente(yo)) toast(opts.query ? 'No encontré resultados que se puedan reproducir.' : 'No se encontró música para ese género. Prueba otro.');
    } finally { cerrarCarga(yo); renderUpNext(); }
  }
  const changeGenre = (id) => switchTo(id ? { genre: id } : { change: true });
  /* En una pantalla la búsqueda es pauta única (la lista sigue como iba); en el panel lo que sigue sale de esa búsqueda (el servidor lleva la racha). */
  const playQuery = (q) => switchTo({ query: q }, { keepQueue: !LOCAL });

  /* Un episodio o canción concreta (viene del control remoto): suena ahora y la lista sigue como estaba. */
  const KIND_GENRE = {
    podcast: { id: 'podcast', label: 'Podcast', emoji: '🎙️', color: '#a78bfa' },
    search: { id: 'search', label: 'Búsqueda', emoji: '🔎', color: '#F59B23' }
  };
  function playTrackOnce(track, kind) {
    cerrarCarga(abrirCarga(false)); /* suena ya: lo que se estuviera buscando queda sin efecto */
    if (state.current) state.history.push(state.current);
    if (LOCAL && kind !== 'podcast') { /* panel: lo que sigue es «más como esto» (mismo artista), no lo que había en la cola */
      state.gen++; state.queue.length = 0; state.semilla = U.semillaDe(track);
    }
    playItem({ track, genre: Object.assign({}, KIND_GENRE[kind] || KIND_GENRE.search), genreChanged: true });
    topUp();
  }

  /* Cola externa: reproduce la lista en orden (canciones conocidas o consultas que se resuelven con la búsqueda) y al terminar vuelve la radio.
     No precarga la radio mientras dura. Termina con cualquier orden de género, búsqueda o pista suelta, o al mandar una lista vacía. */
  const PLAN_GENRE = { id: 'lista', label: 'Mi lista', emoji: '🎵', color: '#F59B23' };
  async function playPlan(from) {
    const p = state.plan;
    for (let i = from; p && i < p.items.length; i++) {
      const it = p.items[i];
      let item = null;
      try { item = it.track ? { track: it.track, genre: Object.assign({}, PLAN_GENRE), genreChanged: true } : await fetchNext({ query: it.q }); } catch (_) { /* sin resultado: se salta */ }
      if (state.plan !== p) return true; /* la cancelaron mientras se resolvía: ya no toca */
      if (!item) continue;
      p.i = i;
      playItem(item);
      return true;
    }
    if (state.plan === p) state.plan = null; /* se acabó la lista */
    return false;
  }
  async function startPlan(rawItems, index) {
    state.plan = null;
    const items = U.cleanQueueItems(rawItems);
    if (!items.length) return;
    const yo = abrirCarga(true);
    try {
      state.gen++; state.semilla = ''; state.queue.length = 0;
      if (state.current) state.history.push(state.current);
      state.plan = { items, i: 0 };
      const start = Number.isInteger(index) && index >= 0 && index < items.length ? index : 0;
      if (!(await playPlan(start)) && vigente(yo)) toast('No encontré nada que se pueda reproducir en esa lista.');
    } finally { cerrarCarga(yo); renderUpNext(); }
  }

  function toggle() { if (media.paused) startPlayback(); else media.pause(); }

  /* ── errores y vigilancia ───────────────────────────────────── */
  async function onFail(reason) {
    if (state.loading || !state.current) return;
    /* Primero se reintenta la misma pista una vez (URL caducada, Pi ocupada); después se salta. */
    if (state.retryId !== state.current.track.id) {
      state.retryId = state.current.track.id;
      toast('Reintentando…', 1800);
      loadSrc();
      return;
    }
    state.failures++;
    if (state.failures >= 5) {
      setStatus('Sin conexión con YouTube — reintentando en 30 s');
      toast('Varias pistas seguidas fallaron. Reintento en 30 s.', 5000);
      state.failures = 0;
      await sleep(30000);
    } else {
      toast(reason + ' Saltando a la siguiente…');
      await sleep(900);
    }
    advance();
  }

  let stallTimer = 0;
  const armStall = () => { clearTimeout(stallTimer); stallTimer = setTimeout(() => onFail('La pista no avanza.'), 20000); };
  const clearStall = () => clearTimeout(stallTimer);

  media.addEventListener('error', () => {
    if (media.error && media.error.code === 1) return; /* abortado por cambio de pista */
    onFail('No se pudo reproducir.');
  });
  media.addEventListener('waiting', () => { armStall(); vid.pause(); });
  media.addEventListener('stalled', armStall);
  media.addEventListener('playing', () => {
    clearStall(); state.failures = 0; setPlayIcon(true); ensureAudioGraph(); startVis(); reportState();
    if (vid.getAttribute('src')) vid.play().catch(() => {});
  });
  media.addEventListener('pause', () => { clearStall(); setPlayIcon(false); vid.pause(); reportState(); });
  media.addEventListener('seeked', () => { if (vid.getAttribute('src')) { try { vid.currentTime = media.currentTime; } catch (_) { /* sin seek */ } } });
  media.addEventListener('ended', () => advance());

  /* El video sigue al audio: si se desfasa más de 0.35 s se reengancha. */
  setInterval(() => {
    if (!vid.getAttribute('src') || media.paused || vid.readyState < 2) return;
    if (Math.abs(vid.currentTime - media.currentTime) > 0.35) { try { vid.currentTime = media.currentTime; } catch (_) { /* sin seek */ } }
  }, 2000);
  /* Sin video disponible la música sigue: se vuelve a solo audio. */
  vid.addEventListener('error', () => {
    if (!vid.getAttribute('src') || (vid.error && vid.error.code === 1)) return;
    toast('El video no está disponible, seguimos con audio.');
    setMode('audio');
  });

  /* ── progreso / volumen ─────────────────────────────────────── */
  function setRange(el, pct) { el.style.setProperty('--p', pct + '%'); }

  function duration() {
    return Number.isFinite(media.duration) && media.duration > 0 ? media.duration : (state.current ? state.current.track.duration : 0) || 0;
  }

  media.addEventListener('timeupdate', () => {
    clearStall();
    if (state.seeking) return;
    const d = duration();
    const pct = d ? Math.min(100, (media.currentTime / d) * 100) : 0;
    $('seek').value = pct * 10;
    setRange($('seek'), pct);
    $('tNow').textContent = U.fmtTime(media.currentTime);
    $('tDur').textContent = U.fmtTime(d);
  });

  const seek = $('seek');
  seek.addEventListener('pointerdown', () => { state.seeking = true; });
  seek.addEventListener('input', () => {
    const d = duration();
    setRange(seek, seek.value / 10);
    $('tNow').textContent = U.fmtTime((seek.value / 1000) * d);
  });
  seek.addEventListener('change', () => {
    const d = duration();
    if (d) { try { media.currentTime = (seek.value / 1000) * d; } catch (_) { /* sin seek */ } }
    state.seeking = false;
  });

  function setPlayIcon(playing) {
    $('playIco').firstElementChild.setAttribute('href', playing ? '#i-pause' : '#i-play');
    $('btnPlay').setAttribute('aria-label', playing ? 'Pausar' : 'Reproducir');
  }

  const vol = $('vol');
  let duck = 1; /* 1 = normal; baja mientras suena el locutor (ver más abajo) */
  function setMediaVolume() { media.volume = Math.max(0, Math.min(1, Number(vol.value) / 100 * duck)); }
  function applyVolume() {
    const v = Number(vol.value);
    setMediaVolume();
    setRange(vol, v);
    const muted = media.muted || v === 0;
    $('muteIco').firstElementChild.setAttribute('href', muted ? '#i-mute' : '#i-vol');
    store.set('pl_vol', String(v));
    reportState();
  }
  vol.addEventListener('input', () => { if (media.muted && vol.value > 0) media.muted = false; applyVolume(); });
  function nudgeVolume(d) { vol.value = Math.max(0, Math.min(100, Number(vol.value) + d)); media.muted = false; applyVolume(); toast('Volumen ' + vol.value + '%', 900); }
  function setVolumeValue(v) { vol.value = Math.max(0, Math.min(100, v)); media.muted = false; applyVolume(); if (!LOCAL) toast('Volumen ' + vol.value + '%', 900); }
  function toggleMute() { media.muted = !media.muted; applyVolume(); }

  /* ── modo audio / video ─────────────────────────────────────── */
  function setMode(m) {
    state.mode = m;
    document.body.dataset.mode = m;
    $('modeIco').firstElementChild.setAttribute('href', m === 'video' ? '#i-music' : '#i-video');
    $('modeLbl').textContent = m === 'video' ? 'Solo audio' : 'Video';
    $('btnMode').setAttribute('aria-pressed', String(m === 'video'));
    $('btnMode').setAttribute('aria-label', m === 'video' ? 'Cambiar a solo audio' : 'Cambiar a video');
    store.set('pl_mode', m);
    syncVideoSource(); /* el audio no se toca: cambiar de modo no corta la música */
    warmVideo(state.queue[0]);
    reportState();
  }

  /* ── géneros ────────────────────────────────────────────────── */
  function buildChips() {
    const box = $('chips');
    const sorted = state.genres.slice().sort((a, b) => (b.featured - a.featured) || a.label.localeCompare(b.label, 'es'));
    const frag = document.createDocumentFragment();
    sorted.forEach((g) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'chip'; b.dataset.id = g.id; b.dataset.q = (g.label + ' ' + g.id).toLowerCase();
      b.style.setProperty('--c', g.color || '');
      const e = document.createElement('span'); e.className = 'e'; U.setEmoji(e, g.emoji || '🎵');
      const l = document.createElement('span'); l.className = 'l'; l.textContent = g.label;
      b.append(e, l);
      frag.appendChild(b);
    });
    box.replaceChildren(frag);
  }

  function openSheet() {
    $('sheet').hidden = false;
    $('genreFilter').value = '';
    filterChips('');
    document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', !!state.current && c.dataset.id === state.current.genre.id));
  }
  const closeSheet = () => { $('sheet').hidden = true; };
  function filterChips(q) {
    q = q.trim().toLowerCase();
    document.querySelectorAll('.chip').forEach((c) => { c.hidden = !!q && !c.dataset.q.includes(q); });
  }

  /* ── letra ──────────────────────────────────────────────────── */
  async function loadLyrics() {
    const body = $('lyrBody');
    const t = state.current && state.current.track;
    if (!t) return;
    $('lyrTitle').textContent = t.title;
    state.lyrics.lines = null; state.lyrics.idx = -1;
    body.innerHTML = '<p class="lyr-msg">Buscando letra…</p>';
    const q = new URLSearchParams({ title: t.title, channel: t.channel || '', duration: String(t.duration || 0) });
    const mine = t.id;
    let data = null;
    try { data = await getJson('/api/lyrics?' + q); } catch (_) { /* sin letra */ }
    if (!state.current || state.current.track.id !== mine) return; /* cambió la pista */
    body.replaceChildren();
    if (!data) { const p = document.createElement('p'); p.className = 'lyr-msg'; p.textContent = 'No hay letra para esta canción.'; body.appendChild(p); return; }
    if (data.synced && data.synced.length) {
      state.lyrics.lines = data.synced;
      data.synced.forEach((l, i) => { const d = document.createElement('div'); d.className = 'lyr-line'; d.dataset.i = i; d.textContent = l.text; body.appendChild(d); });
      body.scrollTop = 0;
      tickLyrics();
    } else {
      const pre = document.createElement('div'); pre.className = 'lyr-plain'; pre.textContent = data.plain; body.appendChild(pre);
    }
  }

  function tickLyrics() {
    const L = state.lyrics;
    if (!L.lines) return;
    const i = U.activeLine(L.lines, media.currentTime);
    if (i === L.idx) return;
    L.idx = i;
    const kids = $('lyrBody').children;
    for (let k = 0; k < kids.length; k++) kids[k].className = 'lyr-line' + (k === i ? ' on' : k < i ? ' past' : '');
    if (kids[i]) kids[i].scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function openLyrics() {
    state.lyrics.open = true;
    $('lyrics').hidden = false;
    state.lyrics.timer = setInterval(tickLyrics, 200);
    loadLyrics();
  }
  function closeLyrics() {
    state.lyrics.open = false;
    $('lyrics').hidden = true;
    clearInterval(state.lyrics.timer);
  }

  /* ── visualizador (analizador real si se puede; si no, barras sintéticas) ── */
  const canvas = $('vis');
  const cx = canvas.getContext('2d');
  let analyser = null, freq = null, audioCtx = null, visOn = params.get('vis') !== '0' && !LOCAL, visRaf = 0, lastFrame = 0;
  const BARS = 40;

  async function ensureAudioGraph() {
    if (analyser || !visOn) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = audioCtx || (audioCtx = new Ctx());
      if (ctx.state !== 'running') await ctx.resume().catch(() => {});
      /* Si el navegador no deja arrancar el contexto, NO se conecta: el audio
       * quedaría mudo. Se reintenta en el primer gesto del usuario. */
      if (ctx.state !== 'running') return;
      const src = ctx.createMediaElementSource(media);
      const an = ctx.createAnalyser();
      an.fftSize = 128; an.smoothingTimeConstant = 0.8;
      src.connect(an); an.connect(ctx.destination);
      analyser = an; freq = new Uint8Array(an.frequencyBinCount);
    } catch (_) { visOn = visOn && !!analyser; }
  }

  function sizeCanvas() {
    const r = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  }

  function drawVis(ts) {
    visRaf = requestAnimationFrame(drawVis);
    if (ts - lastFrame < 33) return; /* ~30 fps */
    lastFrame = ts;
    sizeCanvas();
    const w = canvas.width, h = canvas.height;
    cx.clearRect(0, 0, w, h);
    const playing = !media.paused;
    if (analyser && playing) analyser.getByteFrequencyData(freq);
    const gap = w / BARS, bw = gap * 0.62;
    const grad = cx.createLinearGradient(0, h, 0, 0);
    grad.addColorStop(0, '#F59B23');
    grad.addColorStop(1, getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#F7B84B');
    cx.fillStyle = grad;
    let any = false;
    for (let i = 0; i < BARS; i++) {
      let v;
      if (analyser) v = playing ? freq[Math.floor((i / BARS) * freq.length * 0.75)] / 255 : 0;
      else v = playing ? 0.25 + 0.35 * Math.abs(Math.sin(ts / 420 + i * 0.7)) * (0.6 + 0.4 * Math.sin(ts / 910 + i)) : 0;
      if (v > 0.01) any = true;
      const bh = Math.max(2, v * h * 0.95);
      cx.fillRect(i * gap + (gap - bw) / 2, h - bh, bw, bh);
    }
    if (!playing && !any) { cancelAnimationFrame(visRaf); visRaf = 0; cx.clearRect(0, 0, w, h); }
  }
  function startVis() { if (VIEW === 'normal' && visOn && !visRaf && !matchMedia('(prefers-reduced-motion: reduce)').matches) visRaf = requestAnimationFrame(drawVis); }

  /* ── Media Session (teclas multimedia, pantalla de bloqueo) ── */
  function setMediaSession(item) {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: item.track.title, artist: item.track.channel || '', album: item.genre.label,
        artwork: [{ src: location.origin + thumbUrl(item.track.id), sizes: '1280x720', type: 'image/jpeg' }]
      });
    } catch (_) { /* navegador sin soporte */ }
  }
  if ('mediaSession' in navigator) {
    const set = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch (_) { /* no soportado */ } };
    set('play', startPlayback); set('pause', () => media.pause());
    set('previoustrack', prev); set('nexttrack', advance);
    set('seekto', (d) => { if (d.seekTime != null) media.currentTime = d.seekTime; });
  }

  /* ── eventos de la interfaz ─────────────────────────────────── */
  $('btnPlay').addEventListener('click', toggle);
  $('btnNext').addEventListener('click', advance);
  $('btnPrev').addEventListener('click', prev);
  $('btnMute').addEventListener('click', toggleMute);
  $('btnShuffle').addEventListener('click', () => changeGenre(null));
  $('btnGenres').addEventListener('click', openSheet);
  $('genrePill').addEventListener('click', openSheet);
  $('btnMode').addEventListener('click', () => setMode(state.mode === 'video' ? 'audio' : 'video'));
  $('btnLyrics').addEventListener('click', () => (state.lyrics.open ? closeLyrics() : openLyrics()));
  $('lyrClose').addEventListener('click', closeLyrics);
  $('sheetClose').addEventListener('click', closeSheet);
  $('btnRandom').addEventListener('click', () => { closeSheet(); changeGenre(null); });
  $('genreFilter').addEventListener('input', (e) => filterChips(e.target.value));
  $('chips').addEventListener('click', (e) => {
    const c = e.target.closest('.chip');
    if (c) { closeSheet(); changeGenre(c.dataset.id); }
  });
  $('start').addEventListener('click', () => { $('start').hidden = true; startPlayback(); ensureAudioGraph(); });
  $('art').addEventListener('click', toggle);

  /* Primer gesto: permite arrancar el AudioContext del visualizador. */
  ['pointerdown', 'keydown'].forEach((ev) => addEventListener(ev, () => { if (!analyser && !media.paused) ensureAudioGraph(); }, { passive: true }));

  addEventListener('keydown', (e) => {
    if (e.target.matches('input[type="search"], input[type="text"]')) { if (e.key === 'Escape') closeSheet(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (VIEW === 'kiosco') return; /* solo vista: todo se maneja desde /remote */
    if (k === 'Escape') { closeSheet(); closeLyrics(); return; }
    if (k === ' ') { e.preventDefault(); toggle(); }
    else if (k === 'ArrowRight' || k === 'n' || k === 'N') advance();
    else if (k === 'ArrowLeft' || k === 'p' || k === 'P') prev();
    else if (k === 'ArrowUp') { e.preventDefault(); nudgeVolume(5); }
    else if (k === 'ArrowDown') { e.preventDefault(); nudgeVolume(-5); }
    else if (k === 'm' || k === 'M') toggleMute();
    else if (k === 'v' || k === 'V') $('btnMode').click();
    else if (k === 'l' || k === 'L') $('btnLyrics').click();
    else if (k === 'g' || k === 'G') openSheet();
    else if (k === 'r' || k === 'R') changeGenre(null);
    else if (k === 'i' || k === 'I') toggleInfo();
  });

  /* Cursor oculto tras 4 s sin moverlo (monitor de sala). */
  let idleTimer = 0;
  const wake = () => { document.body.classList.remove('idle'); clearTimeout(idleTimer); idleTimer = setTimeout(() => document.body.classList.add('idle'), 4000); };
  addEventListener('mousemove', wake, { passive: true });
  wake();

  /* ── control remoto (SSH / web /remote) ─────────────────────── */
  let lastReport = 0, reportTimer = 0;
  function reportState() {
    if (LOCAL) return;
    clearTimeout(reportTimer);
    reportTimer = setTimeout(() => {
      lastReport = Date.now();
      const cur = state.current;
      fetch(withT('/api/state'), {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ paused: media.paused, muted: media.muted, volume: Number(vol.value), mode: state.mode, time: media.currentTime, track: cur && cur.track, genre: cur && cur.genre })
      }).catch(() => {});
    }, Math.max(0, 800 - (Date.now() - lastReport)));
  }
  setInterval(() => { if (!media.paused) reportState(); }, 5000);

  const CMD_LABEL = { toggle: 'Pausa / play', play: 'Play', pause: 'Pausa', next: 'Siguiente', prev: 'Anterior', random: 'Otro género al azar', mute: 'Silenciar', lyrics: 'Letra' };
  function handleCommand(c) {
    const say = (m, ms) => { if (!LOCAL) toast('Remoto · ' + m, ms); }; /* el aviso "Remoto ·" solo tiene sentido en una pantalla */
    if (CMD_LABEL[c.cmd]) say(CMD_LABEL[c.cmd], 1500);
    if (c.cmd === 'genre' || c.cmd === 'search' || c.cmd === 'random' || c.cmd === 'track') state.plan = null; /* lo que se pide ahora cancela la lista */
    switch (c.cmd) {
      case 'toggle': toggle(); break;
      case 'play': startPlayback(); break;
      case 'pause': media.pause(); break;
      case 'next': advance(); break;
      case 'prev': prev(); break;
      case 'random': changeGenre(null); break;
      case 'genre': say('género', 1500); changeGenre(c.id); break;
      case 'search': say('buscando "' + c.q + '"', 2500); playQuery(c.q); break;
      case 'track': say(c.kind === 'podcast' ? 'podcast' : 'canción', 2000); playTrackOnce(c.track, c.kind); break;
      case 'queue': startPlan(c.items, c.index); break;
      case 'volume': if (c.set !== undefined) setVolumeValue(c.set); else nudgeVolume(c.delta); break;
      case 'mute': toggleMute(); break;
      case 'seek': seekTo(c.t); break; /* barra de progreso de /panel: segundos, validados */
      case 'mode': setMode(c.mode); break;
      case 'lyrics': $('btnLyrics').click(); break;
      case 'announce': announce(Date.now() + timeOffset, true); break;
      case 'anuncio': anuncio(c.id); break; /* anuncio programado (Administración → Anuncios): solo pantallas */
      default: break;
    }
  }
  /* Adelantar o regresar a un segundo de la canción: solo números finitos ≥ 0, con canción y sin pasar del final. */
  function seekTo(t) {
    const d = duration();
    if (typeof t !== 'number' || !Number.isFinite(t) || t < 0 || !(d > 0)) return;
    try { media.currentTime = Math.min(t, Math.max(0, d - 0.5)); } catch (_) { /* sin seek */ }
  }
  /* Interfaz para /panel (mismo origen): órdenes directas y el estado con la misma forma que /api/state. */
  window.__player = {
    handleCommand,
    /* /panel la llama DENTRO de cada toque de la persona: si el navegador había bloqueado el sonido, la música arranca con ese mismo
       toque (sin botón «Toca para empezar» ni darle play aparte). Sin bloqueo no hace nada. */
    /* El locutor de /panel baja la música mientras habla (1 = normal). */
    duck(nivel) { if (typeof nivel === 'number' && Number.isFinite(nivel)) { duck = Math.max(0, Math.min(1, nivel)); setMediaVolume(); } },
    unlock() { if (!$('start').hidden && media.getAttribute('src')) startPlayback(); },
    getState() {
      const cur = state.current;
      return { players: 1, blocked: !$('start').hidden, loading: state.loading, paused: media.paused, muted: media.muted || Number(vol.value) === 0, volume: Number(vol.value), mode: state.mode,
        time: media.currentTime, duration: duration(), track: cur && cur.track, genre: cur && cur.genre,
        viaje: (cur && cur.viaje) || null, /* viaje de Bienestar de la pista que suena (lo trae /api/next) */
        cola: state.plan ? { i: state.plan.i, total: state.plan.items.length } : null }; /* lista en curso (orden 'queue') */
    }
  };

  function connectEvents() {
    if (LOCAL || !window.EventSource) return;
    const es = new EventSource(withT('/api/events')); /* se reconecta solo */
    es.onmessage = (e) => { try { handleCommand(JSON.parse(e.data)); } catch (_) { /* orden mal formada */ } };
  }

  /* ── vista kiosco: reloj y fondo ────────────────────────────── */
  /* La Pi puede tener el reloj atrasado: el servidor da la hora real (la saca de HTTPS). Si no está sincronizado, se usa el reloj local. */
  let timeOffset = 0;
  async function syncTime() {
    try {
      const t0 = Date.now();
      const j = await getJson('/api/time');
      const t1 = Date.now();
      timeOffset = j.synced ? j.now - Math.round((t0 + t1) / 2) : 0;
    } catch (_) { /* se conserva el desfase anterior */ }
  }
  function tickClock() {
    const now = Date.now() + timeOffset;
    const p = U.clockParts(now);
    $('clockTime').textContent = p.time;
    $('clockDate').textContent = p.date;
    const slot = U.announceSlot(now, ANUNCIAR_CADA);
    if (slot !== null && slot !== lastSlot) { lastSlot = slot; announce(now); }
  }

  /* ── locutor (solo /kiosco): cada N min suena el jingle y una voz dice la hora, con la música baja ──
     ?cada=20 (minutos, 0 = apagado) · ?anunciar=1 lo dispara a los 8 s para probarlo. La voz es la del navegador (es-MX). */
  const ANUNCIAR_CADA = params.has('cada') ? Number(params.get('cada')) : 20;
  let announcing = false, lastSlot = null;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  function fadeDuck(to, ms) {
    return new Promise((resolve) => {
      const from = duck, t0 = performance.now();
      const id = setInterval(() => {
        const k = Math.min(1, (performance.now() - t0) / ms);
        duck = from + (to - from) * k; setMediaVolume();
        if (k >= 1) { clearInterval(id); resolve(); }
      }, 40);
    });
  }
  function playClip(src, maxMs) {
    return new Promise((resolve) => {
      const a = new Audio(src);
      a.volume = Math.max(0.4, Number(vol.value) / 100);
      a.addEventListener('ended', resolve); a.addEventListener('error', resolve);
      setTimeout(resolve, maxMs); /* por si nunca termina */
      a.play().catch(resolve);
    });
  }
  const playJingle = () => playClip('/assets/jingle.mp3', 40000);
  function pickVoice() {
    const vs = ('speechSynthesis' in window) ? speechSynthesis.getVoices() : [];
    return vs.find((v) => /^es[-_]MX/i.test(v.lang) && /natural|online/i.test(v.name)) || vs.find((v) => /^es[-_]MX/i.test(v.lang)) || vs.find((v) => /^es/i.test(v.lang)) || null;
  }
  function speak(text) {
    return new Promise((resolve) => {
      const v = pickVoice();
      if (!v) return resolve(); /* sin voz en español no se habla (en inglés sonaría mal) */
      const u = new SpeechSynthesisUtterance(text);
      u.voice = v; u.lang = v.lang; u.rate = 0.95; u.volume = Math.max(0.5, Number(vol.value) / 100);
      u.onend = u.onerror = () => resolve();
      setTimeout(resolve, 20000);
      speechSynthesis.speak(u);
    });
  }
  async function announce(ms, force = false) { /* force = lo pidió alguien desde /remote: suena aunque la música esté en pausa */
    if (announcing || (!force && (media.paused || media.muted))) return;
    announcing = true;
    try { await fadeDuck(0.12, 600); await playJingle(); await wait(250); await speak(U.spokenTime(ms)); }
    finally { await fadeDuck(1, 900); announcing = false; }
  }
  /* Anuncio programado: el servidor lo dispara por SSE a las pantallas ({ cmd:'anuncio', id }). El motor de /panel (oyente) no lo
     reproduce. Mismo ducking que el locutor y sin encimarse: si ya suena uno (o el locutor), el nuevo se descarta. Máx. 6 min. */
  async function anuncio(id) {
    if (LOCAL || announcing || typeof id !== 'string' || !/^[a-f0-9]{8}$/.test(id)) return;
    announcing = true;
    try { await fadeDuck(0.12, 600); await playClip(withT('/api/anuncio/' + id), 6 * 60 * 1000); }
    finally { await fadeDuck(1, 900); announcing = false; }
  }
  if ('speechSynthesis' in window) speechSynthesis.getVoices(); /* las voces cargan en segundo plano */
  if (VIEW === 'kiosco' && params.get('anunciar')) setTimeout(() => announce(Date.now() + timeOffset), 8000);

  const BG_H = 135; /* alto del lienzo de fondo: más alto = menos difuminado (96 era casi solo sombras) */
  const bgCanvas = $('bgCanvas');
  bgCanvas.height = BG_H; bgCanvas.width = Math.round(BG_H * 16 / 9 * ESTIRAR); /* mismo aspecto que el panel: el video no sale deformado */
  const bgCtx = bgCanvas.getContext('2d', { alpha: false });
  /* Dibuja el cuadro actual del video (o la carátula) en un lienzo chico (BG_H px de alto): el navegador lo escala a pantalla completa y queda suave. */
  function drawBg() {
    if (document.hidden) return;
    let src = null, sw = 0, sh = 0;
    if (state.mode === 'video' && vid.getAttribute('src') && vid.readyState >= 2 && vid.videoWidth) { src = vid; sw = vid.videoWidth; sh = vid.videoHeight; }
    else { const img = $('artImg'); if (img.complete && img.naturalWidth) { src = img; sw = img.naturalWidth; sh = img.naturalHeight; } }
    if (!src) return;
    const W = bgCanvas.width, H = bgCanvas.height;
    const k = Math.max(W / sw, H / sh);
    bgCtx.drawImage(src, (W - sw * k) / 2, (H - sh * k) / 2, sw * k, sh * k);
  }

  if (VIEW === 'kiosco') {
    syncTime().then(tickClock);
    setInterval(syncTime, 10 * 60 * 1000);
    setInterval(tickClock, 1000);
    setInterval(drawBg, 100);
  }

  /* ── dirección de la Pi en pantalla (para administrarla cuando cambia la IP) ── */
  let infoTimer = 0;
  function showInfo(ms) {
    $('info').hidden = false;
    clearTimeout(infoTimer);
    if (ms) infoTimer = setTimeout(() => { $('info').hidden = true; }, ms);
  }
  function toggleInfo() {
    if ($('info').hidden) showInfo(0);
    else { $('info').hidden = true; clearTimeout(infoTimer); }
  }
  async function loadInfo() {
    try {
      const h = await getJson('/api/health');
      const ips = h.ips && h.ips.length ? h.ips : [location.hostname];
      $('infoText').textContent = 'Control remoto: ' + ips.map((ip) => 'http://' + ip + ':' + (location.port || 80) + '/remote').join('  ·  ');
      showInfo(25000); /* tras un reinicio se ve la IP nueva unos segundos */
    } catch (_) { /* sin dato: no se muestra */ }
  }
  $('brand').addEventListener('click', toggleInfo);

  /* ── arranque ───────────────────────────────────────────────── */
  async function init() {
    vol.value = store.get('pl_vol', '80');
    applyVolume();
    /* ?mode=video|audio en la dirección manda (el kiosco se cierra a la fuerza y no siempre guarda el último modo). */
    const startMode = params.get('mode') || (VIEW === 'kiosco' ? 'video' : store.get('pl_mode', 'audio'));
    if (startMode === 'video') { state.mode = 'video'; setMode('video'); }
    try { state.genres = await getJson('/api/genres'); buildChips(); } catch (_) { /* el selector quedará vacío */ }
    connectEvents();
    if (!LOCAL) loadInfo();
    if (!state.current && !state.plan) advance(); /* si /panel ya mandó una orden mientras cargaban los géneros, no se pisa */
  }
  init();
})();
