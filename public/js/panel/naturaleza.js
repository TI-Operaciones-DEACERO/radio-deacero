/* naturaleza.js — vista Naturaleza: sonidos ambientales SINTETIZADOS con WebAudio (sin archivos ni red), mezclables, con volumen
   por sonido, efectos de la capa (suavizar = filtro, espacio = reverberación) y temporizador. Se suma a la música: usa su propio
   AudioContext y nunca toca el <audio> del motor. El balance con la música usa la orden 'volume' que el motor ya tiene. */
(function () {
  'use strict';
  const P = window.Panel, h = P.h, E = window.EscuchaLogica;
  const LS_MEZCLA = 'pl_naturaleza', LS_FX = 'pl_naturaleza_fx';

  let ac = null, maestro, filtro, seco, humedo, reverb, entrada;
  const activos = {};      /* id → { gain, parar() } */
  let mezcla = leerMezcla();
  let fx = leerFx();
  let finTemporizador = 0, relojTemp = 0;
  const els = {};

  function leerMezcla() { try { return E.limpiarMezcla(JSON.parse(P.store.get(LS_MEZCLA) || 'null')); } catch (_) { return {}; } }
  function leerFx() {
    try {
      const x = JSON.parse(P.store.get(LS_FX) || 'null') || {};
      const n = (v, d) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d);
      return { maestro: n(x.maestro, 0.7), suavizar: n(x.suavizar, 0), espacio: n(x.espacio, 0.2) };
    } catch (_) { return { maestro: 0.7, suavizar: 0, espacio: 0.2 }; }
  }
  const guardar = () => { P.store.set(LS_MEZCLA, JSON.stringify(mezcla)); P.store.set(LS_FX, JSON.stringify(fx)); };
  const vol = (id) => (Object.prototype.hasOwnProperty.call(mezcla, id) ? mezcla[id] : 0.6);

  /* ───────────── grafo de audio (se crea en el primer toque: los navegadores no dejan sonar sin gesto) ───────────── */
  function contexto() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return ac; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    ac = new Ctx();
    maestro = ac.createGain(); maestro.gain.value = fx.maestro;
    entrada = ac.createGain();
    filtro = ac.createBiquadFilter(); filtro.type = 'lowpass';
    seco = ac.createGain(); humedo = ac.createGain();
    reverb = ac.createConvolver();
    const n = Math.round(ac.sampleRate * 2.5), ir = ac.createBuffer(2, n, ac.sampleRate);
    for (let c = 0; c < 2; c++) ir.getChannelData(c).set(E.impulsoReverb(n, 3, Math.random));
    reverb.buffer = ir;
    entrada.connect(filtro);
    filtro.connect(seco); seco.connect(maestro);
    filtro.connect(reverb); reverb.connect(humedo); humedo.connect(maestro);
    maestro.connect(ac.destination);
    aplicarFx();
    return ac;
  }
  function aplicarFx() {
    if (!ac) return;
    const t = ac.currentTime;
    maestro.gain.setTargetAtTime(fx.maestro, t, 0.05);
    filtro.frequency.setTargetAtTime(20000 * Math.pow(400 / 20000, fx.suavizar), t, 0.05); /* 0 = sin filtro (20 kHz) · 1 = 400 Hz */
    seco.gain.setTargetAtTime(1 - fx.espacio * 0.6, t, 0.05);
    humedo.gain.setTargetAtTime(fx.espacio * 1.2, t, 0.05);
  }

  const buffers = {};
  function ruidoBuf(tipo) {
    if (buffers[tipo]) return buffers[tipo];
    const n = ac.sampleRate * 4, b = ac.createBuffer(1, n, ac.sampleRate);
    b.getChannelData(0).set(E.ruido(tipo, n, Math.random));
    return (buffers[tipo] = b);
  }
  function fuente(tipo) { const s = ac.createBufferSource(); s.buffer = ruidoBuf(tipo); s.loop = true; s.loopStart = Math.random(); return s; }
  function lfo(frec, profundidad, destino) { const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = frec; g.gain.value = profundidad; o.connect(g); g.connect(destino); o.start(); return o; }
  function filtroDe(tipo, frec, q) { const f = ac.createBiquadFilter(); f.type = tipo; f.frequency.value = frec; if (q) f.Q.value = q; return f; }
  function cadena(nodos) { for (let i = 0; i < nodos.length - 1; i++) nodos[i].connect(nodos[i + 1]); }

  /* Cada sonido: nodos → gain propio → entrada de la capa. Devuelve lo que hay que detener. */
  const RECETAS = {
    lluvia(salida) {
      const s = fuente('blanco'), hp = filtroDe('highpass', 500), lp = filtroDe('lowpass', 7000), g = ac.createGain(); g.gain.value = 0.45;
      cadena([s, hp, lp, g, salida]);
      const s2 = fuente('rosa'), bp = filtroDe('bandpass', 2600, 1.2), g2 = ac.createGain(); g2.gain.value = 0.25; /* repiqueteo */
      cadena([s2, bp, g2, salida]);
      const o = lfo(0.23, 0.08, g.gain);
      s.start(); s2.start();
      return [s, s2, o];
    },
    olas(salida) {
      const s = fuente('marron'), lp = filtroDe('lowpass', 900), g = ac.createGain(); g.gain.value = 0.5;
      cadena([s, lp, g, salida]);
      const o = lfo(0.09, 0.42, g.gain), o2 = lfo(0.09, 500, lp.frequency); /* va y viene cada ~11 s */
      s.start();
      return [s, o, o2];
    },
    viento(salida) {
      const s = fuente('rosa'), bp = filtroDe('bandpass', 500, 0.8), g = ac.createGain(); g.gain.value = 0.55;
      cadena([s, bp, g, salida]);
      const o = lfo(0.07, 320, bp.frequency), o2 = lfo(0.13, 0.3, g.gain);
      s.start();
      return [s, o, o2];
    },
    bosque(salida) {
      const s = fuente('rosa'), hp = filtroDe('highpass', 1800), g = ac.createGain(); g.gain.value = 0.06; /* hojas */
      cadena([s, hp, g, salida]);
      s.start();
      let vivo = true, t = 0;
      function trino() {
        if (!vivo) return;
        const ahora = ac.currentTime, base = 2200 + Math.random() * 1800, veces = 2 + Math.floor(Math.random() * 4);
        for (let k = 0; k < veces; k++) {
          const t0 = ahora + k * 0.13, o = ac.createOscillator(), e = ac.createGain();
          o.type = 'sine';
          o.frequency.setValueAtTime(base, t0); o.frequency.exponentialRampToValueAtTime(base * (1.3 + Math.random() * 0.4), t0 + 0.08);
          e.gain.setValueAtTime(0.0001, t0); e.gain.exponentialRampToValueAtTime(0.18, t0 + 0.015); e.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.1);
          o.connect(e); e.connect(salida);
          o.start(t0); o.stop(t0 + 0.12);
        }
        t = setTimeout(trino, 700 + Math.random() * 2600);
      }
      t = setTimeout(trino, 300);
      return [s, { stop() { vivo = false; clearTimeout(t); } }];
    },
    rosa(salida) { const s = fuente('rosa'), g = ac.createGain(); g.gain.value = 0.55; cadena([s, g, salida]); s.start(); return [s]; },
    marron(salida) { const s = fuente('marron'), g = ac.createGain(); g.gain.value = 0.8; cadena([s, g, salida]); s.start(); return [s]; }
  };

  function encender(id) {
    if (activos[id] || !contexto()) return !!activos[id];
    const g = ac.createGain();
    g.gain.value = 0;
    g.connect(entrada);
    const nodos = RECETAS[id](g);
    g.gain.setTargetAtTime(vol(id), ac.currentTime, 0.4); /* entra suave */
    activos[id] = { gain: g, parar() { const t = ac.currentTime; g.gain.setTargetAtTime(0, t, 0.25); setTimeout(() => { nodos.forEach((n) => { try { n.stop(); } catch (_) { /* ya parado */ } }); g.disconnect(); }, 1500); } };
    return true;
  }
  function apagar(id) { if (activos[id]) { activos[id].parar(); delete activos[id]; } }
  function apagarTodo() { Object.keys(activos).forEach(apagar); quitarTemporizador(); pintarEstado(); }

  /* ───────────── temporizador ───────────── */
  function quitarTemporizador() { finTemporizador = 0; clearInterval(relojTemp); relojTemp = 0; if (els.temp) { els.temp.value = '0'; els.resta.textContent = ''; } }
  function ponerTemporizador(min) {
    clearInterval(relojTemp); relojTemp = 0; finTemporizador = 0; els.resta.textContent = '';
    if (!min) return;
    finTemporizador = Date.now() + min * 60000;
    const tic = () => {
      const s = E.restante(finTemporizador, Date.now());
      els.resta.textContent = 'Se apaga en ' + E.fmtRestante(s);
      if (s <= 0) {
        if (ac) maestro.gain.setTargetAtTime(0, ac.currentTime, 1);
        setTimeout(() => { apagarTodo(); if (ac) maestro.gain.setTargetAtTime(fx.maestro, ac.currentTime, 0.05); }, 3500);
        clearInterval(relojTemp); relojTemp = 0;
        P.toast('Temporizador: Naturaleza se apagó. La música sigue.');
      }
    };
    tic();
    relojTemp = setInterval(tic, 1000);
  }

  /* ───────────── vista ───────────── */
  function pintarEstado() {
    const on = E.SONIDOS.filter((s) => activos[s.id]).map((s) => s.nombre);
    els.estado.textContent = on.length ? 'Sonando: ' + on.join(', ') + '.' : 'Ningún sonido encendido.';
    for (const s of E.SONIDOS) els['b-' + s.id].setAttribute('aria-pressed', String(!!activos[s.id]));
    els.todo.disabled = !on.length;
  }

  function rango(id, texto, valor, alCambiar, fmt) {
    const salida = h('output', { for: id, class: 'rango-v', text: fmt(valor) });
    /* aria-valuetext: el lector dice «60 %» (lo mismo que se ve), no un «60» sin unidad */
    const r = h('input', { type: 'range', id, min: '0', max: '100', step: '1', value: String(Math.round(valor * 100)), 'aria-valuetext': fmt(valor) });
    r.addEventListener('input', () => { const v = Number(r.value) / 100; salida.textContent = fmt(v); r.setAttribute('aria-valuetext', fmt(v)); alCambiar(v); });
    return h('div', { class: 'rango' }, [h('label', { for: id, text: texto }), h('div', { class: 'rango-fila' }, [r, salida])]);
  }
  const pct = (v) => Math.round(v * 100) + ' %';

  function tarjeta(s) {
    const b = h('button', { type: 'button', class: 'chip grande nat-b', 'aria-pressed': 'false', onclick: () => {
      if (activos[s.id]) apagar(s.id);
      else if (!encender(s.id)) { P.toastError('Este navegador no puede generar sonidos (sin WebAudio).'); return; }
      pintarEstado();
    } }, [P.emo(h('span', { class: 'chip-e' }), s.emoji), s.nombre]);
    els['b-' + s.id] = b;
    return h('li', { class: 'nat-tarjeta' }, [b, rango('nv-' + s.id, 'Volumen de ' + s.nombre.toLowerCase(), vol(s.id), (v) => {
      mezcla = Object.assign({}, mezcla, { [s.id]: v }); guardar();
      if (activos[s.id] && ac) activos[s.id].gain.gain.setTargetAtTime(v, ac.currentTime, 0.05);
    }, pct)]);
  }

  function montar(el) {
    el.classList.add('vista-int');
    els.estado = h('p', { class: 'busca-estado', role: 'status', 'aria-live': 'polite' });
    els.todo = h('button', { type: 'button', class: 'ghost', text: 'Apagar todo', onclick: () => { apagarTodo(); P.toast('Naturaleza apagada. La música sigue.'); } });
    els.temp = h('select', { id: 'natTemp' }, E.MINUTOS_TEMPORIZADOR.map((m) => h('option', { value: String(m), text: m ? m + ' minutos' : 'Sin temporizador' })));
    els.temp.addEventListener('change', () => ponerTemporizador(Number(els.temp.value)));
    els.resta = h('p', { class: 'muted', role: 'timer', 'aria-live': 'off' });
    const st = P.estado();
    const musica = rango('natMusica', 'Volumen de la música', st && Number.isFinite(st.volume) ? st.volume / 100 : 0.8, (v) => { const p = P.player(); if (p) p.handleCommand({ cmd: 'volume', set: Math.round(v * 100) }); }, pct);

    el.append(
      h('h1', { class: 'vt', text: 'Naturaleza' }),
      h('p', { class: 'hint', text: 'Sonidos ambientales generados en este equipo (sin descargas). Enciende varios para mezclarlos; se suman a la música, no la detienen.' }),
      els.estado,
      h('ul', { class: 'nat-lista', 'aria-label': 'Sonidos' }, E.SONIDOS.map(tarjeta)),
      h('div', { class: 'row izq' }, [els.todo]),
      h('section', { class: 'tarjeta', 'aria-labelledby': 'natMezT' }, [
        h('h2', { id: 'natMezT', text: 'Mezcla y efectos' }),
        h('p', { class: 'hint', text: 'Los efectos se aplican solo a los sonidos de Naturaleza.' }),
        rango('natMaestro', 'Volumen de Naturaleza', fx.maestro, (v) => { fx.maestro = v; guardar(); aplicarFx(); }, pct),
        musica,
        rango('natSuave', 'Suavizar (filtro: quita agudos)', fx.suavizar, (v) => { fx.suavizar = v; guardar(); aplicarFx(); }, pct),
        rango('natEspacio', 'Espacio (reverberación)', fx.espacio, (v) => { fx.espacio = v; guardar(); aplicarFx(); }, pct)
      ]),
      h('section', { class: 'tarjeta', 'aria-labelledby': 'natTempT' }, [
        h('h2', { id: 'natTempT', text: 'Temporizador' }),
        h('label', { for: 'natTemp', text: 'Apagar Naturaleza después de' }), els.temp, els.resta
      ])
    );
    pintarEstado();
  }

  P.vistas.naturaleza = { montar };
})();
