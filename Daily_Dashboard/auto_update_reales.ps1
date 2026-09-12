<#
auto_update_reales.ps1
=======================
Automatización diaria de "reales" del Daily Dashboard:
  1) Corre daily_sync.py (Datalake -> JSON -> Drive)
  2) Si hay cambios de código pendientes en Daily_Dashboard/, los commitea y pushea a GitHub
  3) clasp push + clasp deploy -i <deploymentId> -> publica una versión nueva
     en el MISMO deployment (misma URL /exec)

Pensado para Task Scheduler. Cada paso corta la cadena si el anterior falla,
así nunca se publica a producción algo que vino de una corrida de datos rota.

Ver Daily_Dashboard/logs/ para el historial de corridas.
#>

# NO usar "Stop" acá: con *>> $logFile (mezcla stdout+stderr), PowerShell 5.1 envuelve
# cada línea de stderr de un ejecutable nativo en un ErrorRecord — y "Stop" la trata
# como error terminante aunque el proceso haya salido con exit code 0. git commit/push
# (y a veces clasp) escriben su resumen normal por stderr, así que un push EXITOSO
# cortaba el script ahí mismo, salteándose clasp push/deploy sin que nadie lo notara
# (bug real, 2026-09-12: el log mostraba "NativeCommandError" con el propio mensaje de
# éxito de git como texto). Cada paso ya chequea $LASTEXITCODE a mano — es esa
# comprobación la que debe frenar la corrida, no $ErrorActionPreference.
$ErrorActionPreference = "Continue"

$repoRoot   = Split-Path $PSScriptRoot -Parent
$dashDir    = Join-Path $repoRoot "Daily_Dashboard"
$logsDir    = Join-Path $dashDir "logs"
$today      = Get-Date -Format "yyyy-MM-dd"
$logFile    = Join-Path $logsDir "auto_update_$today.log"

# Deployment fijo (Web App) de Daily Dashboard — clasp deploy -i lo actualiza
# in-place, sin cambiar la URL /exec que ya tienen los usuarios.
$deploymentId = "AKfycbwMR3zk1r4uwui8vGtcmz0OwmeehC5JM8cuJRE3H-GQMfvxXWGTkYQ3R2nVjMyeAdX_1A"

New-Item -ItemType Directory -Force -Path $logsDir | Out-Null

function Log($msg) {
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
    Write-Output $line
    Add-Content -Path $logFile -Value $line
}

function Fail($msg) {
    Log "ERROR: $msg"
    Log "=== Corrida ABORTADA ==="
    exit 1
}

Log "=== Inicio actualización de reales ==="

# ------------------------------------------------------------------
# 1) Refrescar datos (Datalake -> Drive JSON). No toca código versionado.
# ------------------------------------------------------------------
Set-Location $repoRoot
Log "Corriendo daily_sync.py..."
python "$dashDir\daily_sync.py" *>> $logFile
if ($LASTEXITCODE -ne 0) { Fail "daily_sync.py falló (exit $LASTEXITCODE). No se toca git ni clasp." }
Log "daily_sync.py OK"

# ------------------------------------------------------------------
# 2) Publicar cambios de código pendientes, SOLO dentro de Daily_Dashboard/.
#    (No se tocan otros módulos por si tienen cambios manuales en curso.)
# ------------------------------------------------------------------
$changes = git -C $repoRoot status --porcelain -- Daily_Dashboard
if ($changes) {
    Log "Cambios detectados en Daily_Dashboard/:"
    Log ($changes -join "`n")

    git -C $repoRoot add Daily_Dashboard
    if ($LASTEXITCODE -ne 0) { Fail "git add falló." }

    $commitMsg = "chore(daily-dashboard): auto-update reales $today"
    git -C $repoRoot commit -m $commitMsg *>> $logFile
    if ($LASTEXITCODE -ne 0) { Fail "git commit falló." }

    git -C $repoRoot push origin main *>> $logFile
    if ($LASTEXITCODE -ne 0) { Fail "git push falló. No se despliega a producción sin código sincronizado." }

    Log "git commit + push OK ($commitMsg)"
} else {
    Log "Sin cambios de código en Daily_Dashboard/, se salta git commit/push."
}

# ------------------------------------------------------------------
# 3) clasp push + clasp deploy -i (misma URL /exec, versión nueva)
# ------------------------------------------------------------------
Set-Location $dashDir

Log "clasp push..."
clasp push --force *>> $logFile
if ($LASTEXITCODE -ne 0) { Fail "clasp push falló." }

Log "clasp deploy -i $deploymentId ..."
clasp deploy -i $deploymentId -d "auto-update reales $today" *>> $logFile
if ($LASTEXITCODE -ne 0) { Fail "clasp deploy falló." }

Log "=== Corrida OK ==="
