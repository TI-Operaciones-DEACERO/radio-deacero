/* admin-arranque.js — /admin: comprueba el acceso (GET /api/admin/estado). Con acceso (la propia máquina, o la clave de /remote / ?t=) monta
   Administración; si no, pide la clave. La clave es la MISMA que usa /remote (REMOTE_TOKEN): el servidor es quien decide, esto solo la manda. */
(function () {
  'use strict';
  const P = window.Panel, A = P.api, L = P.L;
  const $ = (id) => document.getElementById(id);
  let montado = false;

  function errorClave(texto) {
    const m = $('claveErr');
    m.textContent = texto || ''; m.hidden = !texto;
    if (texto) { $('claveIn').setAttribute('aria-invalid', 'true'); $('claveIn').focus(); } else $('claveIn').removeAttribute('aria-invalid');
  }

  function mostrarAcceso() {
    $('adminCargando').hidden = true;
    $('p-admin').hidden = true;
    $('adminSalir').hidden = !A.clave.hay();
    $('adminAcceso').hidden = false;
    document.title = 'Clave de administración · DEACERO Play';
    const a = document.activeElement;
    if (!a || a === document.body || !document.body.contains(a)) $('claveIn').focus(); /* el foco no se pierde tras comprobar el acceso o un 401 */
  }

  function mostrarAdmin() {
    $('adminCargando').hidden = true;
    $('adminAcceso').hidden = true;
    $('adminSalir').hidden = !A.clave.hay();
    document.title = 'Administración · DEACERO Play';
    const el = $('p-admin');
    el.hidden = false;
    if (!montado) { montado = true; P.vistas.admin.montar(el); }
  }

  /* → { ok, status } */
  async function revisar() {
    const r = await A.adminEstado();
    if (r.ok) mostrarAdmin();
    else {
      if (montado) { montado = false; $('p-admin').replaceChildren(); }
      mostrarAcceso();
      if (r.status === 0) errorClave(L.mensajeError(0));
    }
    return r;
  }
  window.AdminPagina = { revisar };

  $('claveForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const v = $('claveIn').value.trim();
    if (!v) return errorClave('Escribe la clave de administración.');
    A.clave.poner(v);
    const r = await revisar();
    if (!r.ok) {
      A.clave.olvidar();
      $('adminSalir').hidden = true;
      return errorClave(r.status === 0 ? L.mensajeError(0) : 'La clave no es correcta.');
    }
    $('claveIn').value = '';
    errorClave('');
    $('vista').focus();
  });

  $('adminSalir').addEventListener('click', async () => {
    A.clave.olvidar();
    try { localStorage.removeItem('pl_token'); } catch (_) { /* sin almacenamiento */ } /* también la que guardó /remote: si no, volvería sola al recargar */
    await revisar();
    P.toast('Clave olvidada en este navegador.');
  });

  revisar().then((r) => { if (r.ok) $('vista').focus(); });
})();
