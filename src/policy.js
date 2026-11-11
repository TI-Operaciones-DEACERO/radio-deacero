'use strict';
/* policy.js — tabla ÚNICA de rutas de la API: método, nivel de acceso y límite de cuerpo.
 *
 * Niveles:
 *   publico  cualquiera
 *   oyente   lo que usa quien escucha en /panel: abierto sin clave (si PANEL_PUBLICO no lo cierra); si no, pide clave.
 *            `needs: 'sid'` = además exige un id de sesión válido en ?sid= (si no, pide clave)
 *   usuario  sesión de cuenta válida (cookie pl_user)
 *   clave    REMOTE_TOKEN (o la propia máquina, loopback): pantallas, control remoto y administración
 *
 * Lo que no está aquí no existe: el servidor responde 405 (método) o 404 y NUNCA lo deja pasar sin comprobar el nivel. */

const LEVELS = ['publico', 'oyente', 'usuario', 'clave'];
const DEFAULT_BODY = 4096;

const r = (methods, re, level, extra = {}) => ({ methods: [].concat(methods), re, level, bodyLimit: DEFAULT_BODY, ...extra });

const ROUTES = [
  /* — ya existentes — */
  r('GET', /^\/api\/health$/, 'publico'),
  r('GET', /^\/api\/genres$/, 'oyente'),
  r('GET', /^\/api\/podcast\/search$/, 'oyente'),
  r('GET', /^\/api\/podcasts$/, 'oyente'),
  r('GET', /^\/api\/next$/, 'oyente', { needs: 'sid' }),
  r('GET', /^\/api\/(play|thumb)\/[^/]+$/, 'oyente'),
  r('POST', /^\/api\/podcasts$/, 'clave'),
  r('DELETE', /^\/api\/podcasts\/[a-z0-9]+$/, 'clave'),
  r(['GET', 'DELETE'], /^\/api\/history$/, 'clave'),
  r(['GET', 'POST'], /^\/api\/state$/, 'clave'),
  r('POST', /^\/api\/cmd$/, 'clave'),
  r('GET', /^\/api\/events$/, 'clave'),
  r('GET', /^\/api\/clients$/, 'clave'),
  r('GET', /^\/api\/time$/, 'clave'),
  r('GET', /^\/api\/search$/, 'clave'),
  /* Letras: desde la Fase 5 también las usa el oyente CON su id de sesión (Letras y Karaoke); sin ?sid= siguen pidiendo clave, como antes.
   * Con límite de ritmo, porque cada una consulta lrclib. */
  r('GET', /^\/api\/lyrics$/, 'oyente', { needs: 'sid' }),

  /* — Fase 5: buscar canciones (lista de resultados; cada búsqueda lanza yt-dlp: límite de ritmo) — */
  r('GET', /^\/api\/buscar$/, 'oyente', { needs: 'sid' }),

  /* — IA: recomendaciones para el oyente (cada una puede costar una llamada a Gemini: hay límite de ritmo) — */
  r('GET', /^\/api\/ia\/(ahora|momento|podcasts|artistas|playlist)$/, 'oyente'),
  /* Muestra (carátula + miniclip) del banner de un género o artista. El de artista lanza una búsqueda: pide ?sid= (o la clave) y tiene un cupo corto por IP; el sid solo lo inventa el navegador, así que lo que de verdad lo acota es ese cupo y la cola del servidor. */
  r('GET', /^\/api\/muestra$/, 'oyente'),
  r('GET', /^\/api\/ia\/(para-ti|descubrir)$/, 'oyente', { needs: 'sid' }),
  r('GET', /^\/api\/ia\/estado$/, 'clave'),

  /* — Bienestar: el viaje vive en la sesión del oyente (?sid=) — */
  r('GET', /^\/api\/bienestar\/opciones$/, 'oyente'),
  r(['POST', 'DELETE'], /^\/api\/bienestar\/viaje$/, 'oyente', { needs: 'sid' }),

  /* — cuenta (entrar solo con número de nómina) — */
  r('POST', /^\/api\/auth\/login$/, 'publico'),
  r('POST', /^\/api\/auth\/logout$/, 'publico'),
  r('GET', /^\/api\/auth\/me$/, 'publico'),
  r('POST', /^\/api\/auth\/profile$/, 'usuario'),
  r('GET', /^\/api\/auth\/export$/, 'usuario'),

  /* — biblioteca de MI cuenta (el id sale de la sesión) — */
  r(['GET', 'POST'], /^\/api\/me\/reactions$/, 'usuario'),
  r('POST', /^\/api\/me\/reactions\/merge$/, 'usuario', { bodyLimit: 131072 }),
  r(['GET', 'POST'], /^\/api\/me\/playlists$/, 'usuario'),
  r(['GET', 'PATCH', 'DELETE'], /^\/api\/me\/playlists\/[a-f0-9]{8}$/, 'usuario'),
  r('POST', /^\/api\/me\/playlists\/[a-f0-9]{8}\/tracks$/, 'usuario'),
  r('DELETE', /^\/api\/me\/playlists\/[a-f0-9]{8}\/tracks\/[A-Za-z0-9_-]{11}$/, 'usuario'),
  r(['GET', 'POST', 'DELETE'], /^\/api\/me\/history$/, 'usuario'),
  r('GET', /^\/api\/me\/taste$/, 'usuario'),
  r(['GET', 'POST'], /^\/api\/me\/prefs$/, 'usuario'),

  /* — administración de usuarios — */
  r('GET', /^\/api\/admin\/usuarios$/, 'clave'),
  r(['PATCH', 'DELETE'], /^\/api\/admin\/usuarios\/[a-f0-9]{8,32}$/, 'clave'),

  /* — Fase 6: administración del radio de las pantallas — */
  r('GET', /^\/api\/admin\/(estado|diagnostico)$/, 'clave'),
  r(['GET', 'PUT'], /^\/api\/admin\/horario$/, 'clave', { bodyLimit: 32768 }),
  r('POST', /^\/api\/admin\/horario\/generar$/, 'clave'),
  r('GET', /^\/api\/admin\/horario\/ahora$/, 'clave'),
  r(['GET', 'PUT'], /^\/api\/admin\/ajustes$/, 'clave', { bodyLimit: 16384 }),
  r(['GET', 'POST'], /^\/api\/admin\/anuncios$/, 'clave', { bodyLimit: 7 * 1024 * 1024 + 4096 }), /* mp3 de 5 MB en base64 */
  r(['PATCH', 'DELETE'], /^\/api\/admin\/anuncios\/[a-f0-9]{8}$/, 'clave'),
  r('POST', /^\/api\/admin\/anuncios\/[a-f0-9]{8}\/probar$/, 'clave'),
  /* audio del anuncio: lo piden las pantallas (clave como /api/events, no la de administración) */
  r('GET', /^\/api\/anuncio\/[a-f0-9]{8}$/, 'clave')
];

/* → la ruta que coincide con método y ruta, o null. */
function resolve(method, pathname) {
  for (const route of ROUTES) if (route.re.test(pathname) && route.methods.includes(method)) return route;
  return null;
}

/* ¿La ruta existe con algún método? (para distinguir "método no permitido" de "no existe") */
const pathExists = (pathname) => ROUTES.some((route) => route.re.test(pathname));

module.exports = { ROUTES, LEVELS, DEFAULT_BODY, resolve, pathExists };
