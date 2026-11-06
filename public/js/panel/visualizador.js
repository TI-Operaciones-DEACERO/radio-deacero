/* visualizador.js — visualizador a pantalla completa con 8 modos. Se carga al abrirlo.
   NO analiza el audio: conectar WebAudio al <audio> del motor (createMediaElementSource) solo se puede hacer una vez, app.js ya lo
   usa en su vista normal y si el contexto falla deja la música muda. Por eso se anima con datos sintéticos guiados por el estado
   del motor (sonando/pausa) y la energía del género (/api/genres → energy). En equipos lentos o con movimiento reducido arranca quieto. */
(function () {
  'use strict';
  const P = window.Panel, h = P.h, E = window.EscuchaLogica;
  const LS_MODO = 'pl_vis_modo';

  let dlg, canvas, ctx, sel, bAnimar, aviso, modo = E.modoVisValido(P.store.get(LS_MODO));
  let animando = false, raf = 0, ultimo = 0, energias = null, focoPrevio = null, particulas = [];
  const reducido = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const lento = () => E.dispositivoLento({ reducido: reducido(), nucleos: navigator.hardwareConcurrency, memoria: navigator.deviceMemory });

  async function cargarEnergias() {
    if (energias) return;
    energias = {};
    const r = await P.api.generos();
    if (r.ok && Array.isArray(r.data)) for (const g of r.data) if (g && typeof g.id === 'string' && Number.isFinite(g.energy)) energias[g.id] = g.energy;
  }
  function energiaActual(s) { const g = s && s.genre && s.genre.id; return energias && g && Number.isFinite(energias[g]) ? energias[g] : 0.5; }
  const estadoMotor = () => { const p = P.player(); try { return p ? p.getState() : null; } catch (_) { return null; } };
  const color = (n, d) => (getComputedStyle(document.documentElement).getPropertyValue(n).trim() || d);

  function crear() {
    canvas = h('canvas', { class: 'vis-lienzo', role: 'img', 'aria-label': 'Visualizador decorativo' });
    ctx = canvas.getContext('2d');
    sel = h('select', { id: 'visModo' }, E.MODOS_VIS.map((m) => h('option', { value: m.id, text: m.nombre, selected: m.id === modo })));
    sel.addEventListener('change', () => { modo = E.modoVisValido(sel.value); P.store.set(LS_MODO, modo); particulas = []; canvas.setAttribute('aria-label', 'Visualizador decorativo, modo ' + sel.options[sel.selectedIndex].text); if (!animando) dibujar(performance.now()); });
    /* sin aria-pressed: el texto ya dice qué hace (Animar / Pausar animación); los dos juntos se leerían contradictorios */
    bAnimar = h('button', { type: 'button', class: 'ghost corto', text: 'Animar', onclick: () => (animando ? parar() : iniciar()) });
    aviso = h('p', { class: 'capa-estado', role: 'status' });
    const cerrar = h('button', { type: 'button', class: 'ico ghost-ico', 'aria-label': 'Cerrar el visualizador', title: 'Cerrar (Esc)', onclick: () => dlg.close() }, P.icono('close', 22));
    dlg = h('dialog', { id: 'visual', class: 'capa vis', 'aria-labelledby': 'visTitulo' }, [
      h('div', { class: 'capa-cab' }, [
        h('h2', { id: 'visTitulo', class: 'capa-t', text: 'Visualizador' }),
        h('div', { class: 'capa-acc' }, [h('label', { for: 'visModo', class: 'sr-only', text: 'Modo del visualizador' }), sel, bAnimar, cerrar])
      ]),
      aviso, canvas
    ]);
    dlg.addEventListener('close', () => { parar(); const f = focoPrevio; focoPrevio = null; if (f && f.focus && document.contains(f)) f.focus(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) cancelAnimationFrame(raf); else if (animando) raf = requestAnimationFrame(cuadro); });
    document.body.appendChild(dlg);
  }

  function iniciar() {
    animando = true;
    bAnimar.textContent = 'Pausar animación';
    aviso.textContent = '';
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(cuadro);
  }
  function parar() {
    animando = false;
    cancelAnimationFrame(raf);
    if (bAnimar) bAnimar.textContent = 'Animar';
  }
  function cuadro(ts) {
    if (!animando || !dlg.open) return;
    raf = requestAnimationFrame(cuadro);
    if (ts - ultimo < 33) return; /* ~30 cuadros por segundo: suficiente y más ligero para la Pi */
    ultimo = ts;
    dibujar(ts);
  }

  function ajustar() {
    const r = canvas.getBoundingClientRect();
    const k = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width * k)), hh = Math.max(1, Math.round(r.height * k));
    if (canvas.width !== w || canvas.height !== hh) { canvas.width = w; canvas.height = hh; }
  }

  function dibujar(ts) {
    ajustar();
    const s = estadoMotor();
    const activo = !!(s && s.track && !s.paused);
    const t = ts / 1000;
    const W = canvas.width, H = canvas.height, cx = W / 2, cy = H / 2;
    const ac = color('--accent', '#F59B23'), tx = color('--accent-text', '#F59B23'), bg = color('--bg', '#000');
    const n = modo === 'nivel' ? 2 : modo === 'puntos' ? 48 : 40;
    const v = E.nivelesSinteticos(t, n, energiaActual(s), activo);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = ac; ctx.strokeStyle = tx; ctx.lineWidth = Math.max(2, W / 400);
    const bw = W / n;
    switch (modo) {
      case 'barras': v.forEach((x, i) => { const bh = x * H * 0.9; ctx.fillRect(i * bw + bw * 0.15, H - bh, bw * 0.7, bh); }); break;
      case 'espejo': v.forEach((x, i) => { const bh = x * H * 0.45; ctx.fillRect(i * bw + bw * 0.15, cy - bh, bw * 0.7, bh * 2); }); break;
      case 'onda':
        ctx.beginPath();
        v.forEach((x, i) => { const y = cy + Math.sin(t * 3 + i * 0.5) * x * H * 0.4; if (i) ctx.lineTo(i * bw + bw / 2, y); else ctx.moveTo(bw / 2, y); });
        ctx.stroke(); break;
      case 'circulo': {
        const r0 = Math.min(W, H) * 0.18;
        v.forEach((x, i) => { const a = (i / n) * Math.PI * 2 - Math.PI / 2, r1 = r0 + x * Math.min(W, H) * 0.3; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.stroke(); });
        break;
      }
      case 'anillos':
        for (let i = 0; i < 6; i++) { const x = v[i * 6] || 0; ctx.globalAlpha = 0.25 + 0.75 * x; ctx.beginPath(); ctx.arc(cx, cy, (i + 1) * Math.min(W, H) * 0.07 * (0.7 + x * 0.6), 0, Math.PI * 2); ctx.stroke(); }
        ctx.globalAlpha = 1; break;
      case 'puntos': {
        const filas = 6;
        v.forEach((x, i) => { for (let f = 0; f < filas; f++) { if (x * filas < f) continue; ctx.beginPath(); ctx.arc(i * bw + bw / 2, H - (f + 0.5) * (H / filas) * 0.9, Math.max(2, bw * 0.3), 0, Math.PI * 2); ctx.fill(); } });
        break;
      }
      case 'particulas': {
        const media = v.reduce((a, b) => a + b, 0) / v.length;
        if (activo && particulas.length < 120) for (let k = 0; k < 3; k++) particulas.push({ x: Math.random() * W, y: H + 10, vy: -(1 + media * 6) * (W / 600), r: 2 + Math.random() * 4 * (W / 600) });
        particulas = particulas.filter((p) => (p.y += p.vy) > -10);
        particulas.forEach((p) => { ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); });
        break;
      }
      case 'nivel': {
        const w2 = W * 0.6, x0 = (W - w2) / 2;
        v.forEach((x, i) => { ctx.fillRect(x0, cy - H * 0.12 + i * H * 0.14, w2 * x, H * 0.1); });
        ctx.strokeRect(x0, cy - H * 0.12, w2, H * 0.24);
        break;
      }
      default: break;
    }
  }

  async function abrir() {
    if (!dlg) crear();
    if (!dlg.open) { focoPrevio = document.activeElement; dlg.showModal(); }
    sel.focus();
    await cargarEnergias();
    if (lento()) {
      parar();
      aviso.textContent = reducido() ? 'Tienes activado «reducir movimiento»: el visualizador queda quieto. Toca «Animar» si quieres verlo moverse.' : 'Este equipo es modesto: el visualizador arranca quieto para no trabar la música. Toca «Animar» si quieres verlo moverse.';
      dibujar(performance.now());
    } else iniciar();
  }

  P.modulos.visualizador = { abrir, cerrar: () => { if (dlg && dlg.open) dlg.close(); }, abierto: () => !!(dlg && dlg.open) };
})();
