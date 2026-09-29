<#
  Aplica docs/schema-supabase-cierre-catalogos.sql al proyecto de Supabase.

  POR QUE ESTE ENVOLTORIO Y NO SOLO EL COMANDO. La contraseña de postgres tiene
  que llegarle al proceso sin quedar escrita en un archivo ni en el historial de
  PowerShell (psReadLine guarda historial de todo lo que se teclea, y un
  `node ... -c "...:clave..."` se queda ahí para siempre). `Read-Host
  -AsSecureString` la pide en un prompt que no eco, la convierte en memoria, la
  pasa por la variable de entorno SOLO de este proceso hijo y la borra al
  terminar. Ni disco, ni historial, ni de las variables que quedan en tu sesión.

  QUE APLICA. El DDL de cierre de catálogos: completa las columnas que el
  esquema desplegado no puede representar, crea machine_planning_overrides
  (RULE-SUP-017) y amplía la whitelist de public.ingesta_mirror. Es
  IDEMPOTENTE: se puede volver a correr sin daño.

  QUE NO HACE. No imprime la contraseña. No la guarda. No abre escritura a `anon`.
  Antes de aplicar, muestra qué va a tocar y pide confirmación.
#>
[CmdletBinding()]
param(
  [string]$Archivo = 'docs/schema-supabase-cierre-catalogos.sql',
  [switch]$Si
)

$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot
$ruta = Join-Path $raiz $Archivo

if (-not (Test-Path $ruta)) {
  Write-Host "No existe: $ruta" -ForegroundColor Red
  exit 1
}

# Sin consola interactiva no hay quien responda el prompt: Read-Host se quedaria
# colgado para siempre. Se falla rapido en vez de dejar el proceso esperando.
if (-not [Environment]::UserInteractive -or [Console]::IsInputRedirected) {
  Write-Host 'Este envoltorio necesita una consola interactiva (la contrasena se pide con Read-Host).' -ForegroundColor Red
  Write-Host 'Ejecuta esto en una ventana de PowerShell normal:' -ForegroundColor Red
  Write-Host '    powershell -NoProfile -File scripts\aplicar-ddl-cierre.ps1' -ForegroundColor Red
  Write-Host 'La contrasena no se teclea en la linea de comando a proposito: psReadLine guarda' -ForegroundColor DarkGray
  Write-Host 'historial de todo lo que se escribe, y ahi si se quedaria en texto plano.' -ForegroundColor DarkGray
  exit 2
}

Write-Host ''
Write-Host '  A aplicar:' -ForegroundColor Cyan
Write-Host "    $Archivo"
Write-Host "    $((Get-Item $ruta).Length) bytes, $(((Get-Content $ruta | Measure-Object -Line).Lines)) lineas"
Write-Host '    Proyecto Supabase: xtgtfjcwxcoxvixholpj (via pooler, region us-east-1)' -ForegroundColor DarkGray
Write-Host '    Es idempotente: volver a correrlo no rompe nada.' -ForegroundColor DarkGray
Write-Host ''

if (-not $Si) {
  $r = (Read-Host '  Continuar? escribe s y Enter').Trim().ToLower()
  if ($r -notin @('s', 'si', 'sí', 'y', 'yes')) {
    Write-Host ''
    Write-Host '  Cancelado. NO se aplico nada.' -ForegroundColor Yellow
    Write-Host '  Para correrlo sin confirmacion:  -Si   (asi solo te pide la contrasena)' -ForegroundColor DarkGray
    exit 0
  }
}

$seguro = Read-Host '  Password de postgres' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($seguro)
$clave = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)

try {
  # Solo para este proceso hijo. Nunca se escribe en disco.
  $env:SUPABASE_DB_PASSWORD = $clave
  & node (Join-Path $raiz 'scripts\apply-sql-supabase.mjs') $ruta
  $codigo = $LASTEXITCODE
} finally {
  $env:SUPABASE_DB_PASSWORD = $null
  Remove-Item Env:\SUPABASE_DB_PASSWORD -ErrorAction SilentlyContinue
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) | Out-Null
  $clave = $null
  $seguro = $null
  Write-Host ''
  Write-Host '  La variable de entorno quedo limpia en esta sesion.' -ForegroundColor DarkGray
}

if ($codigo -ne 0) { exit $codigo }

Write-Host ''
Write-Host '  Siguiente paso (no requiere la contrasena):' -ForegroundColor Cyan
Write-Host '    node .openchamber/diag-catalogo-payload.mjs   # debe decir 11/11 OK, sin columnas pendientes'
Write-Host '    Rota la contrasena en el panel de Supabase: viajara escrita en este chat.' -ForegroundColor Yellow
