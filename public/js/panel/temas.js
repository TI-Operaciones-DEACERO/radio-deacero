/* temas.js — los 6 temas del panel completo. Los colores son tokens CSS en panel-completo.css (:root y :root[data-tema="…"]);
   aquí solo está la lista, el contraste (para la prueba AA, test/panel-temas.test.js) y, en el navegador, aplicar el tema guardado
   ANTES de pintar (este archivo va en el <head>, sin defer, para que no parpadee). */
(function (root) {
  'use strict';
  const TEMAS = [
    { id: 'oscuro', nombre: 'Oscuro', muestra: ['#000000', '#F59B23'] },
    { id: 'claro', nombre: 'Claro', muestra: ['#f7f7f5', '#a14f00'] },
    { id: 'contraste', nombre: 'Alto contraste', muestra: ['#000000', '#ffffff'] },
    { id: 'brasa', nombre: 'Brasa', muestra: ['#1c1006', '#F59B23'] },
    { id: 'oceano', nombre: 'Océano', muestra: ['#06131f', '#F59B23'] },
    { id: 'bosque', nombre: 'Bosque', muestra: ['#07140c', '#F59B23'] }
  ];
  const POR_OMISION = 'oscuro';
  const LS = 'pl_tema';
  const temaValido = (id) => (TEMAS.some((t) => t.id === id) ? id : POR_OMISION);

  /* WCAG 2.x: luminancia relativa de '#rgb' / '#rrggbb' (NaN si no es un color así) y razón de contraste. */
  function luminancia(hex) {
    let s = String(hex || '').trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(s)) s = s.split('').map((c) => c + c).join('');
    if (!/^[0-9a-f]{6}$/i.test(s)) return NaN;
    const c = [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function contraste(a, b) {
    const la = luminancia(a), lb = luminancia(b);
    if (Number.isNaN(la) || Number.isNaN(lb)) return NaN;
    return Math.round(((Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)) * 100) / 100;
  }

  const api = { TEMAS, POR_OMISION, temaValido, luminancia, contraste };

  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }

  /* — navegador — */
  function aplicar(id) {
    const t = temaValido(id);
    const d = document.documentElement;
    if (t === POR_OMISION) d.removeAttribute('data-tema'); else d.setAttribute('data-tema', t);
    const meta = document.querySelector('meta[name="color-scheme"]');
    if (meta) meta.setAttribute('content', t === 'claro' ? 'light' : 'dark');
    return t;
  }
  function guardado() { try { return temaValido(localStorage.getItem(LS)); } catch (_) { return POR_OMISION; } }
  function guardar(id) {
    const t = aplicar(id);
    try { if (t === POR_OMISION) localStorage.removeItem(LS); else localStorage.setItem(LS, t); } catch (_) { /* modo privado */ }
    return t;
  }
  aplicar(guardado());
  root.PanelTemas = Object.assign({ aplicar, guardar, actual: () => temaValido(document.documentElement.getAttribute('data-tema')) }, api);
})(typeof window !== 'undefined' ? window : globalThis);
