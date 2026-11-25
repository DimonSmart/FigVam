param(
    [Parameter(Mandatory)]
    [string]$AspireExecutable
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$apphost = Join-Path $root 'src/FigVam.AppHost/FigVam.AppHost.csproj'
$hostDir = Split-Path $apphost
$probe = Join-Path $hostDir 'run'
$report = Join-Path $hostDir 'tunnel-probe-report.json'
$storage = Join-Path ([System.IO.Path]::GetTempPath()) ('figvam-aspire-smoke-' + [guid]::NewGuid())
if ((Test-Path $probe) -or (Test-Path $report)) {
    throw 'Probe path already exists; refusing to overwrite.'
}

function Invoke-Aspire([string[]]$Arguments) {
    & $AspireExecutable @Arguments --apphost $apphost --non-interactive
    if ($LASTEXITCODE -ne 0) { throw "Aspire command failed: $($Arguments -join ' ')" }
}

function Wait-Probe {
    for ($i = 0; $i -lt 60; $i++) {
        if (Test-Path $report) { return Get-Content $report -Raw | ConvertFrom-Json }
        Start-Sleep -Seconds 1
    }
    throw 'The tunnel executable did not complete its MCP probe.'
}

function Assert-NotStarted {
    if (Test-Path $report) { throw 'The tunnel started without an explicit Start command.' }
}

$started = $false
try {
    Copy-Item (Join-Path $PSScriptRoot 'tunnel-probe.cjs') $probe
    $env:Storage__Directory = $storage
    $env:McpTunnel__TunnelId = 'tunnel_test'
    $env:McpTunnel__Executable = (Get-Command node.exe -CommandType Application).Source
    [Environment]::SetEnvironmentVariable('Parameters__openai-tunnel-api-key', 'figvam-fake-runtime-api-key')

    # The CLI exercises the same resource start/stop commands as Dashboard.
    Invoke-Aspire @('run', '--detach', '--no-build', '--launch-profile', 'http')
    $started = $true
    Invoke-Aspire @('wait', 'server', '--status', 'up', '--timeout', '90')
    Assert-NotStarted
    Invoke-Aspire @('resource', 'mcp-tunnel', 'start')
    $first = Wait-Probe
    Write-Host "Manual start connected to $($first.endpoint)"
    Invoke-Aspire @('resource', 'mcp-tunnel', 'stop')
    Invoke-Aspire @('wait', 'mcp-tunnel', '--status', 'down', '--timeout', '60')
    Invoke-Aspire @('wait', 'server', '--status', 'up', '--timeout', '30')
    Remove-Item $report
    Invoke-Aspire @('resource', 'mcp-tunnel', 'start')
    $second = Wait-Probe
    if ($second.pid -eq $first.pid -or $second.keyFingerprint -ne $first.keyFingerprint) {
        throw 'Restart did not preserve the AppHost transport credential in a new process.'
    }
    Invoke-Aspire @('stop')
    $started = $false
    Remove-Item $report

    Invoke-Aspire @('run', '--detach', '--no-build', '--launch-profile', 'http')
    $started = $true
    Invoke-Aspire @('wait', 'server', '--status', 'up', '--timeout', '90')
    Assert-NotStarted
    Invoke-Aspire @('resource', 'mcp-tunnel', 'start')
    $third = Wait-Probe
    if ($third.keyFingerprint -eq $first.keyFingerprint) { throw 'AppHost reused its transport credential.' }
    Write-Host 'AppHost restart rotated transport credentials; discovery and access checks passed.'
}
finally {
    if ($started) { & $AspireExecutable stop --apphost $apphost --non-interactive }
    Remove-Item $probe, $report, ($report + '.tmp') -Force -ErrorAction SilentlyContinue
    Remove-Item $storage -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item Env:Storage__Directory, Env:McpTunnel__TunnelId, Env:McpTunnel__Executable -ErrorAction SilentlyContinue
    [Environment]::SetEnvironmentVariable('Parameters__openai-tunnel-api-key', $null)
}
