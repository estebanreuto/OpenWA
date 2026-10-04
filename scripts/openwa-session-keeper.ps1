$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$mainPath = Join-Path $projectRoot 'dist\main'
$logPath = Join-Path $projectRoot 'data\openwa-session-keeper.log'
$lockPath = Join-Path $projectRoot 'data\.openwa-session-keeper.lock'

try {
    $lock = [System.IO.File]::Open($lockPath, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
} catch {
    exit 0
}

function Write-KeeperLog([string]$message) {
    Add-Content -LiteralPath $logPath -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $message"
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
    } catch {
        Write-KeeperLog "Recovery check failed: $($_.Exception.Message)"
    }

    Start-Sleep -Seconds 15
}
