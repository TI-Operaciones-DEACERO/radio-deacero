/* bienestar.js — vista Bienestar: elegir cómo te sientes, iniciar el viaje (5 fases), ver el avance, detenerlo y guardar un viaje favorito.
   Los datos del servidor se pintan SIEMPRE con textContent (Panel.h); el plan lo arma el servidor y el motor lo reproduce. */
(function () {
  'use strict';
  const P = window.Panel, h = P.h, L = P.L, A = P.api, store = P.store;
  const LS_USOS = 'pl_animos_usos', LS_FAV = 'pl_bienestar_fav', SS_PLAN = 'pl_viaje_plan';
  const POR_OMISION = ['estresado', 'agotado', 'enfocado', 'tranquilo', 'motivado', 'contento']; /* los 6 de la vista rápida mientras no haya historial */

  let raiz, pendiente = '', ops = null, plan = null, detenido = false, visto = false, ocupado = false, firmaFases = '', fav = null;
  const sel = { estado: '', texto: '', destino: '', intensidad: 'media', duracion: 'media', estilo: 'ninguno', idioma: '' };
  const els = {};

  const leerJson = (k) => { try { return JSON.parse(store.get(k) || 'null'); } catch (_) { return null; } };
  const usos = () => { const u = leerJson(LS_USOS); return u && typeof u === 'object' && !Array.isArray(u) ? u : {}; };
  const animoPorId = (id) => (ops ? ops.animos.find((a) => a.id === id) : null);
  const planGuardado = () => { try { const p = JSON.parse(sessionStorage.getItem(SS_PLAN) || 'null'); return p && Array.isArray(p.fases) && p.fases.length ? p : null; } catch (_) { return null; } };
  const guardarPlan = () => { try { if (plan) sessionStorage.setItem(SS_PLAN, JSON.stringify(plan)); else sessionStorage.removeItem(SS_PLAN); } catch (_) { /* sin sessionStorage */ } };

  /* ───────────── armado de la vista ───────────── */
  function montar(el) {
    raiz = el;
    el.classList.add('vista-int');
    els.cuerpo = h('div');
    el.append(
      (els.titulo = h('h2', { class: 'vt', text: 'Bienestar', tabindex: '-1' })), /* va dentro de Inicio (Radio), que ya tiene su h1 */
      (els.srFase = h('p', { class: 'sr-only', role: 'status' })), /* anuncia el cambio de fase; vive aquí para no recrearse */
      h('p', { class: 'hint', text: 'Cuéntanos cómo te sientes y armamos un viaje musical en 5 fases: empieza donde estás y te lleva poco a poco adonde quieres llegar.' }),
      els.cuerpo
    );
    P.on('state', alEstado);
    P.on('usuario', cargarFavorito);
    cargarOpciones();
  }

  async function cargarOpciones() {
    els.cuerpo.replaceChildren(h('p', { class: 'cargando', text: 'Cargando opciones…' }));
    const r = await A.bienestarOpciones();
    if (!r.ok || !r.data || !Array.isArray(r.data.animos)) {
      els.cuerpo.replaceChildren(h('div', { class: 'vacio' }, [
        h('p', { text: L.mensajeError(r.status) }),
        h('button', { type: 'button', class: 'primary', text: 'Reintentar', onclick: cargarOpciones })
      ]));
      return;
    }
    ops = r.data;
    construir();
    cargarFavorito();
    const g = planGuardado(); /* si se recargó la página con un viaje en marcha, se retoma */
    if (g) { plan = g; detenido = false; visto = false; pintarViaje(true); }
    if (pendiente) { const a = pendiente; pendiente = ''; iniciarAnimo(a); }
  }

  /* «Bienestar rápido» de Inicio: el ánimo queda elegido y el viaje arranca con los valores de siempre. */
  function iniciarAnimo(id) {
    if (!ops) { pendiente = id; return; }
    if (!animoPorId(id)) return;
    sel.estado = id; sel.texto = ''; if (els.texto) els.texto.value = '';
    marcarChips();
    iniciar(L.armarPeticionViaje(sel));
  }

  function construir() {
    els.rapido = h('div', { class: 'chips', role: 'group', 'aria-labelledby': 'bzRapidoT' });
    els.grupos = h('div');
    els.texto = h('input', { id: 'bzTexto', type: 'text', maxlength: '300', autocomplete: 'off', placeholder: 'Cuéntalo con tus palabras, por ejemplo: «ando muy cansado»' });
    els.texto.addEventListener('input', () => { sel.texto = els.texto.value; if (sel.texto.trim()) { sel.estado = ''; marcarChips(); } });
    els.texto.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); iniciar(L.armarPeticionViaje(sel)); } });

    els.iniciar = h('button', { type: 'button', class: 'primary', text: 'Iniciar viaje', onclick: () => iniciar(L.armarPeticionViaje(sel)) });
    els.guardarFav = h('button', { type: 'button', class: 'ghost', text: 'Guardar como favorito', onclick: guardarFavorito });
    els.favBtn = h('button', { type: 'button', class: 'ghost', hidden: true, onclick: () => iniciarFavorito() });
    els.estadoMsg = h('p', { class: 'hint', role: 'status' });

    els.pers = h('details', { class: 'pers' }, [
      h('summary', { text: 'Personalizar el viaje' }),
      h('div', { class: 'pers-grid' }, [
        campo('bzDestino', 'Adónde quieres llegar', 'destino', [['', 'Mantener mi ánimo']].concat(ops.destinos.map((d) => [d.id, d.label]))),
        campo('bzIntens', 'Intensidad del cambio', 'intensidad', ops.intensidades.map((d) => [d.id, d.label + ' (' + d.hint + ')'])),
        campo('bzDur', 'Duración', 'duracion', ops.duraciones.map((d) => [d.id, d.label + ' (' + d.hint + ')'])),
        campo('bzEstilo', 'Estilo musical', 'estilo', ops.estilos.map((d) => [d.id, d.label])),
        campo('bzIdioma', 'Idioma', 'idioma', [['', 'Cualquiera']].concat(ops.idiomas.map((d) => [d.id, d.label])))
      ])
    ]);

    els.viaje = h('section', { class: 'tarjeta', 'aria-labelledby': 'bzViajeT', hidden: true });

    const chipsPorGrupo = [];
    for (const g of Array.from(new Set(ops.animos.map((a) => a.grupo)))) {
      chipsPorGrupo.push(h('h3', { class: 'grupo', text: g }));
      chipsPorGrupo.push(h('div', { class: 'chips', role: 'group', 'aria-label': g }, ops.animos.filter((a) => a.grupo === g).map(chipAnimo)));
    }
    els.grupos.replaceChildren(...chipsPorGrupo);

    els.cuerpo.replaceChildren(
      h('section', { class: 'tarjeta', 'aria-labelledby': 'bzRapidoT' }, [
        h('h2', { id: 'bzRapidoT', text: '¿Cómo te sientes ahora?' }),
        h('p', { class: 'hint', text: 'Un toque y el viaje empieza, con los valores de siempre.' }),
        els.rapido
      ]),
      h('section', { class: 'tarjeta', 'aria-labelledby': 'bzElegirT' }, [
        h('h2', { id: 'bzElegirT', text: 'Elige tu ánimo' }),
        els.grupos,
        h('label', { for: 'bzTexto', text: '¿Cómo te sientes?' }),
        els.texto,
        els.pers,
        h('div', { class: 'row izq' }, [els.iniciar, els.guardarFav, els.favBtn]),
        els.estadoMsg
      ]),
      els.viaje
    );
    pintarRapido();
  }

  function campo(id, etiqueta, clave, opciones) {
    const s = h('select', { id, 'data-k': clave }, opciones.map(([v, t]) => h('option', { value: v, text: t })));
    s.value = sel[clave];
    s.addEventListener('change', () => { sel[clave] = s.value; });
    els['sel_' + clave] = s;
    return h('div', { class: 'campo' }, [h('label', { for: id, text: etiqueta }), s]);
  }

  function chipAnimo(a) {
    const b = h('button', { type: 'button', class: 'chip', 'aria-pressed': 'false', 'data-id': a.id });
    const e = h('span', { class: 'chip-e' });
    P.emo(e, a.emoji);
    b.append(e, h('span', { text: a.label }));
    b.addEventListener('click', () => {
      sel.estado = sel.estado === a.id ? '' : a.id;
      if (sel.estado) { sel.texto = ''; els.texto.value = ''; }
      marcarChips();
    });
    return b;
  }
  function marcarChips() {
    for (const b of els.grupos.querySelectorAll('.chip')) b.setAttribute('aria-pressed', String(b.dataset.id === sel.estado));
  }

  /* Vista rápida: los 6 ánimos que más se usan (o los de siempre). Un toque inicia con valores por defecto. */
  function pintarRapido() {
    const ids = L.topAnimos(usos(), POR_OMISION, ops.animos.map((a) => a.id), 6);
    els.rapido.replaceChildren(...ids.map((id) => {
      const a = animoPorId(id);
      const b = h('button', { type: 'button', class: 'chip grande' });
      const e = h('span', { class: 'chip-e' });
      P.emo(e, a.emoji);
      b.append(e, h('span', { text: a.label }));
      b.addEventListener('click', () => iniciar({ estado: a.id }));
      return b;
    }));
  }

  /* ───────────── iniciar / detener ───────────── */
  /* "Ocupado" con aria-disabled (no disabled): el botón conserva el foco del teclado mientras se arma el viaje. */
  function ocupar(si) {
    ocupado = si;
    for (const b of [els.iniciar, els.guardarFav, els.favBtn].concat(Array.from(els.rapido.querySelectorAll('button')))) {
      if (!b) continue;
      if (si) b.setAttribute('aria-disabled', 'true'); else b.removeAttribute('aria-disabled');
    }
  }

  /* Un solo mensaje por cosa: el de progreso/validación va en estadoMsg (zona status); los avisos puntuales, en el toast. */
  async function iniciar(req) {
    if (ocupado) return;
    if (!L.peticionValida(req)) { els.estadoMsg.textContent = 'Elige cómo te sientes o escríbelo con tus palabras.'; return; }
    els.estadoMsg.textContent = 'Armando tu viaje…';
    ocupar(true);
    const r = await A.bienestarIniciar(P.sid(), req);
    ocupar(false);
    els.estadoMsg.textContent = '';
    if (!r.ok || !r.data || !Array.isArray(r.data.fases)) { P.toastError(L.mensajeError(r.status)); return; }
    plan = r.data; detenido = false; visto = false; firmaFases = ''; firmaPlan = '';
    guardarPlan();
    if (plan.animo && plan.animo.id) { try { store.set(LS_USOS, JSON.stringify(L.sumarUso(usos(), plan.animo.id))); } catch (_) { /* sin almacenamiento */ } pintarRapido(); }
    pintarViaje(true);
    P.toast('Tu viaje empezó. Armando la primera canción…');
    els.viaje.scrollIntoView({ block: 'start' });
    P.send({ cmd: 'random' }); /* con el viaje activo en el servidor, "otra canción" ya viene de la fase 1 */
  }

  async function detener() {
    if (ocupado) return;
    ocupado = true;
    const b = els.detener;
    if (b) b.setAttribute('aria-disabled', 'true');
    const r = await A.bienestarDetener(P.sid());
    ocupado = false;
    if (b) b.removeAttribute('aria-disabled');
    if (!r.ok && r.status !== 404) { P.toastError(L.mensajeError(r.status)); return; }
    cerrarViaje('Detuviste el viaje. Lo que ya estaba en cola termina y después sigue la radio normal.');
  }
  function cerrarViaje(mensaje) {
    const tenia = els.viaje && els.viaje.contains(document.activeElement);
    plan = null; detenido = true; visto = false; firmaFases = ''; firmaPlan = ''; vv = null;
    guardarPlan();
    els.viaje.hidden = true;
    els.viaje.replaceChildren();
    els.srFase.textContent = '';
    if (tenia) els.titulo.focus(); /* el botón Detener desaparece: el foco pasa al título de la vista */
    if (mensaje) P.toast(mensaje);
  }

  /* ───────────── avance del viaje ───────────── */
  function alEstado(s) {
    if (!ops) return;
    if (!plan && !detenido && s && s.viaje) { const g = planGuardado(); if (g) { plan = g; visto = false; } }
    if (!plan) return;
    if (s && s.viaje) visto = true;
    else if (visto && s && s.track) { cerrarViaje('El viaje terminó porque elegiste otra música.'); return; }
    if (P.pestana() === 'bienestar') pintarViaje(false);
  }

  /* La estructura del viaje se arma UNA vez por plan; después solo se actualizan textos y marcas (no se reconstruye con cada canción). */
  let firmaPlan = '', vv = null;
  function construirViaje() {
    const animo = plan.animo || {};
    const e = h('span', { class: 'chip-e' });
    P.emo(e, animo.emoji);
    const cab = h('div', { class: 'viaje-cab' }, [e, h('h2', { id: 'bzViajeT', text: 'Tu viaje' + (animo.label ? ': ' + animo.label : '') + (plan.destino ? ' → ' + plan.destino.label : '') })]);
    if (!els.detener) els.detener = h('button', { type: 'button', class: 'ghost', text: 'Detener viaje', onclick: detener });
    const progreso = h('p', { class: 'progreso' });
    const cierre = h('div', { class: 'cierre', hidden: true }, [h('h3', { text: 'Llegaste a tu destino' }), h('p', { text: plan.cierre || '' }), h('p', { class: 'hint', text: 'La música continúa en esta energía mientras quieras.' })]);
    const items = plan.fases.map((f, i) => faseItem(f, i));
    const hijos = [cab, h('p', { text: plan.analisis || '' }), progreso];
    if (Array.isArray(plan.avisos) && plan.avisos.length) hijos.push(h('ul', { class: 'avisos' }, plan.avisos.map((a) => h('li', { text: String(a) }))));
    hijos.push(h('ol', { class: 'fases' }, items.map((x) => x.li)), cierre, h('div', { class: 'row izq' }, [els.detener]));
    els.viaje.replaceChildren(...hijos);
    vv = { progreso, items, cierre };
  }

  function pintarViaje() {
    if (!plan || !els.viaje) return;
    const planId = [plan.analisis, plan.fases.length, plan.animo && plan.animo.id].join('|');
    if (!vv || planId !== firmaPlan) { firmaPlan = planId; firmaFases = ''; construirViaje(); }
    els.viaje.hidden = false;
    const s = P.estado();
    const ev = L.estadoViaje(plan, s && s.viaje);
    const car = ev.activo && !ev.terminado ? P.R.etiquetaCaracter(plan.fases[ev.faseIdx] && plan.fases[ev.faseIdx].caracter) : '';
    vv.progreso.textContent = ev.activo ? L.resumenFase(ev) + (car ? ' · Música: ' + car : '') : 'Preparando la primera canción…';
    vv.items.forEach((x, i) => {
      const actual = ev.activo && !ev.terminado && i === ev.faseIdx;
      const hecha = ev.activo && (ev.terminado || i < ev.faseIdx);
      x.li.className = 'fase' + (actual ? ' actual' : '') + (hecha ? ' hecha' : '');
      if (actual) x.li.setAttribute('aria-current', 'step'); else x.li.removeAttribute('aria-current');
      x.estado.textContent = actual ? 'En curso' : hecha ? 'Lista' : 'Pendiente';
    });
    vv.cierre.hidden = !ev.terminado;
    /* Se anuncia solo el cambio de FASE (o el cierre), no cada tema */
    const firma = [ev.activo, ev.faseIdx, ev.terminado].join('|');
    if (firma !== firmaFases) {
      firmaFases = firma;
      if (ev.activo) els.srFase.textContent = ev.terminado ? 'Viaje completo: la música continúa en esta energía.' : 'Fase ' + (ev.faseIdx + 1) + ' de ' + ev.total + ': ' + ev.nombre + (car ? ', música: ' + car : '') + '.';
    }
  }

  /* Carácter musical de la fase (Calma, Concentración, Buen ánimo…): la música va de la mano con el ánimo. */
  function caracterEl(id) {
    const t = P.R.etiquetaCaracter(id);
    return t ? h('span', { class: 'caracter', text: 'Música: ' + t }) : null;
  }

  function faseItem(f, i) {
    const estado = h('span', { class: 'fase-estado', text: 'Pendiente' });
    const li = h('li', { class: 'fase' });
    li.append(
      h('div', { class: 'fase-cab' }, [
        h('span', { class: 'fase-n', 'aria-hidden': 'true', text: String(i + 1) }),
        h('strong', { text: 'Fase ' + (i + 1) + ': ' + f.nombre }),
        caracterEl(f.caracter),
        estado
      ]),
      h('div', { class: 'energia' }, [
        h('span', { class: 'barra', 'aria-hidden': 'true' }, h('i', { style: 'width:' + L.energiaAncho(f.energia) })),
        h('span', { class: 'energia-t', text: 'Energía ' + L.energiaTexto(f.energia) })
      ])
    );
    if (Array.isArray(f.generos) && f.generos.length) {
      li.append(h('ul', { class: 'gens', 'aria-label': 'Géneros de la fase ' + (i + 1) }, f.generos.map((g) => {
        const em = h('span', { class: 'chip-e' });
        P.emo(em, g.emoji);
        return h('li', {}, [em, h('span', { text: g.label })]);
      })));
    }
    return { li, estado };
  }

  /* ───────────── viaje favorito ───────────── */
  const valido = (lista, v) => lista.some((x) => x.id === v);
  function limpiarFav(c) { /* solo texto y solo ids que existen */
    const r = L.armarPeticionViaje(c && typeof c === 'object' ? c : {});
    if (r.estado && !valido(ops.animos, r.estado)) delete r.estado;
    if (r.destino && !valido(ops.destinos, r.destino)) delete r.destino;
    if (r.intensidad && !valido(ops.intensidades, r.intensidad)) delete r.intensidad;
    if (r.duracion && !valido(ops.duraciones, r.duracion)) delete r.duracion;
    if (r.estilo && !valido(ops.estilos, r.estilo)) delete r.estilo;
    if (r.idioma && !valido(ops.idiomas, r.idioma)) delete r.idioma;
    return L.peticionValida(r) ? r : null;
  }
  function pintarFav() {
    if (!els.favBtn) return;
    els.favBtn.hidden = !fav;
    if (fav) {
      const a = fav.estado ? animoPorId(fav.estado) : null;
      els.favBtn.textContent = 'Iniciar mi viaje favorito' + (a ? ' (' + a.label + ')' : fav.texto ? ' («' + fav.texto.slice(0, 24) + '»)' : '');
    }
  }
  async function cargarFavorito() {
    if (!ops) return;
    fav = limpiarFav(leerJson(LS_FAV));
    pintarFav();
    if (!P.usuario()) return;
    const r = await A.prefs();
    const del = r.ok && r.data && r.data.bienestar && limpiarFav(r.data.bienestar.favorito);
    if (del) { fav = del; store.set(LS_FAV, JSON.stringify(del)); pintarFav(); }
  }
  async function guardarFavorito() {
    if (ocupado) return;
    const req = L.armarPeticionViaje(sel);
    if (!L.peticionValida(req)) { P.toast('Primero elige cómo te sientes o escríbelo.'); return; }
    fav = req;
    store.set(LS_FAV, JSON.stringify(req));
    pintarFav();
    if (!P.usuario()) { P.toast('Guardado como favorito en este navegador. Si entras con tu nómina, también se guarda en tu cuenta.'); return; }
    const r = await A.guardarPrefs({ bienestar: { favorito: req } });
    P.toast(r.ok ? 'Guardado como tu viaje favorito.' : 'Se guardó en este navegador, pero no se pudo guardar en tu cuenta.');
  }
  function iniciarFavorito() { if (fav) iniciar(fav); }

  P.vistas.bienestar = {
    montar,
    mostrar() { if (plan) pintarViaje(true); },
    iniciarAnimo,
    enfocar() { if (els.titulo) els.titulo.focus(); }
  };
})();
