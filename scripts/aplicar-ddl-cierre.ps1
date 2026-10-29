<#
  Aplica docs/schema-supabase-cierre-catalogos.sql al proyecto de Supabase.

  POR QUE ESTE ENVOLTORIO Y NO SOLO EL COMANDO. La contraseña de postgres tiene
  que llegarle al proceso sin quedar escrita en un archivo ni en el historial de
  PowerShell: psReadLine guarda historial de TODO lo que se teclea, y un
  `$env:SUPABASE_DB_PASSWORD = '...'` se queda ahí en texto plano para siempre.

  DE DONDE SACA LA CONTRASEÑA. Por defecto del PORTAPAPELES, no de un prompt.
  MEDIDO 2026-09-29: `Read-Host -AsSecureString` no hace eco de NADA (ni un
  asterisco) y en una consola anidada devuelve vacío al instante si pulsa Enter,
  con el único síntoma de un "Falta SUPABASE_DB_PASSWORD" que parece un fallo del
  programa. Es una caja negra: no hay forma de saber si está esperando. Con el
  portapapeles no hay que teclear un secreto a ciegas; se copia, se ejecuta, y el
  script lo BORRA del portapapeles al terminar. El portapapeles es de por si
  legible por otros procesos, así que dejarlo ahí con la contraseña puesta sería
  peor que leerla y limpiarla.

    Copia la contraseña, y luego:
      powershell -NoProfile -File scripts\aplicar-ddl-cierre.ps1
      powershell -NoProfile -File scripts\aplicar-ddl-cierre.ps1 -Teclado   # prompt enmascarado

  QUE APLICA. El DDL de cierre de catálogos: completa las columnas que el esquema
  desplegado no puede representar, crea machine_planning_overrides
  (RULE-SUP-017) y amplía la whitelist de public.ingesta_mirror. Es
  IDEMPOTENTE: se puede volver a correr sin daño.

  QUE NO HACE. No imprime la contraseña. No la escribe en disco. No la deja en el
  historial. No abre escritura a `anon`.
#>
[CmdletBinding()]
param(
  [string]$Archivo = 'docs/schema-supabase-cierre-catalogos.sql',
  [switch]$Si,
  [switch]$Teclado,
  [switch]$Diagnosticar
)

$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot
$ruta = Join-Path $raiz $Archivo
if (-not (Test-Path $ruta)) { Write-Host "No existe: $ruta" -ForegroundColor Red; exit 1 }

function Limpiar-Buffer([IntPtr]$p) {
  if ($p -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p) | Out-Null }
}

# ---------------------------------------------------------------------------
# 1. La contraseña
# ---------------------------------------------------------------------------
$seguro = $null
$origen = ''

if (-not $Teclado) {
  $pegado = $null
  try { $pegado = Get-Clipboard -Raw -ErrorAction Stop } catch { $pegado = $null }
  if ($pegado) { $pegado = $pegado.Trim() }
  if ($pegado) {
    Write-Host '  Contrasena tomada del portapapeles.' -ForegroundColor DarkGray
    $seguro = ConvertTo-SecureString -String $pegado -AsPlainText -Force
    $pegado = $null
    $origen = 'portapapeles'
  } else {
    Write-Host '  El portapapeles estaba vacio o no se pudo leer.' -ForegroundColor Yellow
    Write-Host '  Copia la contrasena y vuelve a correrlo, o usa  -Teclado  para teclearla.' -ForegroundColor Yellow
    exit 4
  }
} else {
  # Prompt enmascarado con ReadKey: cada tecla confirma con un asterisco, para que
  # se vea que el prompt avanza. ReadKey exige consola real: si la entrada esta
  # redirigida lanza, y ahi se dice en vez de colgarse.
  Write-Host ''
  Write-Host '  Teclea la contrasena; cada tecla sale un asterisco. Enter al terminar.' -ForegroundColor Cyan
  $sb = New-Object System.Text.StringBuilder
  try {
    while ($true) {
      $k = [Console]::ReadKey($true)
      if ($k.Key -eq [ConsoleKey]::Enter) { break }
      if ($k.Key -eq [ConsoleKey]::Escape) { [void]$sb.Clear(); Write-Host "`n  cancelado."; exit 0 }
      if ($k.Key -eq [ConsoleKey]::Backspace) {
        if ($sb.Length -gt 0) { [void]$sb.Remove($sb.Length - 1, 1); Write-Host "`b `b" -NoNewline }
        continue
      }
      if (-not [char]::IsControl($k.KeyChar)) { [void]$sb.Append($k.KeyChar); Write-Host '*' -NoNewline }
    }
  } catch {
    Write-Host ''
    Write-Host "  No se puede leer el teclado: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host '  Sin consola real no hay prompt. Copia la contrasena al portapapeles y' -ForegroundColor Red
    Write-Host '  corre el script SIN -Teclado.' -ForegroundColor Red
    exit 2
  }
  Write-Host ''
  $plano = $sb.ToString()
  [void]$sb.Clear()
  $seguro = ConvertTo-SecureString -String $plano -AsPlainText -Force
  $plano = $null
  $origen = 'teclado'
}

$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($seguro)
$clave = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)

# Una clave vacia llegaba al aplicador como SUPABASE_DB_PASSWORD='' y el unico
# síntoma era "Falta SUPABASE_DB_PASSWORD", que parece un fallo del script y no
# de quien lo ejecuto. Se comprueba aqui. El largo no es un secreto; la clave si.
if ([string]::IsNullOrWhiteSpace($clave)) {
  Limpiar-Buffer $bstr
  Write-Host ''
  Write-Host '  Llego VACIA. No se aplico nada.' -ForegroundColor Yellow
  exit 3
}
if ($clave.Length -lt 8) {
  Limpiar-Buffer $bstr
  Write-Host ''
  Write-Host "  Solo llegaron $($clave.Length) caracteres: no parece una contrasena de Supabase." -ForegroundColor Yellow
  Write-Host '  No se aplico nada. Copia la contrasena COMPLETA (sin espacios al inicio o al final).' -ForegroundColor Yellow
  exit 3
}
Write-Host "  Contrasena de $($clave.Length) caracteres (origen: $origen). No se imprime." -ForegroundColor DarkGray

# ---------------------------------------------------------------------------
# 2. Que se va a aplicar, y confirmacion
# ---------------------------------------------------------------------------
Write-Host ''
if ($Diagnosticar) {
  Write-Host '  MODO DIAGNOSTICO: se ejecutara cada sentencia y se reviendra TODAS.' -ForegroundColor Cyan
  Write-Host '  No se aplica nada. Es para ver de una vez todos los fallos del DDL.' -ForegroundColor DarkGray
} else {
  Write-Host '  A aplicar:' -ForegroundColor Cyan
  Write-Host "    $Archivo"
  Write-Host "    $((Get-Item $ruta).Length) bytes, $(((Get-Content $ruta | Measure-Object -Line).Lines)) lineas"
  Write-Host '    Proyecto Supabase: xtgtfjcwxcoxvixholpj (via pooler, us-east-1)' -ForegroundColor DarkGray
  Write-Host '    Es idempotente: volver a correrlo no rompe nada.' -ForegroundColor DarkGray
}
Write-Host ''

if (-not $Si) {
  $r = (Read-Host '  Continuar? escribe s y Enter')
  if ($r.Trim().ToLower() -notin @('s', 'si', 'sí', 'y', 'yes')) {
    Limpiar-Buffer $bstr
    Write-Host ''
    Write-Host '  Cancelado. NO se aplico nada.' -ForegroundColor Yellow
    Write-Host '  Para correrlo sin confirmacion:  -Si' -ForegroundColor DarkGray
    exit 0
  }
}

# ---------------------------------------------------------------------------
# 3. Aplicar, y limpiar en finally pase lo que pase
# ---------------------------------------------------------------------------
try {
  # Solo para este proceso hijo. Nunca se escribe en disco.
  $env:SUPABASE_DB_PASSWORD = $clave
  $clave = $null
  if ($Diagnosticar) {
    & node (Join-Path $raiz 'scripts\apply-sql-supabase.mjs') $ruta '--diagnosticar'
  } else {
    & node (Join-Path $raiz 'scripts\apply-sql-supabase.mjs') $ruta
  }
  $codigo = $LASTEXITCODE
} finally {
  $env:SUPABASE_DB_PASSWORD = $null
  Remove-Item Env:\SUPABASE_DB_PASSWORD -ErrorAction SilentlyContinue
  Limpiar-Buffer $bstr
  $seguro = $null
  Write-Host ''
  Write-Host '  Variable de entorno limpia. BSTR liberado.' -ForegroundColor DarkGray
  if ($origen -eq 'portapapeles') {
    try { Set-Clipboard -Value '' -ErrorAction Stop; Write-Host '  Portapapeles borrado.' -ForegroundColor DarkGray }
    catch { Write-Host '  NO se pudo borrar el portapapeles: borralo a mano.' -ForegroundColor Yellow }
  }
}

if ($codigo -ne 0) { exit $codigo }

if ($Diagnosticar) { exit 0 }

Write-Host ''
Write-Host '  Siguiente paso (NO requiere la contrasena):' -ForegroundColor Cyan
Write-Host '    node .openchamber\diag-catalogo-payload.mjs    # debe decir 11/11 OK, sin columnas pendientes'
Write-Host '    Rota la contrasena en el panel de Supabase: viajara escrita en este chat.' -ForegroundColor Yellow
