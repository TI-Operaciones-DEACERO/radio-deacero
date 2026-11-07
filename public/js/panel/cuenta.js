/* cuenta.js — botón de cuenta y cuadro de entrar (solo con nómina). La cuenta es opcional: sin ella todo sigue sonando. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const MENSAJES = {
    NOMINA_INVALIDA: 'La nómina debe tener de 4 a 10 dígitos.',
    NO_AUTORIZADA: 'Esta nómina no tiene acceso. Pide que te den de alta.',
    DESACTIVADA: 'Esta cuenta está desactivada. Habla con el administrador.',
    LLENO: 'Ya no se pueden crear más cuentas.',
    DEMASIADOS_INTENTOS: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.',
    SIN_CONEXION: 'No hay conexión con el servidor.'
  };
  const msg = (r) => MENSAJES[r.data && r.data.error] || 'No se pudo completar. Inténtalo de nuevo.';

  const dlg = $('acct'), btn = $('acctBtn');
  let user = null, lastId; /* lastId: quien se avisó por última vez (undefined = aún nadie) */

  /* El resto del panel se entera con el evento 'play:user' ({ detail: { user } }) cada vez que cambia quién está dentro, incluida la primera lectura. */
  window.PlayCuenta = { user: () => user, abrir: () => btn.click() };

  function pintar() {
    const id = user ? user.id : null;
    if (id !== lastId) { lastId = id; window.dispatchEvent(new CustomEvent('play:user', { detail: { user } })); }
    btn.dataset.in = user ? '1' : '0';
    btn.textContent = user ? (user.nombre || 'Nómina ' + user.nomina) : 'Entrar con nómina';
    if (user) btn.setAttribute('aria-label', 'Mi cuenta: ' + btn.textContent); else btn.removeAttribute('aria-label');
    dlg.setAttribute('aria-labelledby', user ? 'miCuentaTitle' : 'acctTitle'); /* el nombre del cuadro es el título que se ve */
    $('entrarForm').hidden = !!user;
    $('miCuenta').hidden = !user;
    if (user) { $('yo').textContent = 'Nómina ' + user.nomina; $('nombre2').value = user.nombre || ''; }
  }
  /* El error queda asociado a su campo (aria-invalid + aria-describedby) y el foco vuelve a él para corregirlo. */
  const CAMPO = { err: 'nomina', err2: 'nombre2' };
  const error = (id, text) => {
    const e = $(id), campo = $(CAMPO[id]);
    e.textContent = text || ''; e.hidden = !text;
    if (!campo) return;
    if (text) { campo.setAttribute('aria-invalid', 'true'); campo.setAttribute('aria-describedby', id); campo.focus(); }
    else { campo.removeAttribute('aria-invalid'); campo.removeAttribute('aria-describedby'); }
  };

  btn.addEventListener('click', () => { error('err'); error('err2'); pintar(); dlg.showModal(); (user ? $('nombre2') : $('nomina')).focus(); });
  dlg.addEventListener('close', () => btn.focus()); /* al cerrar, el foco vuelve al botón que lo abrió */
  $('cancelar').addEventListener('click', () => dlg.close());
  $('cerrar').addEventListener('click', () => dlg.close());

  $('entrarForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    error('err');
    const b = $('entrar');
    b.disabled = true;
    const r = await window.PlayApi.login($('nomina').value, $('nombre').value);
    b.disabled = false;
    if (!r.ok) return error('err', msg(r));
    user = r.data.user;
    $('nomina').value = ''; $('nombre').value = '';
    pintar();
    dlg.close();
  });

  $('guardar').addEventListener('click', async () => {
    error('err2');
    const r = await window.PlayApi.perfil($('nombre2').value);
    if (!r.ok) return error('err2', msg(r));
    user = r.data.user;
    pintar();
    dlg.close();
  });

  $('salir').addEventListener('click', async () => { await window.PlayApi.logout(); user = null; pintar(); dlg.close(); });

  window.PlayApi.me().then((r) => { user = r.ok && r.data ? r.data.user : null; pintar(); });
})();
