# CLAUDE.md — DEACERO Play Lite

Contexto del proyecto para Claude Code. La documentación para personas está en **README.md** (único lugar de documentación); aquí solo va
lo que un agente necesita para trabajar bien. **Repositorio público:** nunca escribir aquí (ni en ningún archivo versionado) claves, IPs,
nombres de equipos, usuarios, nóminas reales ni datos de red internos.

## Qué es
Reproductor de música por géneros para la planta (pantallas, kiosco y un panel por persona). Node ≥ 18, **cero dependencias de npm**,
sin build, sin base de datos (JSON en `DATA_DIR`). La música sale de YouTube vía `yt-dlp`; el servidor hace de proxy del audio.
Corre en una Raspberry Pi 4B (lenta: nada de blur, sombras animadas ni trabajo pesado en el navegador) y en PCs con Windows.

## Comandos
```bash
npm start                         # http://localhost:8000  (lee .env y DATA_DIR/.env)
node --test                       # ~560 pruebas, sin red. Deben quedar TODAS en verde
node scripts/humo.js --navegador  # arranca el servidor real con datos temporales y abre /panel en Edge/Chromium sin ventana
node scripts/respaldo.js respaldar|restaurar
node scripts/recortar-iconos.js   # tras usar un icono nuevo de Font Awesome en el panel
```
La prueba «la matriz entera tarda poco» (test/bienestar.test.js) mide tiempo: falla si el equipo está muy cargado. No subir su umbral.

## Mapa
| Dónde | Qué |
|---|---|
| `server.js` | arranque: crea y conecta todo (env, yt-dlp, radio, IA, calentador, horario, anuncios) |
| `src/policy.js` | **tabla ÚNICA** de rutas: método, nivel (`publico`/`oyente`/`usuario`/`clave`), `needs:'sid'`, tope de cuerpo. Ruta nueva = fila nueva aquí (hay prueba de cobertura) |
| `src/server.js` | HTTP: Host permitido, Origin=Host en escrituras, nivel, límites de ritmo, estáticos y CSP del panel |
| `src/radio.js` | elige género/canción por sesión (`sid`); la sesión principal = pantallas. Oyente: búsqueda/canción elegida → racha «semilla» (más como esto); lo pedido descarta precargas en fila (`STALE`); comprueba 3 a la vez. Toda pista se **sondea** antes de darla; el oyente recibe **al instante** una ya resuelta por el calentador si la hay (darle pistas sin comprobar = «Reintentando…» y saltos) |
| `src/calentador.js` | precalienta (busca + resuelve) géneros en segundo plano: es lo que hace instantáneo el cambio de género |
| `src/bienestar.js` | Viaje ISO: curva de energía + **CARACTERES** curados por fase (la energía de `genres.json` es gruesa: no elegir solo por número) |
| `src/ia/` | Gemini (`GEMINI_KEY`, solo por cabecera) con respaldo local automático; el local prefiere géneros familiares |
| `src/horario.js`, `anuncios.js`, `ajustes.js`, `diagnostico.js`, `adminroutes.js` | administración de las pantallas |
| `src/users.js`, `sessions.js`, `authroutes.js`, `library.js`, `meroutes.js` | cuenta por nómina (sin contraseña) y favoritos |
| `public/panel-completo.html` + `public/js/panel/` | `/panel`: diseño del DEACERO Play anterior. Motor de audio = iframe oculto `/?view=local&sid=…` (`app.js`, `window.__player`) |
| `public/remote.html` + `remote.js` | `/remote` (control) y `/panel/simple` (panel viejo) |
| `public/index.html` + `app.js` | `/` y `/kiosco` (pantallas) |
| `deploy/windows/`, `deploy/` | instaladores (Windows: `install.ps1`; Pi: servicio de usuario, sin sudo) |

## Decisiones vigentes (no reabrir sin que el usuario lo pida)
- Cuenta **opcional**, entrar **solo con número de nómina**, sin contraseña. **Las cuentas no se pueden borrar desde la app.** Lista opcional `DATA_DIR/nominas-permitidas.txt`.
- IA = **Gemini** (de pago) con motor local de respaldo; la clave solo en `.env` / `DATA_DIR/.env` (este último solo acepta una lista corta de variables).
- `/panel` = panel completo (`PANEL_PRINCIPAL=simple` lo revierte); `/panel/simple` = el de siempre. `/`, `/kiosco`, `/remote` y el comando `play` no cambian de comportamiento.
- Horario y anuncios afectan **solo a las pantallas**, nunca a los oyentes del panel.
- Sin fuentes externas (Audius, Jamendo, Radio Browser, «Radio en vivo»): todo local salvo yt-dlp, lrclib y Gemini.
- Diseño: el del DEACERO Play anterior (negro, naranja `#F59B23`, Inter, Font Awesome alojados en `public/assets/vendor/`). 6 temas, todos AA.
- 5 oyentes simultáneos esperados.

## Reglas de trabajo
- Pruebas primero (deben fallar sin el cambio); nada de saltar/borrar pruebas, quitar aserciones, bajar umbrales ni silenciar checks.
- La lógica del navegador que se pueda probar va en archivos puros (`logica.js`, `radio-logica.js`, `escucha-logica.js`, `admin-logica.js`) con `test/panel-*.test.js`.
- UI nueva → auditoría de accesibilidad AA; auth/datos/admin → revisión de seguridad. Solo `textContent` para datos externos (títulos, letras, nombres).
- Commit/push/despliegue solo cuando el usuario lo pida. No instalar la app en el PC de desarrollo (solo en los equipos destino).
- Antes de cada push: buscar en lo que se sube claves (`AIza…`), IPs y nombres internos.

## Trampas conocidas
- `robocopy /XF nombre` y `/XD nombre` excluyen en **cualquier** carpeta: excluir datos y `vendor` por **ruta** (ya pasó: se perdió `data/seed/podcasts.json`). Hay prueba (`test/instalador.test.js`).
- Quitar el sondeo NO acorta por sí solo el tiempo hasta que suena (resolver la URL hace falta igual): lo que lo acorta es el precalentado.
- Algunas redes corporativas bloquean `googlevideo.com`: el servidor arranca y busca, pero no suena. Para medir audio real, hacerlo en el equipo destino.
- La Pi puede tener el reloj atrasado (sin NTP): `src/timesync.js` corrige la hora mostrada; certificados «aún no válidos» hacen fallar pistas.
- PowerShell 5.1 lee mal los `.ps1` sin BOM: los textos de los `.ps1` van sin acentos.
