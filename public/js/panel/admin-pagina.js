/* admin-pagina.js — lo mínimo de `Panel` que necesita admin.js cuando corre en su propia página (/admin), sin el armazón del panel de música:
   h (DOM seguro, solo textContent), avisos, pestañas con teclado y la comprobación de acceso. Lo de la radio (reproductor, sesión) no existe aquí. */
(function () {
  'use strict';
  const L = window.PanelLogica, A = window.PlayApi;
  const $ = (id) => document.getElementById(id);

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

  let timer = 0;
  function toast(msg, ms) {
    const t = $('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(timer);
    timer = setTimeout(() => { t.classList.remove('show'); t.textContent = ''; }, ms || 4000);
  }

  /* Pestañas (ARIA tabs): flechas mueven el foco; Enter/Espacio activan (con `manual`) o las flechas activan; clic activa. */
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
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
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
    return { elegir };
  }

  window.Panel = {
    h, toast, toastError: (m) => toast(m, 8000), tablist, L, api: A, vistas: {},
    /* admin.js la llama cuando una respuesta dice 401 (la clave cambió o se olvidó): se vuelve a pedir la clave */
    revisarAdmin: () => (window.AdminPagina ? window.AdminPagina.revisar() : Promise.resolve())
  };
})();
