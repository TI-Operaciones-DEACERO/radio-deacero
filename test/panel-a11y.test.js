'use strict';
/* Accesibilidad de la barra de reproducción del panel: teclado en la barra de progreso y texto del volumen (radio-logica.js). */
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../public/js/panel/radio-logica');

test('valorConTecla: las flechas mueven 5 s y Re Pág / Av Pág 30 s (no el 0.1 % nativo)', () => {
  /* canción de 200 s: 1 s = 5 unidades del deslizador */
  assert.equal(R.valorConTecla('ArrowRight', 500, 200), 525);
  assert.equal(R.valorConTecla('ArrowUp', 500, 200), 525);
  assert.equal(R.valorConTecla('ArrowLeft', 500, 200), 475);
  assert.equal(R.valorConTecla('ArrowDown', 500, 200), 475);
  assert.equal(R.valorConTecla('PageUp', 500, 200), 650);
  assert.equal(R.valorConTecla('PageDown', 500, 200), 350);
});

test('valorConTecla: Inicio y Fin; no se sale de 0–1000', () => {
  assert.equal(R.valorConTecla('Home', 700, 200), 0);
  assert.equal(R.valorConTecla('End', 10, 200), 1000);
  assert.equal(R.valorConTecla('ArrowLeft', 10, 200), 0);
  assert.equal(R.valorConTecla('PageUp', 990, 200), 1000);
  assert.equal(R.valorConTecla('ArrowRight', 5000, 200), 1000); /* valor fuera de rango */
  assert.equal(R.valorConTecla('ArrowRight', 'basura', 200), 25);
});

test('valorConTecla: otras teclas o sin duración → null (el navegador hace lo suyo)', () => {
  assert.equal(R.valorConTecla('Tab', 500, 200), null);
  assert.equal(R.valorConTecla('a', 500, 200), null);
  assert.equal(R.valorConTecla('toString', 500, 200), null);
  assert.equal(R.valorConTecla('ArrowRight', 500, 0), null);
  assert.equal(R.valorConTecla('ArrowRight', 500, NaN), null);
  assert.equal(R.valorConTecla(undefined, 500, 200), null);
});

test('textoVolumen: porcentaje y estado de silencio para aria-valuetext', () => {
  assert.equal(R.textoVolumen(85, false), '85 %');
  assert.equal(R.textoVolumen('40', true), '40 %, silenciado');
  assert.equal(R.textoVolumen(150, false), '100 %');
  assert.equal(R.textoVolumen(-3, false), '0 %');
  assert.equal(R.textoVolumen(undefined, false), '0 %');
});
