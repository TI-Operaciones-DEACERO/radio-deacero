/* locutor-logica.js — lógica pura (sin DOM, voz ni red) de tres cosas del panel que hacen más amable la espera:
   · el aviso «Estás escuchando Radio Deacero» (cuándo suena y cuál es el primer momento en que ya suena la música nueva),
   · los mensajes de espera del loader (cada vez más claros según pasa el tiempo),
   · cuándo se permite el miniclip de los banners y desde dónde arranca.
   Se prueba con node:test (test/panel-locutor.test.js). */
(function (root) {
  'use strict';

  /* ¿Ya SUENA la música que se pidió? s = getState() del motor; idAntes = canción que sonaba al pedir ('' si ninguna). Es el primer
     momento en que se oye lo nuevo: ahí la voz (si sigue hablando) baja la música en vez de pisarla. */
  function primerSonido(idAntes, s) {
    if (!s || !s.track || typeof s.track.id !== 'string' || !s.track.id) return false;
    if (s.loading || s.paused) return false;
    if (!(Number(s.time) > 0.3)) return false;
    return s.track.id !== idAntes;
  }

  /* ¿Puede hablar el locutor? Respeta el silencio de la persona: apagado en Apariencia, música silenciada o volumen en 0 (WCAG 1.4.2). */
  function debeHablar(o) {
    return !!o && o.activo === true && o.silenciado !== true && Number.isFinite(o.volumen) && o.volumen > 0;
  }
  /* El aviso «Estás escuchando Radio Deacero» (el mismo de / y /kiosco) suena una sola vez: al empezar a escuchar. */
  const debeJingle = (o) => debeHablar(o) && o.yaSono !== true;
  /* La voz sigue el volumen que la persona puso (0–1). */
  const volumenVoz = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.min(1, Math.max(0, n / 100)) : 0; };

  const DUCK = 0.25; /* volumen relativo de la música mientras habla la voz */
  const nivelDuck = (habla) => (habla ? DUCK : 1);

  /* — mensajes de espera del loader — */
  function mensajeEspera(base, seg) {
    const s = Number.isFinite(seg) && seg > 0 ? seg : 0;
    const texto = typeof base === 'string' && base.trim() ? base : 'Un momento, ya casi…';
    if (s < 4) return texto;
    if (s < 10) return 'Afinando la mejor canción para ti…';
    if (s < 20) return 'Esto está tardando un poco más de lo normal, pero sigue en marcha…';
    return 'Sigue en marcha. Si quieres, toca «Ocultar»: la música sonará en cuanto esté lista.';
  }

  /* — miniclip de los banners — */
  const CLIP_SEG = 5; /* WCAG 2.2.2: un movimiento automático de más de 5 s necesita control; así no hace falta */
  /* Solo con ratón (en el celular no hay «pasar el cursor»), sin «reducir movimiento» y sin ahorro de datos. */
  const puedeMiniclip = (e) => !!e && e.hover === true && e.reducido !== true && e.ahorro !== true;
  /* Segundo desde el que arranca el clip: ~25 % de la canción (máx. 30 s) para saltarse la intro; si es muy corta, desde el principio. */
  function inicioClip(dur) {
    if (!Number.isFinite(dur) || dur < CLIP_SEG * 2) return 0;
    return Math.min(30, Math.round(dur * 0.25));
  }

  const api = { primerSonido, debeHablar, debeJingle, volumenVoz, DUCK, nivelDuck, mensajeEspera, CLIP_SEG, puedeMiniclip, inicioClip };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PanelLocutor = api;
})(typeof window !== 'undefined' ? window : globalThis);
