'use strict';
/* Servidor de pruebas por HTTP: arma createServer con dependencias falsas y un cliente que guarda la cookie. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createServer } = require('../../src/server');
const { createControl } = require('../../src/control');
const { createPodcasts } = require('../../src/podcasts');
const { createClients } = require('../../src/clients');
const { createHistory } = require('../../src/history');
const { createUsers } = require('../../src/users');
const { createSessions } = require('../../src/sessions');
const { createLibrary } = require('../../src/library');

const TOKEN = 'clave-de-prueba';

function setup(over = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'play-auth-'));
  const publicDir = path.join(dir, 'public');
  fs.mkdirSync(publicDir);
  fs.writeFileSync(path.join(publicDir, 'index.html'), '<h1>hola</h1>');
  fs.writeFileSync(path.join(publicDir, 'remote.html'), '<h1>control</h1>');
  fs.writeFileSync(path.join(publicDir, 'panel-completo.html'), '<h1>completo</h1>');
  const now = { t: 1_800_000_000_000 };
  const users = createUsers({ dir, now: () => now.t });
  const sessions = createSessions({ dir, now: () => now.t });
  const library = createLibrary({ dir, now: () => now.t });
  const server = createServer({
    publicDir,
    genres: [{ id: 'jazz', label: 'Jazz', emoji: '🎷', color: '#f90', featured: true, queries: ['x'] }],
    ytdlp: { resolve: async () => ({}), version: () => '1' },
    radio: { next: async () => ({}) },
    proxy: { handle: (req, res) => { res.writeHead(200); res.end('a'); } },
    thumbs: { get: async () => null },
    control: createControl({ keepAliveMs: 0 }),
    clients: createClients({ reverse: async () => null }),
    timesync: { current: () => now.t, info: () => ({ offset: 0, synced: true }) },
    history: createHistory({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'play-h-')) }),
    podcasts: createPodcasts({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'play-p-')) }),
    episodes: async () => [],
    lyrics: { get: async () => null },
    users, sessions, library, now: () => now.t,
    token: TOKEN, trustLoopback: false,
    ...over
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    resolve({ port, dir, users, sessions, library, now, base: `http://127.0.0.1:${port}`, close: () => { server.closeAllConnections && server.closeAllConnections(); server.close(); } });
  }));
}

/* Cliente mínimo: guarda cookies y deja mandar cabeceras a mano. */
function client(port) {
  let cookie = '';
  async function call(method, url, { body, headers = {}, raw } = {}) {
    const data = raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined;
    return new Promise((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1', port, path: url, method,
        headers: { ...(data !== undefined ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}), ...(cookie ? { cookie } : {}), ...headers }
      }, (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => {
          const sc = res.headers['set-cookie'];
          if (sc) { const c = sc.find((x) => x.startsWith('pl_user=')); if (c) cookie = /^pl_user=;/.test(c) || /Max-Age=0/i.test(c) ? '' : c.split(';')[0]; }
          let json = null;
          try { json = JSON.parse(text); } catch (_) { /* no es JSON */ }
          resolve({ status: res.statusCode, headers: res.headers, text, json, setCookie: sc });
        });
      });
      req.on('error', reject);
      if (data !== undefined) req.write(data);
      req.end();
    });
  }
  return { call, hasCookie: () => !!cookie, clearCookie: () => { cookie = ''; } };
}

async function withServer(over, fn) {
  const s = await setup(over);
  try { await fn(s, client(s.port)); } finally { s.close(); }
}

module.exports = { TOKEN, setup, client, withServer };
