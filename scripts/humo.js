#!/usr/bin/env node
'use strict';
/* humo.js — guion de humo: arranca el servidor REAL (server.js) en un puerto libre con datos temporales y comprueba que las
 * páginas existentes y el panel completo cargan con todos sus recursos. Es la red de seguridad de «mantener todo».
 *
 *   node scripts/humo.js            sin yt-dlp (rápido; no prueba que suene)
 *   node scripts/humo.js --real     usa el yt-dlp instalado y pide una canción de verdad (necesita red)
 *   node scripts/humo.js --navegador  además abre /panel/completo en Edge/Chrome/Chromium sin ventana y busca errores de JavaScript
 *
 * No instala nada; borra su carpeta temporal al terminar. Sale con código 1 si algo falla. */
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const ROOT = path.join(__dirname, '..');
const REAL = process.argv.includes('--real');
const NAVEGADOR = process.argv.includes('--navegador');
const fallos = [];
const ok = (m) => console.log('  ✓ ' + m);
const mal = (m) => { fallos.push(m); console.log('  ✗ ' + m); };

const puertoLibre = () => new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });

async function esperar(base, ms = 30000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    try { if ((await fetch(base + '/api/health')).ok) return true; } catch (_) { /* aún no */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

/* Recursos que cita una página (src/href), resueltos contra la URL de la página, solo de este mismo sitio. */
function recursos(html, url) {
  const out = new Set();
  for (const m of html.matchAll(/\s(?:src|href)="([^"#]+)"/g)) {
    const u = new URL(m[1], url);
    if (u.origin === new URL(url).origin && !u.pathname.startsWith('/api/')) out.add(u.pathname);
  }
  return [...out];
}

function buscarNavegador() {
  const cands = process.platform === 'win32'
    ? ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe']
    : ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'];
  return cands.find((c) => fs.existsSync(c)) || null;
}

(async () => {
  const datos = fs.mkdtempSync(path.join(os.tmpdir(), 'play-humo-'));
  const port = await puertoLibre();
  const base = `http://127.0.0.1:${port}`;
  const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: datos, REMOTE_TOKEN: '', GEMINI_KEY: '' };
  if (!REAL) env.YTDLP_BIN = path.join(datos, 'sin-yt-dlp'); /* no existe: arranca al instante y no sale a la red */
  const srv = spawn(process.execPath, [path.join(ROOT, 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let salida = '';
  srv.stdout.on('data', (d) => (salida += d));
  srv.stderr.on('data', (d) => (salida += d));

  try {
    console.log(`Humo en ${base} (datos en ${datos})`);
    if (!(await esperar(base))) { mal('el servidor no arrancó:\n' + salida); return; }
    ok('servidor arriba');

    const paginas = ['/', '/kiosco', '/remote', '/panel', '/panel/simple', '/panel/completo'];
    for (const p of paginas) {
      const r = await fetch(base + p);
      const html = await r.text();
      if (r.status !== 200 || !/<html/i.test(html)) { mal(`${p} → ${r.status}`); continue; }
      const malos = [];
      for (const rec of recursos(html, base + p)) { const x = await fetch(base + rec); if (x.status !== 200) malos.push(`${rec} (${x.status})`); }
      if (malos.length) mal(`${p}: recursos que no cargan: ${malos.join(', ')}`); else ok(`${p} y sus recursos`);
    }

    /* Módulos del panel que se cargan al abrir su vista (no aparecen en el HTML). */
    const dir = path.join(ROOT, 'public', 'js', 'panel');
    const perezosos = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
    const sinCargar = [];
    for (const f of perezosos) if ((await fetch(`${base}/js/panel/${f}`)).status !== 200) sinCargar.push(f);
    if (sinCargar.length) mal('módulos del panel que no cargan: ' + sinCargar.join(', ')); else ok(`${perezosos.length} módulos del panel`);

    const g = await (await fetch(base + '/api/genres')).json();
    if (Array.isArray(g) && g.length >= 400) ok(`/api/genres (${g.length})`); else mal('/api/genres');
    const adm = await fetch(base + '/api/admin/estado');
    if (adm.status === 200) ok('administración desde la propia máquina'); else mal('/api/admin/estado → ' + adm.status);
    const op = await fetch(base + '/api/bienestar/opciones');
    if (op.ok) ok('/api/bienestar/opciones'); else mal('/api/bienestar/opciones → ' + op.status);

    if (REAL) {
      const r = await fetch(`${base}/api/next?sid=humo-12345678`);
      const j = r.ok ? await r.json() : null;
      if (j && j.track) {
        ok(`canción: ${j.track.title}`);
        const a = await fetch(`${base}/api/play/${j.track.id}?mode=audio`, { headers: { range: 'bytes=0-1023' } });
        if (a.status === 206 || a.status === 200) ok('el audio se puede pedir'); else mal('/api/play → ' + a.status);
        await a.body?.cancel();
      } else mal('/api/next → ' + r.status);
    }

    if (NAVEGADOR) {
      const nav = buscarNavegador();
      if (!nav) console.log('  · sin Edge/Chrome/Chromium: se omite la prueba con navegador');
      else {
        const perfil = path.join(datos, 'perfil');
        const r = spawnSync(nav, ['--headless=new', '--disable-gpu', '--no-first-run', '--mute-audio', `--user-data-dir=${perfil}`, '--enable-logging=stderr', '--v=0', '--virtual-time-budget=8000', '--dump-dom', base + '/panel/completo'], { encoding: 'utf8', timeout: 60000 });
        const dom = r.stdout || '';
        const errores = (r.stderr || '').split('\n').filter((l) => /CONSOLE.*(Uncaught|Error)|Refused to/i.test(l));
        if (!/id="tabs"/.test(dom)) mal('el navegador no pintó el panel (¿falló JavaScript?)');
        else if (errores.length) mal('errores de JavaScript/CSP en el panel:\n    ' + errores.slice(0, 10).join('\n    '));
        else ok('panel completo en navegador sin errores de JavaScript');
      }
    }
  } finally {
    srv.kill();
    await new Promise((r) => setTimeout(r, 300));
    try { fs.rmSync(datos, { recursive: true, force: true }); } catch (_) { /* Windows puede tardar en soltar archivos */ }
    console.log(fallos.length ? `\nHUMO: ${fallos.length} fallo(s)` : '\nHUMO: todo en orden');
    process.exitCode = fallos.length ? 1 : 0;
  }
})();
