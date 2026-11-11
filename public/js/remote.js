/* remote.js — control remoto: manda órdenes a la pantalla y muestra lo que está sonando. */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const U = window.Util;
  const params = new URLSearchParams(location.search);
  const store = {
    get(k) { try { return localStorage.getItem(k) || ''; } catch (_) { return ''; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* modo privado */ } }
  };

  let token = params.get('t') || store.get('pl_token');
  if (params.get('t')) { store.set('pl_token', token); history.replaceState(null, '', location.pathname); }
  const withT = (u) => (token ? u + (u.includes('?') ? '&' : '?') + 't=' + encodeURIComponent(token) : u);

  let toastTimer = 0;
  function toast(msg, ms) {
    const t = $('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms || 2500);
  }

  function askToken() {
    const t = window.prompt('Clave de acceso para controlar la pantalla:');
    if (t) { store.set('pl_token', t.trim()); location.reload(); }
  }

  /* /panel = este mismo panel, pero la música suena en ESTE navegador: el reproductor (app.js con ?view=local) corre en un
     iframe invisible y las órdenes van directo a él, no a /api/cmd (que las reparte a todas las pantallas). */
  const LOCAL = /^\/panel(\/simple)?\/?$/.test(location.pathname); /* /panel/simple = este panel cuando /panel es el panel completo (Fase 8) */
  if (LOCAL) document.getElementById('aCompleto').hidden = false; /* de regreso al panel completo */
  let engine = null;
  const player = () => (engine && engine.contentWindow && engine.contentWindow.__player) || null;
  if (LOCAL) {
    document.body.classList.add('local');
    if (!token) document.body.classList.add('anon'); /* sin clave: se ocultan las funciones que la necesitan (guardar podcasts, Equipos) */
    document.title = 'DEACERO Play';
    /* Id de sesión: por pestaña (sobrevive a recargar). El servidor lleva una racha aparte para cada id. */
    let sid = '';
    try { sid = sessionStorage.getItem('pl_sid') || ''; } catch (_) { /* sin sessionStorage */ }
    if (!/^[A-Za-z0-9_-]{8,40}$/.test(sid)) {
      const b = crypto.getRandomValues(new Uint8Array(12));
      sid = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
      try { sessionStorage.setItem('pl_sid', sid); } catch (_) { /* sin sessionStorage */ }
    }
    engine = document.createElement('iframe');
    engine.className = 'engine'; engine.title = 'Reproductor'; engine.setAttribute('allow', 'autoplay');
    engine.src = withT('/?view=local&mode=audio&sid=' + sid);
    document.body.appendChild(engine);
    addEventListener('message', (e) => {
      if (e.origin === location.origin && e.source === engine.contentWindow && e.data && e.data.type === 'toast') toast(e.data.msg, e.data.ms);
    });
  }

  async function call(path, opts) {
    const r = await fetch(path, { ...opts, headers: {
      'content-type': 'application/json',
      'x-client-time': String(Date.now()), /* la hora real: la de la Pi puede estar atrasada */
      ...(token ? { 'x-token': token } : {})
    } });
    if (r.status === 401) { if (LOCAL) toast('Esa función necesita la clave del control'); else askToken(); throw new Error('401'); } /* /panel nunca pide clave */
    return r;
  }

  async function send(cmd) {
    if (LOCAL) {
      const p = player();
      if (!p) { toast('El reproductor está cargando…'); return false; }
      p.handleCommand(cmd);
      setTimeout(refresh, 300);
      return true;
    }
    try {
      const r = await call('/api/cmd', { method: 'POST', body: JSON.stringify(cmd) });
      if (r.status === 409) toast('No hay ninguna pantalla abierta');
      else if (!r.ok) toast('No se pudo enviar (' + r.status + ')');
      else setTimeout(refresh, 600);
      return r.ok;
    } catch (_) { return false; }
  }

  /* ── estado ─────────────────────────────────────────────────── */
  let dragging = false;
  let lastThumb = '';
  const vol = $('vol');
  const setRange = (el, pct) => el.style.setProperty('--p', pct + '%');

  function render(s) {
    const live = s.players > 0;
    $('conn').textContent = LOCAL ? 'Suena en este equipo' : live ? (s.players === 1 ? 'Pantalla conectada' : s.players + ' pantallas') : 'Sin pantalla';
    $('conn').className = 'conn ' + (live ? 'ok' : 'bad');
    $('startLocal').hidden = !(LOCAL && s.blocked);

    const t = s.track;
    $('title').textContent = t ? t.title : 'Sin reproducción';
    $('channel').innerHTML = '&nbsp;';
    if (t && t.channel) $('channel').textContent = t.channel;
    $('time').textContent = t ? U.fmtTime(s.time) + ' / ' + U.fmtTime(t.duration) + (s.paused ? ' · en pausa' : '') : '';
    curGenre = s.genre && s.genre.id ? s.genre.id : '';
    markGenre();
    const gen = $('genre');
    if (s.genre) { U.setEmoji(gen, s.genre.emoji); gen.append(' ' + s.genre.label); } else gen.textContent = '—';

    const src = t && t.id ? withT('/api/thumb/' + t.id) : '';
    if (src !== lastThumb) { lastThumb = src; if (src) $('thumb').src = src; else $('thumb').removeAttribute('src'); }

    $('toggleIco').firstElementChild.setAttribute('href', s.paused ? '#i-play' : '#i-pause');
    $('modeIco').firstElementChild.setAttribute('href', s.mode === 'video' ? '#i-music' : '#i-video');
    $('modeLbl').textContent = s.mode === 'video' ? 'Solo audio' : 'Video';
    $('muteIco').firstElementChild.setAttribute('href', s.muted ? '#i-mute' : '#i-vol');
    if (!dragging && Number.isFinite(s.volume)) { vol.value = s.volume; setRange(vol, s.volume); }
  }

  async function refresh() {
    if (LOCAL) { const p = player(); if (p) render(p.getState()); return; }
    try { render(await (await call('/api/state')).json()); }
    catch (_) { $('conn').textContent = 'Sin conexión'; $('conn').className = 'conn bad'; }
  }

  /* ── botones ────────────────────────────────────────────────── */
  $('startLocal').addEventListener('click', () => send({ cmd: 'play' }));
  $('prev').addEventListener('click', () => send({ cmd: 'prev' }));
  $('next').addEventListener('click', () => send({ cmd: 'next' }));
  $('toggle').addEventListener('click', () => send({ cmd: 'toggle' }));
  $('mute').addEventListener('click', () => send({ cmd: 'mute' }));
  $('random').addEventListener('click', () => send({ cmd: 'random' }));
  $('lyrics').addEventListener('click', () => send({ cmd: 'lyrics' }));
  $('announce').addEventListener('click', () => { send({ cmd: 'announce' }); toast('Anunciando…'); });
  $('mode').addEventListener('click', () => send({ cmd: 'mode', mode: $('modeLbl').textContent === 'Video' ? 'video' : 'audio' }));

  vol.addEventListener('pointerdown', () => { dragging = true; });
  vol.addEventListener('input', () => setRange(vol, vol.value));
  vol.addEventListener('change', () => { dragging = false; send({ cmd: 'volume', set: Number(vol.value) }); });

  /* ── pestañas ───────────────────────────────────────────────── */
  function showTab(name) {
    for (const b of document.querySelectorAll('.tab')) {
      const on = b.dataset.tab === name;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    }
    $('panelMusic').hidden = name !== 'music';
    $('panelPods').hidden = name !== 'podcasts';
    $('panelDevs').hidden = name !== 'devices';
    store.set('pl_tab', name);
    if (name === 'podcasts') loadSaved();
    if (name === 'devices') loadDevices();
  }
  $('tabMusic').addEventListener('click', () => showTab('music'));
  $('tabPods').addEventListener('click', () => showTab('podcasts'));
  $('tabDevs').addEventListener('click', () => showTab('devices'));

  /* ── música: canción o artista (una vez) y géneros ──────────── */
  const q = $('q');
  $('goSong').addEventListener('click', () => {
    const v = q.value.trim();
    if (!v) { toast('Escribe una canción o artista'); return; }
    send({ cmd: 'search', q: v });
    toast('Buscando "' + v + '"…', 4000);
  });
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('goSong').click(); });

  function chip(emoji, label) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip';
    const e = document.createElement('span'); e.className = 'e'; U.setEmoji(e, emoji || '🎵');
    const l = document.createElement('span'); l.className = 'l'; l.textContent = label;
    b.append(e, l);
    return b;
  }

  /* ── géneros: lista completa con filtro en vivo; tocar uno lo elige ── */
  const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const genreList = $('genreList');
  let curGenre = '';

  function markGenre() { for (const el of genreList.children) el.classList.toggle('on', el.dataset.id === curGenre); }

  function filterGenres() {
    const t = fold($('genreQ').value).trim();
    let shown = 0;
    for (const el of genreList.children) { el.hidden = !!t && !el.dataset.q.includes(t); if (!el.hidden) shown++; }
    $('genreCount').textContent = '(' + shown + ')';
  }

  async function loadGenres() {
    let list;
    try { list = await (await call('/api/genres')).json(); } catch (_) { return; }
    list.sort((a, b) => (Number(b.featured) - Number(a.featured)) || a.label.localeCompare(b.label, 'es'));
    const frag = document.createDocumentFragment();
    for (const g of list) {
      const b = chip(g.emoji, g.label);
      b.dataset.id = g.id; b.dataset.q = fold(g.label + ' ' + g.id);
      b.addEventListener('click', () => { send({ cmd: 'genre', id: g.id }); toast('Cambiando a ' + g.label + '…'); });
      frag.appendChild(b);
    }
    genreList.replaceChildren(frag);
    markGenre();
    filterGenres();
  }
  $('genreQ').addEventListener('input', filterGenres);

  /* ── podcasts ───────────────────────────────────────────────── */
  const podQ = $('podQ');

  async function loadSaved() {
    const box = $('podSaved');
    try {
      const list = await (await call('/api/podcasts')).json();
      box.replaceChildren();
      if (!list.length) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = 'Aún no hay podcasts guardados. Busca uno y pulsa «Guardar podcast».'; box.appendChild(p); return; }
      for (const pod of list) {
        const row = document.createElement('div'); row.className = 'pod';
        const open = chip('🎙️', pod.name);
        open.addEventListener('click', () => { podQ.value = pod.q; showEpisodes(pod.q); });
        const del = document.createElement('button');
        del.type = 'button'; del.className = 'del'; del.textContent = '✕';
        del.setAttribute('aria-label', 'Quitar ' + pod.name);
        del.addEventListener('click', async () => {
          if (!window.confirm('¿Quitar "' + pod.name + '" de tus podcasts?')) return;
          try { await call('/api/podcasts/' + pod.id, { method: 'DELETE' }); toast('Quitado'); loadSaved(); } catch (_) { /* ya avisado */ }
        });
        row.append(open, del);
        box.appendChild(row);
      }
    } catch (_) { /* ya avisado */ }
  }

  async function showEpisodes(text) {
    const box = $('podResults');
    box.replaceChildren();
    text = (text || '').trim();
    if (!text) { toast('Escribe el nombre del podcast'); return; }
    const wait = document.createElement('p'); wait.className = 'hint'; wait.textContent = 'Buscando episodios…';
    box.appendChild(wait);
    try {
      const r = await call('/api/podcast/search?q=' + encodeURIComponent(text));
      box.replaceChildren();
      if (!r.ok) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = r.status === 503 ? 'No hay conexión con YouTube ahora mismo.' : 'No se pudo buscar.'; box.appendChild(p); return; }
      const eps = await r.json();
      if (!eps.length) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = 'No encontré episodios (se buscan de 5 min a 4 h).'; box.appendChild(p); return; }
      for (const ep of eps) {
        const row = document.createElement('div'); row.className = 'ep';
        const info = document.createElement('div'); info.className = 'ep-info';
        const title = document.createElement('div'); title.className = 'ep-title'; title.textContent = ep.title;
        const meta = document.createElement('div'); meta.className = 'ep-meta'; meta.textContent = [ep.channel, U.fmtTime(ep.duration)].filter(Boolean).join(' · ');
        info.append(title, meta);
        const play = document.createElement('button');
        play.type = 'button'; play.className = 'btn';
        play.setAttribute('aria-label', 'Tocar ' + ep.title);
        play.innerHTML = '<svg><use href="#i-play"/></svg>';
        play.addEventListener('click', async () => {
          if (await send({ cmd: 'track', kind: 'podcast', track: { id: ep.id, title: ep.title, channel: ep.channel, duration: ep.duration } })) toast(LOCAL ? 'Reproduciendo…' : 'Enviado a la pantalla');
        });
        row.append(info, play);
        box.appendChild(row);
      }
    } catch (_) { box.replaceChildren(); }
  }

  $('podGo').addEventListener('click', () => showEpisodes(podQ.value));
  podQ.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('podGo').click(); });
  $('podSave').addEventListener('click', async () => {
    const text = podQ.value.trim();
    if (!text) { toast('Escribe el nombre del podcast'); return; }
    try {
      const r = await call('/api/podcasts', { method: 'POST', body: JSON.stringify({ name: text, q: text }) });
      toast(r.status === 201 ? 'Podcast guardado' : r.status === 200 ? 'Ya estaba guardado' : 'No se pudo guardar');
      loadSaved();
    } catch (_) { /* ya avisado */ }
  });

  /* ── equipos conectados ─────────────────────────────────────── */
  const CMD_ES = {
    next: 'Siguiente', prev: 'Anterior', toggle: 'Pausa / play', play: 'Play', pause: 'Pausa', random: 'Otro género', genre: 'Fijar género',
    search: 'Buscar canción', track: 'Tocar episodio/canción', volume: 'Volumen', mute: 'Silenciar', mode: 'Audio / video', lyrics: 'Letra', announce: 'Anuncio'
  };
  function ago(sec) {
    if (sec < 60) return sec + ' s';
    if (sec < 3600) return Math.floor(sec / 60) + ' min';
    return Math.floor(sec / 3600) + ' h';
  }

  function devCard(o) {
    const el = document.createElement('div');
    el.className = 'dev' + (o.on ? ' on' : '');
    const dot = document.createElement('span'); dot.className = 'dot';
    const main = document.createElement('div'); main.className = 'dev-main';

    let title, sub;
    if (o.host === 'esta Pi') { title = o.user || 'esta Pi'; sub = o.user ? 'esta Pi' : 'el propio equipo'; }
    else if (o.user) { title = o.user; sub = [o.host, o.ip].filter(Boolean).join(' · '); }
    else if (o.host) { title = o.host; sub = o.ip; }
    else { title = o.ip; sub = ''; }

    const name = document.createElement('div'); name.className = 'dev-name';
    name.append(title);
    if (sub) { const s = document.createElement('span'); s.className = 'dev-ip'; s.textContent = '  ' + sub; name.appendChild(s); }
    if (o.you) { const y = document.createElement('span'); y.className = 'dev-you'; y.textContent = 'TÚ'; name.appendChild(y); }
    const meta = document.createElement('div'); meta.className = 'dev-meta'; meta.textContent = o.meta;
    main.append(name, meta);
    el.append(dot, main);
    return el;
  }

  async function loadDevices() {
    try {
      const j = await (await call('/api/clients')).json();
      const sc = $('devScreens'); const co = $('devControls');
      sc.replaceChildren(); co.replaceChildren();
      $('devScreensH').textContent = 'Pantallas (' + j.screens.length + ')';
      $('devControlsH').textContent = 'Controles (' + j.controllers.filter((c) => c.online).length + ' activos)';
      if (!j.screens.length) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = 'Ninguna pantalla conectada.'; sc.appendChild(p); }
      for (const s of j.screens) sc.appendChild(devCard({ ...s, on: true, meta: s.agent + ' · conectada hace ' + ago(s.seconds) }));
      if (!j.controllers.length) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = 'Nadie ha usado el control en los últimos 10 min.'; co.appendChild(p); }
      for (const c of j.controllers) {
        const last = c.lastCmd ? ' · última orden: ' + (CMD_ES[c.lastCmd] || c.lastCmd) + ' hace ' + ago(c.lastCmdAgo) : '';
        const how = c.via === 'terminal' ? 'terminal' : 'web';
        co.appendChild(devCard({ ...c, on: c.online, you: c.ip === j.you.ip && c.agent === j.you.agent,
          meta: c.agent + ' (' + how + ') · ' + (c.online ? 'activo' : 'visto hace ' + ago(c.seenAgo)) + last }));
      }
    } catch (_) { /* ya avisado */ }
  }
  setInterval(() => { if (!$('panelDevs').hidden) loadDevices(); }, 3000);

  { const t = store.get('pl_tab'); showTab(['podcasts', 'devices'].includes(t) && !(t === 'devices' && document.body.classList.contains('anon')) ? t : 'music'); }
  loadGenres();
  refresh();
  setInterval(refresh, LOCAL ? 1000 : 2000);
})();
