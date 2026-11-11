/* api.js — llamadas al servidor desde el panel nuevo. Un solo lugar: todas devuelven { ok, status, data }. */
(function () {
  'use strict';

  /* Clave de administración (REMOTE_TOKEN): viaja SOLO en las llamadas de administración, por cabecera x-token (nunca en la URL).
     Se toma de ?t= (y se quita de la dirección para que no quede en el historial ni en capturas), de la guardada para el panel
     ('pl_admin_t') o de la del control remoto ('pl_token'). */
  /* La clave de administración vive solo en esta pestaña (sessionStorage): en un equipo compartido no sobrevive al cerrar el navegador. */
  const LS_CLAVE = 'pl_admin_t';
  const leer = (k) => { try { return sessionStorage.getItem(k) || ''; } catch (_) { return ''; } };
  const leerRemoto = () => { try { return localStorage.getItem('pl_token') || ''; } catch (_) { return ''; } }; /* la que ya guardó /remote */
  let clave = '';
  try {
    const u = new URL(location.href);
    const t = u.searchParams.get('t');
    if (t) {
      clave = t.trim().slice(0, 200);
      try { sessionStorage.setItem(LS_CLAVE, clave); } catch (_) { /* modo privado: vale solo esta visita */ }
      u.searchParams.delete('t');
      history.replaceState(null, '', u.pathname + u.search + u.hash);
    }
  } catch (_) { /* sin URL/history */ }
  if (!clave) clave = leer(LS_CLAVE) || leerRemoto();
  try { localStorage.removeItem(LS_CLAVE); } catch (_) { /* limpia la copia persistente de versiones anteriores */ }

  async function call(method, url, body, admin) {
    try {
      const headers = {};
      if (body !== undefined) headers['content-type'] = 'application/json';
      if (admin && clave) headers['x-token'] = clave;
      const r = await fetch(url, {
        method,
        credentials: 'same-origin',
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined
      });
      let data = null;
      try { data = await r.json(); } catch (_) { /* 204 o sin cuerpo */ }
      return { ok: r.ok, status: r.status, data };
    } catch (_) {
      return { ok: false, status: 0, data: { error: 'SIN_CONEXION' } };
    }
  }
  const e = encodeURIComponent;
  const adm = (method, url, body) => call(method, url, body, true);
  window.PlayApi = {
    me: () => call('GET', '/api/auth/me'),
    login: (nomina, nombre) => call('POST', '/api/auth/login', { nomina, nombre }),
    logout: () => call('POST', '/api/auth/logout', {}),
    perfil: (nombre) => call('POST', '/api/auth/profile', { nombre }),

    /* biblioteca de la cuenta (401 sin sesión) */
    reacciones: () => call('GET', '/api/me/reactions'),
    reaccionar: (track, r) => call('POST', '/api/me/reactions', { track, r }),
    fusionarReacciones: (items) => call('POST', '/api/me/reactions/merge', { items }),
    playlists: () => call('GET', '/api/me/playlists'),
    crearPlaylist: (name) => call('POST', '/api/me/playlists', { name }),
    playlist: (id) => call('GET', '/api/me/playlists/' + e(id)),
    renombrarPlaylist: (id, name) => call('PATCH', '/api/me/playlists/' + e(id), { name }),
    borrarPlaylist: (id) => call('DELETE', '/api/me/playlists/' + e(id)),
    agregarAPlaylist: (id, track) => call('POST', '/api/me/playlists/' + e(id) + '/tracks', { track }),
    quitarDePlaylist: (id, trackId) => call('DELETE', '/api/me/playlists/' + e(id) + '/tracks/' + e(trackId)),
    historial: (limit) => call('GET', '/api/me/history' + (limit ? '?limit=' + e(limit) : '')),
    registrarHistorial: (track) => call('POST', '/api/me/history', { track }),
    borrarHistorial: () => call('DELETE', '/api/me/history'),
    prefs: () => call('GET', '/api/me/prefs'),
    guardarPrefs: (prefs) => call('POST', '/api/me/prefs', prefs),

    /* IA (abierta, sin cuenta) */
    iaAhora: () => call('GET', '/api/ia/ahora'),
    iaPodcasts: () => call('GET', '/api/ia/podcasts'),
    podcastEpisodios: (q) => call('GET', '/api/podcast/search?q=' + e(q)),
    iaParaTi: (sid) => call('GET', '/api/ia/para-ti?sid=' + e(sid)),
    iaDescubrir: (sid, prefer, avoid) => call('GET', '/api/ia/descubrir?sid=' + e(sid) + (prefer && prefer.length ? '&prefer=' + e(prefer.join(',')) : '') + (avoid && avoid.length ? '&avoid=' + e(avoid.join(',')) : '')),
    iaPlaylist: (q) => call('GET', '/api/ia/playlist?q=' + e(q)),

    /* Bienestar */
    bienestarOpciones: () => call('GET', '/api/bienestar/opciones'),
    bienestarIniciar: (sid, req) => call('POST', '/api/bienestar/viaje?sid=' + e(sid), req),
    bienestarDetener: (sid) => call('DELETE', '/api/bienestar/viaje?sid=' + e(sid)),

    /* Resolver una consulta a una canción concreta (para guardar una playlist de IA); es una búsqueda suelta: no mueve la racha de la radio. */
    resolverConsulta: (sid, q) => call('GET', '/api/next?sid=' + e(sid) + '&q=' + e(q)),

    /* Fase 5 (oyente: buscar y letras exigen el id de sesión) */
    generos: () => call('GET', '/api/genres'),
    buscar: (sid, q) => call('GET', '/api/buscar?q=' + e(q) + '&sid=' + e(sid)),
    letra: (sid, t) => call('GET', '/api/lyrics?title=' + e(t.title || '') + '&channel=' + e(t.channel || '') + '&duration=' + e(String(t.duration || 0)) + '&sid=' + e(sid)),

    /* Fase 6: administración (cabecera x-token, o la propia máquina sin clave) */
    clave: {
      hay: () => !!clave,
      poner(v) { clave = String(v || '').trim().slice(0, 200); try { if (clave) sessionStorage.setItem(LS_CLAVE, clave); else sessionStorage.removeItem(LS_CLAVE); } catch (_) { /* modo privado */ } },
      olvidar() { clave = ''; try { sessionStorage.removeItem(LS_CLAVE); } catch (_) { /* modo privado */ } }
    },
    adminEstado: () => adm('GET', '/api/admin/estado'),
    horario: () => adm('GET', '/api/admin/horario'),
    guardarHorario: (h) => adm('PUT', '/api/admin/horario', h),
    generarSemana: (jornada) => adm('POST', '/api/admin/horario/generar', jornada ? { jornada } : {}),
    horarioAhora: () => adm('GET', '/api/admin/horario/ahora'),
    anuncios: () => adm('GET', '/api/admin/anuncios'),
    crearAnuncio: (a) => adm('POST', '/api/admin/anuncios', a),
    editarAnuncio: (id, cambios) => adm('PATCH', '/api/admin/anuncios/' + e(id), cambios),
    borrarAnuncio: (id) => adm('DELETE', '/api/admin/anuncios/' + e(id)),
    probarAnuncio: (id) => adm('POST', '/api/admin/anuncios/' + e(id) + '/probar', {}),
    ajustes: () => adm('GET', '/api/admin/ajustes'),
    guardarAjustes: (a) => adm('PUT', '/api/admin/ajustes', a),
    usuarios: () => adm('GET', '/api/admin/usuarios'),
    estadoUsuario: (id, estado) => adm('PATCH', '/api/admin/usuarios/' + e(id), { estado }),
    diagnostico: () => adm('GET', '/api/admin/diagnostico')
  };

  /* Sin nómina, historial y playlists van a ESTE navegador (misma forma de respuesta). nucleo.js avisa con usarCuenta(true/false). */
  const B = window.PlayBibliotecaLocal;
  if (B) {
    const ls = {
      get: (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } },
      set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* sin almacenamiento */ } },
      del: (k) => { try { localStorage.removeItem(k); } catch (_) { /* sin almacenamiento */ } }
    };
    const local = B.createBibliotecaLocal({ store: ls });
    const A = window.PlayApi;
    let cuenta = false;
    for (const k of ['historial', 'registrarHistorial', 'borrarHistorial', 'playlists', 'playlist', 'crearPlaylist', 'renombrarPlaylist', 'borrarPlaylist', 'agregarAPlaylist', 'quitarDePlaylist']) {
      const remoto = A[k];
      A[k] = (...a) => (cuenta ? remoto(...a) : local[k](...a));
    }
    A.usarCuenta = (si) => { cuenta = !!si; };
    A.enCuenta = () => cuenta;
  }
})();
