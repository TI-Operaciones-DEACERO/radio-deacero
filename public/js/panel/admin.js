/* admin.js — pestaña Administración (solo aparece si GET /api/admin/estado da 200: la propia máquina o con la clave por x-token).
   Horario del radio principal (pantallas), Anuncios programados, Ajustes (filtro explícito), Usuarios (activar/desactivar; las cuentas
   NO se borran) y Diagnóstico. Todo dato del servidor se pinta con textContent (Panel.h). La validación de admin-logica.js solo avisa
   antes de guardar: el servidor vuelve a validar. */
(function () {
  'use strict';
  const P = window.Panel, h = P.h, A = P.api, AL = window.AdminLogica, L = P.L;
  const els = {};
  let activa = 'horario';
  let generos = null; /* [{ id, label, emoji }] de /api/genres */
  const MOOD_TXT = { calm: 'Calma', focus: 'Concentración', uplift: 'Ánimo', energy: 'Energía', winddown: 'Bajar el ritmo' };
  const MODO_TXT = {
    rotacion: ['Rotación', 'Como siempre: géneros al azar todo el día.'],
    horario: ['Horario', 'Sigue los bloques de abajo; fuera de ellos, rotación normal.'],
    musicoterapia: ['Musicoterapia 24/7', 'El ánimo sigue la curva del día dentro de la jornada (calma → foco → ánimo → energía → bajar).']
  };

  /* ───────────── piezas comunes ───────────── */
  const fecha = (ms) => { try { return ms ? new Date(ms).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'; } catch (_) { return '—'; } };
  function sinAcceso(cont) {
    cont.replaceChildren(h('div', { class: 'vacio' }, [h('p', { text: 'Ya no tienes acceso a Administración (la clave cambió o se olvidó).' })]));
    P.revisarAdmin(false);
  }
  /* Si la respuesta es un error, lo pinta en `cont` (con Reintentar) y devuelve true. */
  function fallo(r, cont, reintentar) {
    if (r.ok) return false;
    if (r.status === 401) { sinAcceso(cont); return true; }
    cont.replaceChildren(h('div', { class: 'vacio' }, [
      h('p', { text: r.status === 503 ? 'Esta función no está disponible en el servidor.' : L.mensajeError(r.status) }),
      h('button', { type: 'button', class: 'primary', text: 'Reintentar', onclick: reintentar })
    ]));
    return true;
  }
  const detalle = (r) => (r.data && r.data.detalle ? ' (' + r.data.detalle + ')' : '');
  function cargando(cont, texto) { cont.setAttribute('aria-busy', 'true'); cont.replaceChildren(h('p', { class: 'cargando', text: texto })); }
  async function cargarGeneros() {
    if (generos) return generos;
    const r = await A.generos();
    generos = r.ok && Array.isArray(r.data) ? r.data.filter((g) => g && typeof g.id === 'string').map((g) => ({ id: g.id, label: String(g.label || g.id), emoji: g.emoji })) : [];
    return generos;
  }
  const nombreGenero = (id) => { const g = (generos || []).find((x) => x.id === id); return g ? g.label : id; };

  /* Casillas de días (0 = domingo). Devuelve { el, leer() }. */
  function diasEditor(prefijo, dias, alCambiar) {
    const marcados = new Set(dias || []);
    const cajas = AL.DIAS.map((d, i) => {
      const id = prefijo + '-d' + i;
      const c = h('input', { type: 'checkbox', id, checked: marcados.has(i), onchange: alCambiar ? () => alCambiar(leer()) : null });
      return { i, c, el: h('label', { class: 'dia', for: id }, [c, h('span', { text: d })]) };
    });
    const leer = () => cajas.filter((x) => x.c.checked).map((x) => x.i);
    /* lunes primero, domingo al final (como se lee en México) */
    const orden = cajas.slice(1).concat(cajas[0]);
    return { el: h('fieldset', { class: 'dias' }, [h('legend', { text: 'Días' }), h('div', { class: 'dias-fila' }, orden.map((x) => x.el))]), leer };
  }
  function campoHora(id, texto, valor, alCambiar) {
    const i = h('input', { type: 'time', id, value: valor || '', step: '60', onchange: alCambiar ? () => alCambiar(i.value) : null });
    return { el: h('div', { class: 'campo' }, [h('label', { for: id, text: texto }), i]), input: i };
  }
  function listaErrores(cont, errores) {
    cont.replaceChildren(...(errores.length ? [h('p', { text: 'Revisa esto antes de guardar:' }), h('ul', {}, errores.map((m) => h('li', { text: m })))] : []));
    cont.hidden = !errores.length;
    if (errores.length) { cont.tabIndex = -1; cont.focus(); }
  }

  /* ═════════════ Horario ═════════════ */
  let hor = null;           /* copia editable { modo, jornada, bloques } */
  let horCambios = false, ultimoAhora = null;

  async function pintarHorario() {
    const c = els.horario;
    cargando(c, 'Cargando el horario…');
    const [r, ahora] = await Promise.all([A.horario(), A.horarioAhora(), cargarGeneros()]);
    c.removeAttribute('aria-busy');
    if (fallo(r, c, pintarHorario)) return;
    hor = JSON.parse(JSON.stringify(r.data || {}));
    if (!hor.jornada) hor.jornada = { inicio: 7, fin: 19 };
    if (!Array.isArray(hor.bloques)) hor.bloques = [];
    if (!AL.MODOS.includes(hor.modo)) hor.modo = 'rotacion';
    horCambios = false;
    ultimoAhora = ahora && ahora.ok ? ahora.data : null;
    armarHorario(ultimoAhora);
  }

  function textoAhora(a) {
    if (!a) return 'No se pudo saber qué suena ahora.';
    const g = Array.isArray(a.generos) && a.generos.length ? a.generos.slice(0, 6).map(nombreGenero).join(', ') + (a.generos.length > 6 ? '…' : '') : 'cualquier género';
    if (a.modo === 'horario' && a.bloque) return 'Ahora: bloque «' + (a.bloque.nombre || a.bloque.desde + '–' + a.bloque.hasta) + '» · ' + g + '.';
    if (a.modo === 'musicoterapia') return 'Ahora: musicoterapia · ' + (MOOD_TXT[a.mood] || 'ánimo libre') + ' · ' + g + '.';
    return 'Ahora: rotación normal' + (a.modo === 'horario' ? ' (fuera de los bloques)' : '') + '.';
  }

  function armarHorario(ahora) {
    const c = els.horario;
    const errores = h('div', { class: 'aviso err-caja', role: 'alert', hidden: true });
    const modo = h('fieldset', { class: 'modos' }, [h('legend', { text: 'Modo del radio principal' })].concat(AL.MODOS.map((m) => {
      const id = 'hm-' + m;
      return h('label', { class: 'modo-op', for: id }, [
        h('input', { type: 'radio', name: 'horModo', id, value: m, checked: hor.modo === m, onchange: () => { hor.modo = m; marcarCambio(); } }),
        h('span', {}, [h('strong', { text: MODO_TXT[m][0] }), h('span', { class: 'muted', text: ' — ' + MODO_TXT[m][1] })])
      ]);
    })));
    const num = (id, texto, valor, k) => {
      const i = h('input', { type: 'number', id, min: '0', max: '24', step: '1', inputmode: 'numeric', value: String(valor) });
      i.addEventListener('change', () => { hor.jornada[k] = i.value === '' ? NaN : Number(i.value); marcarCambio(); });
      return h('div', { class: 'campo' }, [h('label', { for: id, text: texto }), i]);
    };
    const jornada = h('fieldset', {}, [h('legend', { text: 'Jornada laboral (horas enteras, 0 a 24)' }), h('div', { class: 'campos-fila' }, [num('hjIni', 'Inicio', hor.jornada.inicio, 'inicio'), num('hjFin', 'Fin', hor.jornada.fin, 'fin')])]);
    els.bloques = h('ol', { class: 'bloques', 'aria-label': 'Bloques del horario' });
    const guardar = h('button', { type: 'button', class: 'primary', text: 'Guardar horario' });
    guardar.addEventListener('click', async () => {
      const limpio = AL.limpiarHorario(hor);
      const v = AL.validarHorario(limpio, generos && generos.length ? generos.map((g) => g.id) : null);
      listaErrores(errores, v.errores.map((e) => (e.bloque >= 0 ? 'Bloque ' + (e.bloque + 1) + ': ' : '') + e.msg));
      if (!v.ok) return;
      guardar.disabled = true;
      const r = await A.guardarHorario(limpio);
      guardar.disabled = false;
      if (r.status === 401) return sinAcceso(c);
      if (!r.ok) { listaErrores(errores, [r.status === 400 ? 'El servidor no aceptó el horario' + detalle(r) + '.' : L.mensajeError(r.status)]); return; }
      P.toast('Horario guardado. Las pantallas lo siguen desde ya.');
      pintarHorario();
    });
    c.replaceChildren(
      h('div', { class: 'sub-cab' }, [h('h2', { text: 'Horario del radio principal' })]),
      h('p', { class: 'hint', text: 'Solo para las pantallas (/ y /kiosco). Los oyentes del panel no se ven afectados.' }),
      h('p', { class: 'aviso', role: 'status', text: textoAhora(ahora) }),
      modo, jornada,
      h('h3', { class: 'grupo', text: 'Bloques' }),
      h('p', { class: 'hint', text: 'Cada bloque: días, franja y de 1 a 12 géneros. «Generar semana» propone bloques con la curva del día; revísalos y luego Guardar.' }),
      els.bloques,
      h('div', { class: 'row izq' }, [
        h('button', { type: 'button', class: 'ghost', text: 'Agregar bloque', onclick: agregarBloque }),
        h('button', { type: 'button', class: 'ghost', text: 'Generar semana', onclick: generarSemana })
      ]),
      errores,
      h('div', { class: 'row izq' }, [guardar, h('button', { type: 'button', class: 'ghost', text: 'Descartar cambios', onclick: () => { if (!horCambios || window.confirm('¿Descartar los cambios sin guardar?')) pintarHorario(); } })])
    );
    pintarBloques();
  }
  function marcarCambio() { horCambios = true; }

  function agregarBloque() {
    if (hor.bloques.length >= AL.MAX_BLOQUES) { P.toast('Máximo ' + AL.MAX_BLOQUES + ' bloques.'); return; }
    hor.bloques.push({ dias: [1, 2, 3, 4, 5], desde: '09:00', hasta: '11:00', generos: [] });
    marcarCambio();
    pintarBloques();
    const n = hor.bloques.length - 1;
    const f = document.getElementById('hb' + n + '-nombre');
    if (f) f.focus();
  }
  async function generarSemana() {
    if (hor.bloques.length && !window.confirm('La propuesta reemplaza los bloques del editor (aún no se guarda nada). ¿Continuar?')) return;
    const j = hor.jornada && Number.isInteger(hor.jornada.inicio) && Number.isInteger(hor.jornada.fin) ? { inicio: hor.jornada.inicio, fin: hor.jornada.fin } : undefined;
    const r = await A.generarSemana(j);
    if (r.status === 401) return sinAcceso(els.horario);
    if (!r.ok || !r.data || !Array.isArray(r.data.bloques)) { P.toastError(L.mensajeError(r.status)); return; }
    hor.bloques = r.data.bloques;
    if (hor.modo === 'rotacion') hor.modo = 'horario';
    marcarCambio();
    armarHorario(ultimoAhora);
    P.toast('Propuesta lista: ' + r.data.bloques.length + ' bloques. Revísala y toca «Guardar horario».', 6000);
    const b = document.getElementById('hb0-nombre');
    if (b) b.focus();
  }

  function pintarBloques() {
    els.bloques.replaceChildren(...hor.bloques.map((b, i) => bloqueEditor(b, i)));
    if (!hor.bloques.length) els.bloques.replaceChildren(h('li', { class: 'hint', text: 'Sin bloques.' }));
  }

  function bloqueEditor(b, i) {
    const p = 'hb' + i;
    const nombre = h('input', { id: p + '-nombre', maxlength: '40', value: b.nombre || '', autocomplete: 'off', placeholder: 'Por ejemplo: Inicio de jornada' });
    nombre.addEventListener('input', () => { b.nombre = nombre.value; marcarCambio(); });
    const dias = diasEditor(p, b.dias, (d) => { b.dias = d; marcarCambio(); });
    const desde = campoHora(p + '-desde', 'Desde', b.desde, (v) => { b.desde = v; marcarCambio(); });
    const hasta = campoHora(p + '-hasta', 'Hasta', b.hasta, (v) => { b.hasta = v; marcarCambio(); });
    const mood = h('select', { id: p + '-mood' }, [h('option', { value: '', text: 'Sin ánimo fijo' })].concat(AL.MOODS.map((m) => h('option', { value: m, text: MOOD_TXT[m], selected: b.mood === m }))));
    mood.addEventListener('change', () => { if (mood.value) b.mood = mood.value; else delete b.mood; marcarCambio(); });

    /* géneros: chips con «Quitar» + buscador */
    const elegidos = h('ul', { class: 'gen-elegidos', 'aria-label': 'Géneros del bloque ' + (i + 1) });
    const q = h('input', { type: 'search', id: p + '-gq', autocomplete: 'off', placeholder: 'Buscar género…' });
    const sugerencias = h('ul', { class: 'gen-sug', 'aria-label': 'Géneros encontrados' });
    const encontrados = h('span', { class: 'sr-only', role: 'status' }); /* WCAG 4.1.3: cuántos géneros coinciden al escribir */
    const cuenta = h('span', { class: 'contador', 'aria-live': 'polite' });
    function pintarElegidos() {
      const gs = Array.isArray(b.generos) ? b.generos : (b.generos = []);
      cuenta.textContent = gs.length + ' de ' + AL.MAX_GENEROS;
      elegidos.replaceChildren(...gs.map((id) => h('li', {}, h('button', { type: 'button', class: 'chip', 'aria-label': 'Quitar ' + nombreGenero(id), onclick: () => { b.generos = gs.filter((x) => x !== id); marcarCambio(); pintarElegidos(); buscarGen(); q.focus(); } }, [nombreGenero(id), h('span', { 'aria-hidden': 'true', text: ' ×' })]))));
    }
    function buscarGen() {
      const t = q.value.trim();
      if (!t) { sugerencias.replaceChildren(); encontrados.textContent = ''; return; }
      const gs = AL.filtrarGeneros(generos, t, b.generos, 8);
      encontrados.textContent = gs.length ? (gs.length === 1 ? '1 género encontrado.' : gs.length + ' géneros encontrados.') : 'Ningún género coincide.';
      sugerencias.replaceChildren(...(gs.length ? gs.map((g) => h('li', {}, h('button', { type: 'button', class: 'chip', 'aria-label': 'Agregar ' + g.label, onclick: () => {
        if (b.generos.length >= AL.MAX_GENEROS) { P.toast('Máximo ' + AL.MAX_GENEROS + ' géneros por bloque.'); return; }
        b.generos = b.generos.concat(g.id); marcarCambio(); pintarElegidos(); q.value = ''; buscarGen(); q.focus();
      } }, ['+ ', g.label]))) : [h('li', { class: 'hint', text: 'Ningún género coincide.' })]));
    }
    q.addEventListener('input', buscarGen);
    pintarElegidos();

    return h('li', {}, h('fieldset', { class: 'bloque tarjeta' }, [
      h('legend', { text: 'Bloque ' + (i + 1) + (b.nombre ? ' · ' + b.nombre : '') }),
      h('div', { class: 'campo' }, [h('label', { for: p + '-nombre', text: 'Nombre (opcional)' }), nombre]),
      dias.el,
      h('div', { class: 'campos-fila' }, [desde.el, hasta.el, h('div', { class: 'campo' }, [h('label', { for: p + '-mood', text: 'Ánimo (opcional)' }), mood])]),
      h('div', { class: 'gen-cab' }, [h('span', { class: 'grupo', text: 'Géneros' }), cuenta]),
      elegidos,
      h('label', { for: p + '-gq', text: 'Agregar género' }), q, encontrados, sugerencias,
      h('div', { class: 'row izq' }, [h('button', { type: 'button', class: 'ghost danger-b corto', text: 'Quitar bloque', 'aria-label': 'Quitar el bloque ' + (i + 1), onclick: () => {
        hor.bloques.splice(i, 1); marcarCambio(); pintarBloques();
        const sig = document.getElementById('hb' + Math.min(i, hor.bloques.length - 1) + '-nombre');
        if (sig) sig.focus();
      } })])
    ]));
  }

  /* ═════════════ Anuncios ═════════════ */
  /* Campos de programación (nuevo y editar). Devuelve { el, leer() }. */
  function programacion(p, a) {
    const dias = diasEditor(p, a.dias);
    const desde = campoHora(p + '-desde', 'Desde', a.desde || '09:00');
    const hasta = campoHora(p + '-hasta', 'Hasta', a.hasta || '18:00');
    const cada = h('input', { type: 'number', id: p + '-cada', min: '0', max: '720', step: '1', inputmode: 'numeric', value: String(Number.isInteger(a.cadaMin) ? a.cadaMin : 60) });
    return {
      el: h('div', {}, [dias.el, h('div', { class: 'campos-fila' }, [desde.el, hasta.el, h('div', { class: 'campo' }, [h('label', { for: p + '-cada', text: 'Cada (minutos; 0 = una vez)' }), cada])])]),
      leer: () => ({ dias: dias.leer(), desde: desde.input.value, hasta: hasta.input.value, cadaMin: cada.value === '' ? NaN : Number(cada.value) })
    };
  }

  async function pintarAnuncios() {
    const c = els.anuncios;
    cargando(c, 'Cargando anuncios…');
    const r = await A.anuncios();
    c.removeAttribute('aria-busy');
    if (fallo(r, c, pintarAnuncios)) return;
    const lista = Array.isArray(r.data) ? r.data : [];
    c.replaceChildren(
      h('div', { class: 'sub-cab' }, [h('h2', { text: 'Anuncios programados' }), h('span', { class: 'contador', text: lista.length === 1 ? '1 anuncio' : lista.length + ' anuncios' })]),
      h('p', { class: 'hint', text: 'Mensajes de bienestar o jingles en mp3 (hasta 5 MB). Suenan solo en las pantallas, con la música baja; los oyentes del panel no los oyen.' }),
      lista.length ? h('ul', { class: 'filas' }, lista.map(filaAnuncio)) : h('p', { class: 'hint', text: 'Todavía no hay anuncios.' }),
      formNuevo()
    );
  }

  function filaAnuncio(a) {
    const id = 'an-' + a.id;
    const activo = h('input', { type: 'checkbox', id: id + '-act', checked: !!a.activo });
    activo.addEventListener('change', async () => {
      activo.disabled = true;
      const r = await A.editarAnuncio(a.id, { activo: activo.checked });
      activo.disabled = false;
      if (r.status === 401) return sinAcceso(els.anuncios);
      if (!r.ok) { activo.checked = !activo.checked; P.toastError(L.mensajeError(r.status)); return; }
      P.toast('«' + a.nombre + '» ' + (activo.checked ? 'activado.' : 'desactivado.'));
    });
    const editor = h('div', { class: 'an-editor', hidden: true });
    const bEditar = h('button', { type: 'button', class: 'ghost corto', text: 'Editar', 'aria-expanded': 'false', 'aria-label': 'Editar ' + a.nombre });
    bEditar.addEventListener('click', () => {
      const abrir = editor.hidden;
      editor.hidden = !abrir;
      bEditar.setAttribute('aria-expanded', String(abrir));
      if (abrir) { editor.replaceChildren(formEditar(a, () => { editor.hidden = true; bEditar.setAttribute('aria-expanded', 'false'); bEditar.focus(); })); const f = editor.querySelector('input'); if (f) f.focus(); }
    });
    return h('li', { class: 'fila an-fila' }, [
      h('div', { class: 'fila-info' }, [
        h('span', { class: 'fila-t', text: a.nombre }),
        h('span', { class: 'fila-s', text: AL.textoProgramacion(a) + ' · ' + AL.fmtBytes(a.bytes) }),
        /* cada fila tiene su casilla «Activo»: el nombre del anuncio va oculto en la etiqueta para distinguirlas (WCAG 2.4.6) */
        h('label', { class: 'check', for: id + '-act' }, [activo, h('span', {}, ['Activo', h('span', { class: 'sr-only', text: ': ' + a.nombre })])]),
        editor
      ]),
      h('div', { class: 'fila-acc' }, [
        h('button', { type: 'button', class: 'ghost corto', text: 'Probar', 'aria-label': 'Probar ' + a.nombre + ' en las pantallas', onclick: async () => {
          const r = await A.probarAnuncio(a.id);
          if (r.status === 401) return sinAcceso(els.anuncios);
          if (!r.ok) { P.toastError(L.mensajeError(r.status)); return; }
          const n = r.data && Number(r.data.entregado) || 0;
          P.toast(n ? 'Enviado a ' + (n === 1 ? '1 pantalla.' : n + ' pantallas.') : 'No hay pantallas conectadas para oírlo.');
        } }),
        bEditar,
        h('button', { type: 'button', class: 'ghost danger-b corto', text: 'Borrar', 'aria-label': 'Borrar ' + a.nombre, onclick: async () => {
          if (!window.confirm('¿Borrar el anuncio «' + a.nombre + '»? Se borra también su audio.')) return;
          const r = await A.borrarAnuncio(a.id);
          if (r.status === 401) return sinAcceso(els.anuncios);
          if (!r.ok && r.status !== 404) { P.toastError(L.mensajeError(r.status)); return; }
          P.toast('Anuncio borrado.');
          pintarAnuncios();
        } })
      ])
    ]);
  }

  function formEditar(a, cerrar) {
    const p = 'ae-' + a.id;
    const nombre = h('input', { id: p + '-nombre', maxlength: '60', value: a.nombre, autocomplete: 'off' });
    const prog = programacion(p, a);
    const err = h('div', { class: 'err', role: 'alert', hidden: true });
    const form = h('form', { novalidate: true }, [
      h('label', { for: p + '-nombre', text: 'Nombre' }), nombre, prog.el, err,
      h('div', { class: 'row izq' }, [h('button', { type: 'submit', class: 'primary', text: 'Guardar cambios' }), h('button', { type: 'button', class: 'ghost', text: 'Cancelar', onclick: cerrar })])
    ]);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const datos = Object.assign({ nombre: nombre.value.trim() }, prog.leer());
      const e = AL.validarAnuncio(datos);
      listaErrores(err, e);
      if (e.length) return;
      const r = await A.editarAnuncio(a.id, datos);
      if (r.status === 401) return sinAcceso(els.anuncios);
      if (!r.ok) { listaErrores(err, ['No se guardó' + detalle(r) + '.']); return; }
      P.toast('Anuncio actualizado.');
      pintarAnuncios();
    });
    return form;
  }

  function formNuevo() {
    const p = 'an-nuevo';
    const nombre = h('input', { id: p + '-nombre', maxlength: '60', autocomplete: 'off', placeholder: 'Por ejemplo: Pausa activa' });
    const archivo = h('input', { type: 'file', id: p + '-mp3', accept: 'audio/mpeg,.mp3' });
    const prog = programacion(p, { dias: [1, 2, 3, 4, 5], desde: '10:00', hasta: '17:00', cadaMin: 120 });
    const activo = h('input', { type: 'checkbox', id: p + '-act', checked: true });
    const err = h('div', { class: 'err', role: 'alert', hidden: true });
    const subir = h('button', { type: 'submit', class: 'primary', text: 'Subir anuncio' });
    const form = h('form', { class: 'tarjeta', novalidate: true, 'aria-labelledby': p + '-t' }, [
      h('h3', { id: p + '-t', text: 'Nuevo anuncio' }),
      h('label', { for: p + '-nombre', text: 'Nombre' }), nombre,
      h('label', { for: p + '-mp3', text: 'Archivo mp3 (hasta 5 MB)' }), archivo,
      prog.el,
      h('label', { class: 'check', for: p + '-act' }, [activo, h('span', { text: 'Activo al subirlo' })]),
      err, h('div', { class: 'row izq' }, [subir])
    ]);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = archivo.files && archivo.files[0];
      const datos = Object.assign({ nombre: nombre.value.trim(), activo: activo.checked }, prog.leer());
      const e = AL.validarAnuncio(datos, { bytes: f ? f.size : 0, tipo: f ? f.type : '', archivo: f ? f.name : '' });
      listaErrores(err, e);
      if (e.length) return;
      subir.disabled = true; subir.textContent = 'Subiendo…';
      const audio = await new Promise((resolve) => {
        const fr = new FileReader();
        fr.onload = () => resolve(AL.base64DeDataUrl(String(fr.result || '')));
        fr.onerror = () => resolve('');
        fr.readAsDataURL(f);
      });
      if (!audio) { subir.disabled = false; subir.textContent = 'Subir anuncio'; listaErrores(err, ['No se pudo leer el archivo.']); return; }
      const r = await A.crearAnuncio(Object.assign({ audio }, datos));
      subir.disabled = false; subir.textContent = 'Subir anuncio';
      if (r.status === 401) return sinAcceso(els.anuncios);
      if (!r.ok) {
        const m = r.status === 413 ? 'El archivo es demasiado grande (máximo 5 MB).' : r.data && r.data.error === 'AUDIO_INVALIDO' ? 'El archivo no parece un mp3 válido.' : 'No se pudo subir' + detalle(r) + '.';
        listaErrores(err, [m]); return;
      }
      P.toast('Anuncio «' + datos.nombre + '» subido.');
      pintarAnuncios();
    });
    return form;
  }

  /* ═════════════ Ajustes ═════════════ */
  async function pintarAjustes() {
    const c = els.ajustes;
    cargando(c, 'Cargando ajustes…');
    const r = await A.ajustes();
    c.removeAttribute('aria-busy');
    if (fallo(r, c, pintarAjustes)) return;
    const d = r.data || {};
    const filtro = h('input', { type: 'checkbox', id: 'ajFiltro', checked: !!d.filtroExplicito });
    const palabras = h('textarea', { id: 'ajPalabras', rows: '6', spellcheck: 'false', 'aria-describedby': 'ajPalabrasAyuda' });
    palabras.value = (Array.isArray(d.palabras) ? d.palabras : []).join('\n');
    const err = h('div', { class: 'err', role: 'alert', hidden: true });
    const guardar = h('button', { type: 'submit', class: 'primary', text: 'Guardar ajustes' });
    const form = h('form', { novalidate: true }, [
      h('label', { class: 'check', for: 'ajFiltro' }, [filtro, h('span', { text: 'Filtrar contenido explícito' })]),
      h('label', { for: 'ajPalabras', text: 'Palabras extra a filtrar (una por línea)' }), palabras,
      h('p', { class: 'hint', id: 'ajPalabrasAyuda', text: 'Se descartan las canciones cuyo título contiene alguna de estas palabras, además de la lista base. No es infalible: yt-dlp no tiene un «safeSearch».' }),
      err, h('div', { class: 'row izq' }, [guardar])
    ]);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      listaErrores(err, []);
      guardar.disabled = true;
      const x = await A.guardarAjustes({ filtroExplicito: filtro.checked, palabras: AL.palabrasDeTexto(palabras.value) });
      guardar.disabled = false;
      if (x.status === 401) return sinAcceso(c);
      if (!x.ok) { listaErrores(err, ['No se guardó' + detalle(x) + '.']); return; }
      P.toast('Ajustes guardados.');
      pintarAjustes();
    });
    c.replaceChildren(h('div', { class: 'sub-cab' }, [h('h2', { text: 'Ajustes' })]), form);
  }

  /* ═════════════ Usuarios ═════════════ */
  let usuarios = [];
  async function pintarUsuarios() {
    const c = els.usuarios;
    cargando(c, 'Cargando usuarios…');
    const r = await A.usuarios();
    c.removeAttribute('aria-busy');
    if (fallo(r, c, pintarUsuarios)) return;
    usuarios = Array.isArray(r.data) ? r.data : [];
    const filtro = h('input', { type: 'search', id: 'usFiltro', autocomplete: 'off', placeholder: 'Nómina o nombre' });
    const cuerpo = h('tbody');
    const cuenta = h('p', { class: 'contador', role: 'status' });
    const pintarTabla = () => {
      const t = filtro.value.trim().toLowerCase();
      const vis = usuarios.filter((u) => !t || String(u.nomina || '').includes(t) || String(u.nombre || '').toLowerCase().includes(t));
      cuenta.textContent = vis.length + ' de ' + usuarios.length + ' cuentas';
      cuerpo.replaceChildren(...vis.map((u) => {
        const activo = u.estado === 'activo';
        return h('tr', {}, [
          h('th', { scope: 'row', text: String(u.nomina || '') }),
          h('td', { text: u.nombre || '—' }),
          h('td', { text: activo ? 'Activa' : 'Desactivada' }),
          h('td', { text: fecha(u.creado) }),
          h('td', { text: fecha(u.ultimo) }),
          h('td', {}, h('button', { type: 'button', class: 'ghost corto' + (activo ? ' danger-b' : ''), text: activo ? 'Desactivar' : 'Activar', 'aria-label': (activo ? 'Desactivar' : 'Activar') + ' la nómina ' + u.nomina, onclick: async (ev) => {
            const b = ev.currentTarget;
            if (activo && !window.confirm('¿Desactivar la nómina ' + u.nomina + '? No podrá entrar hasta que la actives de nuevo.')) return;
            b.disabled = true;
            const x = await A.estadoUsuario(u.id, activo ? 'desactivado' : 'activo');
            if (x.status === 401) return sinAcceso(c);
            if (!x.ok) { b.disabled = false; P.toastError(L.mensajeError(x.status)); return; }
            u.estado = x.data && x.data.estado ? x.data.estado : activo ? 'desactivado' : 'activo';
            P.toast('Nómina ' + u.nomina + (u.estado === 'activo' ? ' activada.' : ' desactivada.'));
            pintarTabla();
            const otra = cuerpo.querySelector('button[aria-label$="nómina ' + u.nomina + '"]');
            if (otra) otra.focus();
          } }))
        ]);
      }));
    };
    filtro.addEventListener('input', pintarTabla);
    c.replaceChildren(
      h('div', { class: 'sub-cab' }, [h('h2', { text: 'Usuarios' })]),
      h('p', { class: 'hint', text: 'Las cuentas no se borran: si alguien no debe entrar, desactívala.' }),
      h('label', { for: 'usFiltro', text: 'Buscar cuenta' }), filtro, cuenta,
      h('div', { class: 'tabla-scroll', tabindex: '0', role: 'region', 'aria-label': 'Tabla de usuarios' }, h('table', { class: 'tabla' }, [
        h('caption', { class: 'sr-only', text: 'Cuentas del panel' }),
        h('thead', {}, h('tr', {}, ['Nómina', 'Nombre', 'Estado', 'Creada', 'Último acceso', 'Acción'].map((t) => h('th', { scope: 'col', text: t })))),
        cuerpo
      ]))
    );
    pintarTabla();
  }

  /* ═════════════ Diagnóstico ═════════════ */
  const NIVEL_TXT = { error: 'Error', aviso: 'Aviso', info: 'Info' };
  function valorSistema(k, v) {
    if (k === 'uptime') return AL.fmtUptime(v);
    if (typeof v === 'boolean') return v ? 'Sí' : 'No';
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'object') return v.enabled === undefined ? JSON.stringify(v).slice(0, 120) : v.enabled ? 'Activa' + (v.estado ? ' (' + v.estado + ')' : '') : 'Apagada (reglas locales)';
    return String(v);
  }
  const SISTEMA_TXT = { uptime: 'Tiempo encendido', ytdlp: 'Versión de yt-dlp', relojSincronizado: 'Reloj sincronizado', gemini: 'IA (Gemini)', pantallas: 'Pantallas conectadas', sesionesRadio: 'Oyentes del panel', cuentas: 'Cuentas' };

  async function pintarDiagnostico() {
    const c = els.diagnostico;
    const foco = c.contains(document.activeElement) ? document.activeElement.id : '';
    cargando(c, 'Cargando diagnóstico…');
    const r = await A.diagnostico();
    c.removeAttribute('aria-busy');
    if (fallo(r, c, pintarDiagnostico)) return;
    const d = r.data || {};
    const res = AL.resumenDiagnostico(d);
    const sis = d.sistema && typeof d.sistema === 'object' ? d.sistema : {};
    const eventos = Array.isArray(d.eventos) ? d.eventos : [];
    const nivel = h('select', { id: 'dgNivel' }, [['', 'Todos'], ['error', 'Errores'], ['aviso', 'Avisos'], ['info', 'Info']].map(([v, t]) => h('option', { value: v, text: t })));
    const cuerpoEv = h('tbody');
    const pintarEventos = () => {
      const vis = eventos.filter((e) => !nivel.value || e.nivel === nivel.value).slice(0, 200);
      cuerpoEv.replaceChildren(...(vis.length ? vis.map((e) => h('tr', { class: 'nv-' + (e.nivel || '') }, [
        h('td', { text: fecha(e.t) }), h('td', { text: e.servicio || '' }), h('td', { text: NIVEL_TXT[e.nivel] || e.nivel || '' }), h('td', { class: 'msg', text: e.msg || '' })
      ])) : [h('tr', {}, h('td', { colspan: '4', class: 'muted', text: 'Sin eventos.' }))]));
    };
    nivel.addEventListener('change', pintarEventos);
    c.replaceChildren(
      h('div', { class: 'sub-cab' }, [h('h2', { text: 'Diagnóstico' }), h('button', { type: 'button', id: 'dgActualizar', class: 'ghost corto', text: 'Actualizar', onclick: pintarDiagnostico })]),
      h('p', { class: res.errores ? 'aviso' : 'hint', role: 'status', text: res.errores ? 'En la última hora: ' + res.errores + ' errores y ' + res.avisos + ' avisos. Con errores: ' + res.conProblemas.join(', ') + '.' : 'Sin errores en la última hora' + (res.avisos ? ' (' + res.avisos + ' avisos).' : '.') }),
      h('h3', { class: 'grupo', text: 'Sistema' }),
      h('dl', { class: 'sistema' }, Object.keys(sis).flatMap((k) => [h('dt', { text: SISTEMA_TXT[k] || k }), h('dd', { text: valorSistema(k, sis[k]) })])),
      h('h3', { class: 'grupo', text: 'Por servicio (última hora)' }),
      h('div', { class: 'tabla-scroll', tabindex: '0', role: 'region', 'aria-label': 'Errores por servicio' }, h('table', { class: 'tabla' }, [
        h('caption', { class: 'sr-only', text: 'Errores y avisos por servicio en la última hora' }),
        h('thead', {}, h('tr', {}, ['Servicio', 'Errores', 'Avisos', 'Último evento'].map((t) => h('th', { scope: 'col', text: t })))),
        h('tbody', {}, (Array.isArray(d.servicios) ? d.servicios : []).map((s) => h('tr', {}, [
          h('th', { scope: 'row', text: s.servicio }), h('td', { text: String(s.errores1h || 0) }), h('td', { text: String(s.avisos1h || 0) }),
          h('td', { class: 'msg', text: s.ultimo ? fecha(s.ultimo.t) + ' · ' + (NIVEL_TXT[s.ultimo.nivel] || s.ultimo.nivel) + ' · ' + (s.ultimo.msg || '') : '—' })
        ])))
      ])),
      h('div', { class: 'gen-cab' }, [h('h3', { class: 'grupo', text: 'Eventos recientes' }), h('div', { class: 'campo-inline' }, [h('label', { for: 'dgNivel', text: 'Mostrar' }), nivel])]),
      h('div', { class: 'tabla-scroll', tabindex: '0', role: 'region', 'aria-label': 'Eventos recientes' }, h('table', { class: 'tabla' }, [
        h('caption', { class: 'sr-only', text: 'Eventos recientes' }),
        h('thead', {}, h('tr', {}, ['Hora', 'Servicio', 'Nivel', 'Mensaje'].map((t) => h('th', { scope: 'col', text: t })))),
        cuerpoEv
      ]))
    );
    pintarEventos();
    /* el aviso de estado se crea ya con texto (no se anuncia): al pulsar Actualizar se confirma con el aviso general */
    if (foco) { const f = document.getElementById(foco); if (f) f.focus(); if (foco === 'dgActualizar') P.toast('Diagnóstico actualizado.'); }
  }

  /* ═════════════ armado ═════════════ */
  const SUBS = [
    { id: 'horario', titulo: 'Horario', pintar: () => (hor && horCambios ? armarHorario(ultimoAhora) : pintarHorario()) }, /* los cambios sin guardar se conservan al ir y volver */
    { id: 'anuncios', titulo: 'Anuncios', pintar: pintarAnuncios },
    { id: 'ajustes', titulo: 'Ajustes', pintar: pintarAjustes },
    { id: 'usuarios', titulo: 'Usuarios', pintar: pintarUsuarios },
    { id: 'diagnostico', titulo: 'Diagnóstico', pintar: pintarDiagnostico }
  ];

  function montar(el) {
    el.classList.add('vista-int', 'admin');
    const lista = h('div', { class: 'tablist sub', role: 'tablist', 'aria-label': 'Secciones de Administración' }, SUBS.map((s, i) => h('button', {
      type: 'button', class: 'tab', role: 'tab', id: 'at-' + s.id, 'aria-selected': String(i === 0), 'aria-controls': 'ap-' + s.id, tabindex: i === 0 ? '0' : '-1', text: s.titulo
    })));
    for (const s of SUBS) els[s.id] = h('div', { class: 'subpnl', role: 'tabpanel', id: 'ap-' + s.id, 'aria-labelledby': 'at-' + s.id, tabindex: '0', hidden: s.id !== 'horario' });
    el.append(h('h1', { class: 'vt', text: 'Administración' }), h('nav', { class: 'subtabs', 'aria-label': 'Secciones de Administración' }, lista), ...SUBS.map((s) => els[s.id]));
    P.tablist(lista, (_, i) => {
      activa = SUBS[i].id;
      SUBS.forEach((s) => { els[s.id].hidden = s.id !== activa; });
      SUBS[i].pintar();
    }, { manual: true });
    pintarHorario();
  }

  P.vistas.admin = { montar };
})();
