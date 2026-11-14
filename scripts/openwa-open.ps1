param(
    [switch]$NoOpen,
    [ValidateRange(1, 600)][int]$TimeoutSeconds = 180
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$port = 2785
$environmentFile = Join-Path $root '.env'
if (Test-Path -LiteralPath $environmentFile) {
    foreach ($line in [System.IO.File]::ReadLines($environmentFile)) {
        if ($line -match '^\s*PORT\s*=\s*["'']?(\d+)') { $port = [int]$Matches[1]; break }
    }
}
if ($port -lt 1 -or $port -gt 65535) { throw 'El puerto de OpenWA no es valido.' }
$baseUrl = "http://localhost:$port"

function Test-OpenWAReady {
    try {
        $health = Invoke-RestMethod -Uri "$baseUrl/api/health" -TimeoutSec 3
        return $health.status -eq 'ok'
    } catch { return $false }
}

if (-not (Test-OpenWAReady)) {
    Write-Host 'OpenWA esta iniciando. Espera un momento, no necesitas volver a abrirlo.'
    $keeper = Join-Path $PSScriptRoot 'openwa-session-keeper.ps1'
    Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', "`"$keeper`"")
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while (-not (Test-OpenWAReady)) {
        if ((Get-Date) -ge $deadline) {
            Write-Error "OpenWA sigue iniciando o necesita revision. No se elimino ni desvinculo ninguna sesion. Revisa data\openwa-session-keeper.log."
            exit 1
        }
        Start-Sleep -Seconds 2
    }
}

Write-Output "$baseUrl/sessions"
if (-not $NoOpen) { Start-Process -FilePath "$baseUrl/sessions" }
