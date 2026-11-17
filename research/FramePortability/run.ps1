# Requires PowerShell 7, Windows, .NET SDK from global.json, Edge and an interactive desktop for Uno.
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'This four-platform experiment requires Windows (WPF and Uno Win32).' }
$repository = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$cases = Join-Path $PSScriptRoot 'cases.json'
$projects = @(
    'Html/Html.csproj',
    'Wpf/Wpf.csproj',
    'Avalonia/FigVam.FrameResearch.Avalonia.csproj',
    'Uno/Uno.csproj'
)
function Invoke-ProbeCommand([string[]] $Arguments) {
    $info = [Diagnostics.ProcessStartInfo]::new('dotnet')
    $info.WorkingDirectory = $repository
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    foreach ($argument in $Arguments) { $info.ArgumentList.Add($argument) }
    $process = [Diagnostics.Process]::Start($info)
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $stderr = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit(180000)) {
        $process.Kill($true)
        throw "Experiment timed out: $($Arguments -join ' ')"
    }
    $stdout.GetAwaiter().GetResult() | Write-Output
    $stderr.GetAwaiter().GetResult() | Write-Output
    if ($process.ExitCode -ne 0) { throw "Experiment failed with exit code $($process.ExitCode)." }
    $process.Dispose()
}
$failures = @()
foreach ($relativeProject in $projects) {
    $project = Join-Path $PSScriptRoot $relativeProject
    Write-Output "=== $relativeProject ==="
    try {
        Invoke-ProbeCommand @('restore', $project, '--locked-mode')
        Invoke-ProbeCommand @('run', '--project', $project, '--no-restore', '--', $cases)
    }
    catch {
        $failures += "$relativeProject : $_"
        Write-Output $failures[-1]
    }
}
if ($failures.Count) { throw ($failures -join [Environment]::NewLine) }
