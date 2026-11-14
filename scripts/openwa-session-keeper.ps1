param([switch]$OpenDashboard)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$nodePath = if ($nodeCommand) { $nodeCommand.Source } else { Join-Path $env:ProgramFiles 'nodejs\node.exe' }
$mainPath = Join-Path $projectRoot 'dist\main'
$logPath = Join-Path $projectRoot 'data\openwa-session-keeper.log'
$lockPath = Join-Path $projectRoot 'data\.openwa-session-keeper.lock'
$bridgePath = Join-Path $projectRoot 'scripts\openwa-cloudflare-bridge.mjs'
$bridgeConfig = Join-Path $projectRoot 'data\openwa-cloudflare.json'

if (-not (Test-Path -LiteralPath $nodePath)) {
    throw "Node.js was not found at $nodePath."
}

try {
    $lock = [System.IO.File]::Open($lockPath, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
} catch {
    exit 0
}

function Write-KeeperLog([string]$message) {
    Add-Content -LiteralPath $logPath -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $message"
}

if ($OpenDashboard) {
    $opener = Join-Path $PSScriptRoot 'openwa-open.ps1'
    if (Test-Path -LiteralPath $opener) {
        Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', "`"$opener`"")
    }
}

while ($true) {
    try {
        $service = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
            Where-Object { $_.CommandLine -and $_.CommandLine.Contains($mainPath) } |
            Select-Object -First 1

        if (-not $service) {
            $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
            $stdout = Join-Path $projectRoot "data\openwa-start-$stamp.log"
            $stderr = Join-Path $projectRoot "data\openwa-start-$stamp-error.log"
            $started = Start-Process -FilePath $nodePath -ArgumentList @('--enable-source-maps', $mainPath) `
                -WorkingDirectory $projectRoot -WindowStyle Hidden `
                -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
            Write-KeeperLog "OpenWA service restarted (PID $($started.Id))."
            Start-Sleep -Seconds 20
        }

        if (Test-Path -LiteralPath $bridgeConfig) {
            $bridge = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
                Where-Object { $_.CommandLine -and $_.CommandLine.Contains($bridgePath) } |
                Select-Object -First 1
            if (-not $bridge) {
                $bridgeStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
                $bridgeOut = Join-Path $projectRoot "data\openwa-bridge-$bridgeStamp.log"
                $bridgeErr = Join-Path $projectRoot "data\openwa-bridge-$bridgeStamp-error.log"
                $bridgeProcess = Start-Process -FilePath $nodePath -ArgumentList @($bridgePath) `
                    -WorkingDirectory $projectRoot -WindowStyle Hidden `
                    -RedirectStandardOutput $bridgeOut -RedirectStandardError $bridgeErr -PassThru
                Write-KeeperLog "Cloudflare bridge restarted (PID $($bridgeProcess.Id))."
            }
        }
    } catch {
        Write-KeeperLog "Recovery check failed: $($_.Exception.Message)"
    }

    Start-Sleep -Seconds 15
}
