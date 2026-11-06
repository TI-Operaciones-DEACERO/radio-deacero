# install.ps1 - instala DEACERO Play Lite en un PC con Windows (sin administrador).
#
#   powershell -ExecutionPolicy Bypass -File deploy\windows\install.ps1
#
# Que hace (todo en la carpeta del usuario, nada de Program Files):
#   1. Usa el Node y el yt-dlp que ya haya; si no, descarga una copia portatil (nodejs.org / GitHub).
#   2. Copia la app a  <InstallDir>\app  y guarda sus datos aparte (<InstallDir>\data).
#   3. Crea accesos en la carpeta Inicio: el servidor y (opcional) el navegador en pantalla completa arrancan solos al iniciar sesion.
#   4. Arranca todo y muestra las direcciones y la clave de control remoto.
# Vuelve a ejecutarlo para actualizar (conserva la clave y los datos). Para quitarlo: uninstall.ps1.
# Los textos van sin acentos a proposito: PowerShell 5.1 lee mal los .ps1 sin BOM.

param(
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'RadioDeacero'),
  [int]$Port = 8000,
  [ValidateSet('normal', 'kiosco')][string]$View = 'normal',   # vista de la pantalla: reproductor normal o /kiosco (video difuminado + reloj)
  [ValidateSet('audio', 'video')][string]$Mode = 'audio',      # arranca en solo musica o con video
  [string]$Token = '',                                         # clave del control remoto (si se omite se genera una)
  [ValidateRange(1, 4)][int]$Estirar = 1,                      # panel panoramico alimentado en 16:9 y estirado a lo ancho: 2 = el doble (las letras salen con su forma)
  [switch]$NoKiosk,        # solo servidor: no abrir el navegador en pantalla completa
  [switch]$NoAutostart,    # no crear accesos en Inicio (pruebas)
  [switch]$NoStart,        # no arrancar al terminar
  [switch]$LocalOnly,      # solo este equipo (sin control desde la red)
  [string]$StartupDir = [Environment]::GetFolderPath('Startup'),
  [string]$LogFile = ''    # guarda todo lo que se muestra en este archivo (lo usa INSTALAR.cmd)
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest mucho mas rapido

if ($LogFile) { Start-Transcript -Path $LogFile -Force | Out-Null }
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$source = (Resolve-Path (Join-Path $here '..\..')).Path
function Say($m) { Write-Host "  $m" }
function Step($m) { Write-Host ""; Write-Host "== $m" -ForegroundColor Cyan }

if (-not (Test-Path (Join-Path $source 'server.js'))) { throw "No encuentro server.js en $source. Ejecuta este script desde la carpeta del proyecto (deploy\windows)." }

# ---------------------------------------------------------------- parar lo que ya corra
# Se reconocen por el NOMBRE de la carpeta + palabras propias (run-server, server.js...), no por la ruta completa:
# Windows guarda la ruta a veces en forma corta (USUAR~1) y a veces larga, y no coincidirian.
function Stop-Radio {
  param([string]$Dir)
  $leaf = Split-Path $Dir -Leaf
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine -like "*$leaf*" -and $_.Name -match 'powershell|node|msedge|chrome' -and ($_.CommandLine -match 'run-server|run-kiosk|server\.js|radio-kiosk-profile') } |
    ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch { } }
  # Un usuario sin administrador no puede consultar procesos (Get-CimInstance da "Acceso denegado"): se paran por el PID que guardan run-server/run-kiosk.
  if (Test-Path (Join-Path $here 'detener.ps1')) { & (Join-Path $here 'detener.ps1') -InstallDir $Dir -SoloPorPID -Silencioso }
  Start-Sleep -Seconds 1
}

Step 'Preparando la carpeta'
Stop-Radio -Dir $InstallDir
foreach ($d in @('', 'app', 'bin', 'logs', 'data')) { New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir $d) | Out-Null }
New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir 'radio-kiosk-profile') | Out-Null
Say "Carpeta de instalacion: $InstallDir"
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($isAdmin) {
  # Instalado por un administrador (p. ej. en ProgramData), la app corre luego con el usuario que inicie sesion, que puede no ser administrador:
  # necesita escribir sus datos, su log y el perfil del navegador. S-1-5-32-545 = grupo "Usuarios" (funciona en cualquier idioma de Windows).
  foreach ($d in @('data', 'logs', 'radio-kiosk-profile')) { & icacls (Join-Path $InstallDir $d) /grant '*S-1-5-32-545:(OI)(CI)M' /Q | Out-Null }
  Say 'Permisos de escritura dados al grupo Usuarios en data, logs y el perfil del navegador.'
}

# ---------------------------------------------------------------- Node
Step 'Node.js'
$nodePath = $null
$sys = Get-Command node -ErrorAction SilentlyContinue
if ($sys) {
  $v = (& $sys.Source -v) -replace '^v', ''
  if ([int]($v.Split('.')[0]) -ge 18) { $nodePath = $sys.Source; Say "Se usa el Node del sistema: v$v ($nodePath)" }
}
if (-not $nodePath) {
  $portable = Join-Path $InstallDir 'node\node.exe'
  $vendorNode = Join-Path $source 'vendor\node'
  if (-not (Test-Path $portable) -and (Test-Path (Join-Path $vendorNode 'node.exe'))) {
    Say 'Se usa el Node incluido en el paquete (sin descargar).'
    if (Test-Path (Join-Path $InstallDir 'node')) { Remove-Item (Join-Path $InstallDir 'node') -Recurse -Force }
    Copy-Item $vendorNode (Join-Path $InstallDir 'node') -Recurse -Force
  }
  if (-not (Test-Path $portable)) {
    Say 'No hay Node 18 o mayor: se descarga una copia portatil (nodejs.org)...'
    $ver = 'v22.11.0'
    try {
      $idx = Invoke-RestMethod -UseBasicParsing 'https://nodejs.org/dist/index.json'
      $pick = $idx | Where-Object { $_.lts -and $_.version -like 'v22.*' } | Select-Object -First 1
      if ($pick) { $ver = $pick.version }
    } catch { Say "No pude consultar la ultima version; se usa $ver" }
    $zip = Join-Path $env:TEMP "node-$ver-win-x64.zip"
    Invoke-WebRequest -UseBasicParsing "https://nodejs.org/dist/$ver/node-$ver-win-x64.zip" -OutFile $zip
    $tmp = Join-Path $env:TEMP "node-extract-$([guid]::NewGuid().ToString('N').Substring(0,8))"
    Expand-Archive -Path $zip -DestinationPath $tmp -Force
    if (Test-Path (Join-Path $InstallDir 'node')) { Remove-Item (Join-Path $InstallDir 'node') -Recurse -Force }
    # COPIAR, no mover: mover conserva los permisos de la carpeta temporal de quien instala (solo el y los administradores) y los demas
    # usuarios no podrian ejecutar Node despues de reiniciar. Copiar hereda los permisos de la carpeta de instalacion.
    Copy-Item (Join-Path $tmp "node-$ver-win-x64") (Join-Path $InstallDir 'node') -Recurse -Force
    Remove-Item $zip, $tmp -Recurse -Force -ErrorAction SilentlyContinue
  }
  $nodePath = $portable
  Say "Node portatil: $((& $nodePath -v)) ($nodePath)"
}

# ---------------------------------------------------------------- yt-dlp
Step 'yt-dlp'
$ytOk = $false
$ytSys = Get-Command yt-dlp -ErrorAction SilentlyContinue
if ($ytSys) { $ytOk = $true; Say "Se usa el yt-dlp del sistema: $((& $ytSys.Source --version))" }
if (-not $ytOk) {
  foreach ($py in @('python', 'py')) {
    $p = Get-Command $py -ErrorAction SilentlyContinue
    if ($p) { try { $out = (& $p.Source -m yt_dlp --version 2>$null); if ($LASTEXITCODE -eq 0 -and $out) { $ytOk = $true; Say "Se usa yt-dlp de Python ($py): $out"; break } } catch { } }
  }
}
if (-not $ytOk) {
  $exe = Join-Path $InstallDir 'bin\yt-dlp.exe'
  $vendorYt = Join-Path $source 'vendor\bin\yt-dlp.exe'
  if (Test-Path $vendorYt) { Say 'Se usa el yt-dlp incluido en el paquete (sin descargar).'; Copy-Item $vendorYt $exe -Force }
  if (-not (Test-Path $exe)) {
    Say 'Se descarga yt-dlp.exe (GitHub)...'
    try { Invoke-WebRequest -UseBasicParsing 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' -OutFile $exe }
    catch { Say "AVISO: no pude descargar yt-dlp ($($_.Exception.Message)). Instalalo a mano (python -m pip install -U yt-dlp) o copia yt-dlp.exe a $InstallDir\bin y vuelve a ejecutar."; }
  }
  if (Test-Path $exe) { try { Say "yt-dlp portatil: $((& $exe --version))"; $ytOk = $true } catch { Say 'AVISO: yt-dlp.exe no arranca en este equipo.' } }
}
if (-not $ytOk) { Say 'AVISO: sin yt-dlp la app arranca pero no puede reproducir musica.' }

# ---------------------------------------------------------------- app
Step 'Copiando la aplicacion'
# Nunca se copian claves (.env) ni datos de personas de la carpeta de origen: viven en <InstallDir>\data (se conserva al actualizar; la clave de Gemini va en <InstallDir>\data\.env)
$null = robocopy $source (Join-Path $InstallDir 'app') /MIR /NFL /NDL /NJH /NJS /NP /XD .git test docs node_modules vendor users anuncios respaldos /XF podcasts.json history.json users.json sessions.json horario.json ajustes.json anuncios.json nominas-permitidas.txt .env .gitignore .gitattributes
if ($LASTEXITCODE -ge 8) { throw "robocopy fallo (codigo $LASTEXITCODE)" }
Say "App copiada a $InstallDir\app"
if ($isAdmin) {
  # Repara permisos de una instalacion anterior: node, bin y app deben heredar los de la carpeta de instalacion (Usuarios: leer y ejecutar).
  foreach ($d in @('node', 'bin', 'app')) { $p = Join-Path $InstallDir $d; if (Test-Path $p) { & icacls $p /reset /T /C /Q | Out-Null } }
  Say 'Permisos de node, bin y app restablecidos (todos los usuarios pueden ejecutarlos).'
}
Copy-Item (Join-Path $here 'run-server.ps1') (Join-Path $InstallDir 'run-server.ps1') -Force
Copy-Item (Join-Path $here 'run-kiosk.ps1') (Join-Path $InstallDir 'run-kiosk.ps1') -Force

# ---------------------------------------------------------------- configuracion (se conserva la clave al actualizar)
Step 'Configuracion'
$cfgFile = Join-Path $InstallDir 'config.json'
$old = $null
if (Test-Path $cfgFile) { try { $old = Get-Content $cfgFile -Raw | ConvertFrom-Json } catch { } }
# Al actualizar se conserva lo que ya estaba (puerto, vista, modo, alcance) salvo lo que se indique de nuevo.
if ($old) {
  if (-not $PSBoundParameters.ContainsKey('Port') -and $old.port) { $Port = [int]$old.port }
  if (-not $PSBoundParameters.ContainsKey('View') -and $old.view) { $View = [string]$old.view }
  if (-not $PSBoundParameters.ContainsKey('Mode') -and $old.mode) { $Mode = [string]$old.mode }
  if (-not $PSBoundParameters.ContainsKey('Estirar') -and $old.estirar) { $Estirar = [int]$old.estirar }
  if (-not $PSBoundParameters.ContainsKey('LocalOnly') -and $old.host -eq '127.0.0.1') { $LocalOnly = [switch]$true }
}
if (-not $Token) {
  if ($old -and $old.token) { $Token = $old.token }
  elseif (-not $LocalOnly) {
    # Generador criptografico (Get-Random no lo es): 24 caracteres alfanumericos (~140 bits)
    $bytes = New-Object byte[] 24; $rng = [Security.Cryptography.RandomNumberGenerator]::Create(); $rng.GetBytes($bytes); $rng.Dispose()
    $abc = [char[]]'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    $Token = -join ($bytes | ForEach-Object { $abc[$_ % $abc.Length] })
  }
}
$bind = '0.0.0.0'; if ($LocalOnly) { $bind = '127.0.0.1' }
if (-not $PSBoundParameters.ContainsKey('NoKiosk') -and $old -and $old.kiosk -eq $false) { $NoKiosk = [switch]$true }
$cfg = [ordered]@{ port = $Port; host = $bind; token = $Token; view = $View; mode = $Mode; estirar = $Estirar; kiosk = (-not $NoKiosk); node = $nodePath }
$cfg | ConvertTo-Json | Set-Content -Path $cfgFile -Encoding ASCII
Say "Puerto $Port, escucha en $bind, vista '$View', modo '$Mode'$(if ($Estirar -gt 1) { ", estirada x$Estirar" })"

# ---------------------------------------------------------------- accesos de inicio
Step 'Arranque automatico'
function New-Startup($name, $script) {
  $lnk = Join-Path $StartupDir "$name.lnk"
  $sh = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
  $sh.TargetPath = (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe')
  $sh.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""
  $sh.WorkingDirectory = $InstallDir
  $sh.WindowStyle = 7
  $sh.Description = 'DEACERO Play Lite'
  $sh.Save()
  Say "Acceso creado: $lnk"
}
if ($NoAutostart) { Say 'Omitido (-NoAutostart).' }
else {
  New-Item -ItemType Directory -Force -Path $StartupDir | Out-Null
  New-Startup 'RadioDeacero-Servidor' (Join-Path $InstallDir 'run-server.ps1')
  if ($NoKiosk) {
    $k = Join-Path $StartupDir 'RadioDeacero-Pantalla.lnk'; if (Test-Path $k) { Remove-Item $k -Force }
    Say 'Sin pantalla completa (-NoKiosk): solo el servidor.'
  } else { New-Startup 'RadioDeacero-Pantalla' (Join-Path $InstallDir 'run-kiosk.ps1') }
}

# ---------------------------------------------------------------- cortafuegos (solo si se puede)
Step 'Acceso desde la red'
if ($LocalOnly) { Say 'Solo este equipo (-LocalOnly).' }
else {
  $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if ($admin) {
    Get-NetFirewallRule -DisplayName 'Radio Deacero' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    New-NetFirewallRule -DisplayName 'Radio Deacero' -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Domain, Private | Out-Null
    Say "Regla de firewall creada para el puerto $Port (redes de dominio y privadas)."
  } else {
    Say "Sin permisos de administrador: Windows puede preguntar si permite la conexion la primera vez que arranque (aceptar)."
    Say "o ejecuta una vez, como administrador:  New-NetFirewallRule -DisplayName 'Radio Deacero' -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Domain,Private"
  }
}

# ---------------------------------------------------------------- arrancar
if ($NoStart) { Say 'No se arranca (-NoStart).' }
elseif ($isAdmin) {
  # Arrancado desde aqui, el servidor y la pantalla correrian con permisos de administrador y los demas usuarios no podrian pararlos.
  Say 'Instalado como administrador: no se arranca desde esta ventana. Arrancalo con "Iniciar" desde una ventana normal (o al iniciar sesion).'
}
else {
  Step 'Arrancando'
  $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  Start-Process $ps -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', "`"$(Join-Path $InstallDir 'run-server.ps1')`"" -WindowStyle Hidden
  $up = $false
  for ($i = 0; $i -lt 40 -and -not $up; $i++) {
    Start-Sleep -Seconds 1
    try { $r = Invoke-RestMethod -UseBasicParsing "http://127.0.0.1:$Port/api/health" -TimeoutSec 2; if ($r.ok) { $up = $true } } catch { }
  }
  if ($up) { Say "Servidor listo (yt-dlp: $($r.ytdlp))." } else { Say "AVISO: el servidor no respondio en 40 s. Revisa $InstallDir\logs\server.log" }
  if ($up -and -not $NoAutostart -and -not $NoKiosk) {
    Start-Process $ps -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', "`"$(Join-Path $InstallDir 'run-kiosk.ps1')`"" -WindowStyle Hidden
    Say 'Pantalla completa lanzada (para salir: Alt+F4; se vuelve a abrir sola hasta que ejecutes uninstall.ps1 o cierres sesion).'
  }
}

# ---------------------------------------------------------------- resumen
Step 'Listo'
$ips = @(Get-NetIPConfiguration -ErrorAction SilentlyContinue | Where-Object { $_.IPv4DefaultGateway -and $_.IPv4Address } | ForEach-Object { $_.IPv4Address.IPAddress })
Say "En este equipo:   http://localhost:$Port/        (vista kiosco: http://localhost:$Port/kiosco)"
if (-not $LocalOnly) {
  foreach ($ip in $ips) { Say "Desde la red:      http://${ip}:$Port/remote?t=$Token" }
  Say "Clave de control remoto: $Token"
}
Say "Logs: $InstallDir\logs\server.log"
if ($LogFile) { Stop-Transcript | Out-Null }
