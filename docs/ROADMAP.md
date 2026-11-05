# DEACERO Play Lite — hoja de ruta

Estado a 2026-11-03 · versión `35cfd7b` (rama `main`) · 166 pruebas en verde.

Este documento recoge **qué se entregó en el primer sprint, qué quedó fuera, qué se descubrió al operarlo y qué se
sugiere hacer después**, ordenado por prioridad. No contiene IPs, nombres de equipos ni claves (el repo es público).

---

## 1. Enfoque del proyecto (el filtro para decidir)

Reproductor **personal/local** de música aleatoria por género, servido por un programa de Node sin dependencias de npm:

| Principio | Qué implica al priorizar |
|---|---|
| Un servidor en la red local, el navegador solo habla con él | Los clientes no necesitan llegar a YouTube; solo el servidor |
| Música aleatoria por género (racha de 4–6 canciones) | La experiencia por defecto es "no tocar nada" |
| Sin BD, sin login, sin Gemini "por ahora"; vía `yt-dlp` (se descartó la API oficial) | Todo lo que exija cuentas o base de datos es **decisión nueva**, no trabajo "natural" |
| Pantalla de kiosco (Pi o Windows) + control remoto web `/remote` y CLI `play` | Dos tipos de conexión: *pantalla* (reproduce) y *control* (manda órdenes) |
| Instalación sin permisos de administrador (`sudo` / admin) | Cualquier mejora que requiera privilegios se marca como dependencia de otra persona |

Los puntos de este documento que **rompen** alguno de estos principios están marcados con ⚠ y se resumen en la sección 9.

---

## 2. Qué se entregó en el primer sprint

| Área | Entregado |
|---|---|
| Reproductor | 479 géneros (79 destacados para el sorteo), racha de 4–6 canciones, búsqueda y podcasts como "pauta única" (suenan una vez y la lista sigue), letra sincronizada, modo audio/video |
| Rachas | Un género pedido a mano también dura una racha de 4–6 y luego vuelve la rotación (antes quedaba fijo para siempre) |
| Control | `/remote` (Música, Podcasts, Equipos), comando `play`, lista de pantallas y controles conectados, botón **Anunciar** |
| Kiosco | Vista `/kiosco` solo-lectura: hora 24 h, fecha, canción y siguiente; fondo con poco desenfoque; `?estirar=2` para paneles panorámicos alimentados en 16:9 |
| Locutor | Cada 20 min (`?cada=N`) suena el jingle y una voz dice la hora, bajando la música |
| Windows | `MENU.cmd` (instalar, iniciar, detener, estado, desinstalar), instalación sin administrador, puerto fijo (libera el puerto si lo ocupa un `node` más viejo), parada por árbol de procesos, arranque al iniciar sesión |
| Raspberry Pi | Servicio de usuario con `systemd`, kiosco con autoarranque, instalación sin `sudo` |
| Calidad | 166 pruebas `node:test`, README como referencia completa |

---

## 3. Qué quedó fuera del primer sprint

### 3.1 Por decisión de alcance

- **Modo público 1 a M** (cada persona con su propia música sin afectar a nadie) → sección 6.
- **Rol de solo escuchar** y claves por persona.
- **Voz del locutor elegible**, botones separados ("Radio Deacero" / "La hora") y `play announce`.
- **Hora hablada en la Pi**: la Pi no tiene motor de voz; solo suena el jingle.
- **Una pantalla con nombre y órdenes dirigidas** cuando hay varias.
- **Horarios**: género por franja, silencio fuera de horario, tope de volumen.

### 3.2 Por dependencia de otras personas (no se pueden resolver desde la app)

| Pendiente | Quién | Nota |
|---|---|---|
| **Reloj de la Pi sin sincronizar** (ver sección 4) | Quien tenga `sudo` en la Pi | Es la causa de fallos reales de reproducción |
| Reserva DHCP para la Pi y la pantalla de Windows | Redes / TI | Hoy la IP cambia y hay que redescubrirla (`play find`) |
| Carpeta de instalación vieja con perfil de navegador bloqueado | Un administrador de la pantalla de Windows | Queda un Edge elevado que impide borrarla |
| Audio de la pantalla de Windows **silenciado** en el sistema | Quien esté frente al equipo (o autorizar que se quite por SSH) | Sin esto no se oye música ni locutor |
| Arranque al encender (autologon) en Windows | Administrador | Hoy arranca al **iniciar sesión**, no al encender |
| Regla de firewall del puerto en Windows | Administrador | Hoy funciona, pero depende de cómo el sistema trate el nuevo `node.exe` |

### 3.3 Sin probar en un equipo real

- `MENU.cmd` opción 1 (instalar para todos los usuarios, con elevación) y opción 6 (desinstalar).
- `uninstall.ps1` y `estado.ps1` solo parcialmente probados.
- Despliegue a la Pi y a Windows hecho a mano (`tar` por SSH, `scp` + script); sin script repetible ni reversión automática.

### 3.4 Defectos conocidos pequeños

| Defecto | Efecto |
|---|---|
| Un `401` (falta la clave) se muestra como **"Sin conexión con YouTube — reintentando…"** | Engaña: parece un bloqueo de YouTube y es una clave ausente |
| La pantalla de Windows aparece en *Equipos* como "Pantalla de la Pi" | Solo el rótulo: supone que toda pantalla local es la Pi |
| La Pi abre la vista normal (`/?mode=audio`), no `/kiosco` | No tiene hora grande ni locutor automático |
| El estado del radio (racha, últimas 400 pistas) vive en memoria | Se pierde al reiniciar el servidor |

---

## 4. Hallazgo principal: el reloj de la Pi rompe la reproducción

**Síntoma reportado:** al buscar algo, a los 5–10 s la canción cambia por otra de la racha anterior.

**Causa raíz (medida, no supuesta):**

1. Una canción buscada que falla al reproducirse se reintenta una vez y después la app **salta a la siguiente de la cola**
   (la de la racha anterior). Es el comportamiento diseñado, pero oculta el error.
2. En una muestra de **12 búsquedas**, **6 fallaron en la Pi** (`502 fetch failed`) y **0 fallaron en la pantalla de Windows**.
3. El error de fondo en la Pi es `SSL certificate problem: certificate is not yet valid`: la Pi tenía la fecha **~7 días
   atrasada** y ciertos nodos de YouTube presentan un certificado emitido *después* de esa fecha.
4. Volver a resolver la pista no ayuda: el nodo es el mismo en 8 de 8 intentos.
5. La Pi está configurada solo con los servidores de hora públicos de Debian, que la red bloquea, y no tiene reloj de
   hardware. **Los servidores de hora internos de la empresa sí le contestan** (se comprobó por SNTP); no hace falta abrir
   ningún puerto, solo apuntar a ellos.

**Arreglo (necesita `sudo` en la Pi; sustituir por los servidores internos):**

```bash
sudo mkdir -p /etc/systemd/timesyncd.conf.d
printf '[Time]\nNTP=<ntp-interno-1> <ntp-interno-2>\n' | sudo tee /etc/systemd/timesyncd.conf.d/interno.conf
sudo systemctl restart systemd-timesyncd
timedatectl        # esperar ~1 min: "System clock synchronized: yes"
```

**Criterio de aceptación:** `timedatectl` indica sincronizado y la prueba de 12 búsquedas reproduce 12 de 12.

**Resultado (aplicado por el administrador):** el reloj quedó sincronizado con los servidores internos y desapareció el
error de certificado, **pero las búsquedas siguieron fallando** (7 de 12 y 5 de 12 en dos corridas). Los errores ahora son
otros e intermitentes: `fetch failed` / `ETIMEDOUT` del nodo de YouTube y `yt-dlp: tiempo agotado` (la misma pista responde
con curl y falla un momento después). La Pi no está saturada; el Wi-Fi está en −65 dBm y resolver una pista tarda 5–14 s,
mientras Windows no falló en ninguna. Conclusión: el reloj era *una* causa, no la única; el enlace de la Pi con YouTube es
inestable. Pendiente: probar con cable o más cerca del punto de acceso para confirmar.

**Por qué importa más allá de la Pi:** cada vez que YouTube rota certificados, una Pi sin hora correcta pierde más nodos.
El README ya avisa de que "la hora puede ir atrasada", pero no de que esto **rompe canciones**.

---

## 5. Propuesta para el siguiente sprint

Esfuerzo: **S** < ½ día · **M** 1–2 días · **L** 3–5 días.

### P0 — hacer primero (corrigen fallos o riesgos reales)

| # | Tarea | Esfuerzo | Criterio de aceptación |
|---|---|---|---|
| 1 | ~~Sincronizar el reloj de la Pi (sección 4)~~ **hecho**; falta probar con cable/mejor señal (sección 4, resultado) | S + permisos | 12/12 búsquedas reproducen |
| 2 | **Salud del reloj** en `/api/health` (hora del equipo vs hora real) y aviso visible en `/remote` ("reloj atrasado N días: algunas pistas no cargarán") | S | Con el reloj desfasado el aviso aparece; con hora correcta no |
| 3 | ~~**Búsqueda resiliente**~~ **hecho en el servidor** (prueba la pista con una petición `range 0-0` antes de ofrecerla; en búsquedas prueba hasta 3 resultados y en la rotación hasta 6; las que fallan se descartan 30 min; error `NO_SOURCE` si ninguna sirve). Falta avisar en `/remote` qué falló | M | Con una pista no reproducible, suena otro resultado de la búsqueda y no la racha anterior |
| 4 | Mensaje de `401` correcto ("falta la clave"), no "sin conexión con YouTube" | S | Abrir la IP sin clave muestra qué falta |
| 5 | **Seguridad de la clave**: rotarla, revisar controles desconocidos en *Equipos*, aceptarla por cabecera/cookie en vez de `?t=` (queda en historial y registros) | S–M | La clave no aparece en la URL tras el primer acceso |
| 6 | Operativo: quitar el silencio de Windows, autologon, reservas DHCP, borrar la carpeta vieja | S + permisos | Tras reiniciar el equipo, suena sin intervención |
| 7 | **Despliegue repetible**: un script por plataforma con verificación posterior (salud, versión, jugadores conectados) y reversión | M | Un comando despliega; si falla la verificación, vuelve a la versión anterior |

### P1 — valor claro, depende de decisiones

| # | Tarea | Esfuerzo | Nota |
|---|---|---|---|
| 8 | Locutor: voz elegible por equipo (`-Voz`) con **respaldo local** si la voz en línea falla; botones separados; `play announce` | M | Hoy, si la voz en línea falla, solo suena el jingle |
| 9 | Hora hablada en la Pi con **clips pregrabados** (frases y horas generadas una vez) | M | Evita depender de voces del sistema; misma voz en Pi y Windows |
| 10 | La Pi abre `/kiosco` (hora grande + locutor automático) | S | Cambio de una línea en el autoarranque |
| 11 | **Modo público 1 a M** y **rol de solo escuchar** | L + M | Sección 6 |
| 12 | Contador "N conectados" en `/remote` y nombre **opcional** por pantalla | S–M | ⚠ Decisión previa: no pedir nombre en la web |
| 13 | Pruebas e2e con Chrome sin ventana (los guiones de verificación ya existen) + integración continua mínima | M | Hoy solo hay pruebas unitarias y de API |

### P2 — backlog alineado con el enfoque

- **Horarios**: género por franja (mañana tranquila, tarde movida), silencio fuera de horario laboral, tope de volumen.
- **No me gusta / saltar y no repetir** este artista o género; lista de géneros bloqueados.
- **Favoritos** y "qué sonó hoy" (historial de reproducción, solo lectura).
- **Anuncios programados adicionales** (frases de la empresa a ciertas horas), reutilizando el mecanismo del locutor.
- **Cola visible** en `/remote` (qué viene) y **código QR** en la pantalla para abrir `/remote` desde el celular.
- **Varias pantallas** con nombre propio y órdenes dirigidas a una sola.
- Persistir en disco las últimas 400 pistas y la racha, para sobrevivir a reinicios.
- Alerta cuando fallen N pistas seguidas (hoy solo se ve el aviso en pantalla).

---

## 6. Modo público (1 a M) junto al kiosco (1 a 1)

**Requisito:**

| Servicio | Quién | Comportamiento |
|---|---|---|
| **Kiosco 1 a 1** | Una pantalla con su `/remote` | Lo que existe hoy: un radio compartido |
| **Público 1 a M** | Cada persona desde su navegador | Cada quien con su música, sin afectar a nadie; el administrador ve quién está conectado |

**Por qué hoy no funciona con un solo servidor:** hay un único radio por servidor. Varias páginas de reproducción le piden
canción al mismo radio, se "roban" pistas, la racha se parte y las órdenes de `/remote` llegan a todas. Las órdenes se
reparten a **todas** las pantallas conectadas.

**Diseño sugerido (un servidor, una sesión por persona):**

1. Cada página pública genera un identificador y el servidor crea **un radio por identificador** (el estado por radio es
   pequeño: la racha y un conjunto de pistas recientes). `yt-dlp` y el proxy de audio se comparten.
2. Las pantallas de kiosco usan el radio por defecto; **las órdenes de `/remote` y el estado se dirigen solo a ellas**.
3. `/api/clients` ya distingue pantallas y controles; se amplía con la sesión y su nombre opcional.
4. Un rol de **solo escuchar** con clave aparte: puede reproducir y ver el estado, no puede mandar órdenes.

**Alternativa de bajo costo para empezar:** una copia del programa por persona, cada una con su puerto y su carpeta de datos. No
requiere cambiar código, pero cuesta memoria y trabajo de `yt-dlp` por copia.

**Colocación en la red (decisión de redes, no de la app):**

- El servidor público necesita **salida a YouTube** y que **lo alcancen** quienes lo usen. Los clientes **no** necesitan YouTube.
- Si el servidor público vive en el segmento del kiosco, desde las otras redes de la empresa hace falta ruta y regla de firewall.
- Para uso en casa: otra instancia en la red de casa. **No se recomienda** exponer el servidor de la empresa a internet.

**Capacidad:** cada oyente cuesta ancho de banda y procesador del servidor. Para 3–10 personas basta un PC normal; la Pi no es
adecuada. Para decenas de personas hay que dimensionar.

**Variante "radio de verdad":** una línea de tiempo compartida en la que todos oyen lo mismo a la vez. Es el cambio más
grande (reloj del servidor, sincronización de cada oyente) y solo conviene si ese es el objetivo.

---

## 7. Deuda técnica

| Tema | Detalle |
|---|---|
| Interfaz sin pruebas | `public/js/app.js` (~720 líneas) concentra toda la lógica de la página; solo se prueba la parte pura (`util.js`) |
| Scripts de PowerShell | Se probaron con guiones ad hoc, no hay pruebas automatizadas |
| Pruebas manuales repetibles | Los guiones de verificación (búsquedas, anuncios, formato en 7" y panorámico) deberían entrar al repositorio |
| `yt-dlp` | Se actualiza a mano (la Pi no llega a GitHub ni a PyPI); falta un procedimiento y una alerta |
| Sin versionado | No hay número de versión ni CHANGELOG; `/api/health` no informa qué commit corre |
| Texto en `app.js` y `remote.js` | Mezcla de mensajes de error y de estado; centralizarlos facilitaría corregirlos (p. ej. el de `401`) |

---

## 8. Riesgos

| Riesgo | Mitigación sugerida |
|---|---|
| `yt-dlp` incumple los términos de servicio de YouTube (decisión de uso personal) y **más oyentes = más exposición** | Antes de abrir el modo público a otras personas, valorarlo con Ciberseguridad/legal; reconsiderar la API oficial si el uso crece |
| Una sola clave para todo | Rotarla, claves por rol (P1) y no pasarla en la URL (P0) |
| La red cambia (DHCP, segmentos) | Reservas de IP, nombre DNS estable |
| YouTube cambia algo y se rompen pistas | Alertas de fallos seguidos, procedimiento de actualización de `yt-dlp` |
| Despliegues manuales | Scripts con verificación y reversión (P0 #7) |

---

## 9. Decisiones que se necesitan

1. **¿Modo público?** ¿Cuántas personas, en qué red, y quién aprueba (Ciberseguridad/redes)? Define si basta una copia por persona o hace falta la sesión por persona.
2. ⚠ **Nombre en la web:** la decisión previa fue *no pedirlo*. Para saber **quiénes** están conectados en el modo público, ¿se acepta un nombre **opcional**, o solo contar por equipo/IP?
3. ⚠ **Cuentas/BD:** el rol de solo escuchar con clave compartida es el mínimo. Si se quieren cuentas reales, es un proyecto distinto (login y base de datos, hoy fuera del enfoque).
4. **Voz del locutor:** ¿cuál (mujer/hombre, local o en línea)? Los clips pregrabados dejan la voz fija.
5. **Pi:** ¿abrir `/kiosco` (hora grande + locutor) o mantener la vista normal?
6. **Responsables de las dependencias** de la sección 3.2 (reloj, DHCP, audio, administrador de Windows).

---

## 10. Fuera de alcance por decisión previa (no hacer sin que se pida)

- Base de datos, inicio de sesión, integración con Gemini.
- Sustituir `yt-dlp` por la API oficial de YouTube.
- Pedir el nombre del usuario en la web como requisito.
- Instalar nada que exija permisos de administrador/`sudo` como paso obligatorio de la app.
