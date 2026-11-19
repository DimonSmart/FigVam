# Separate harness: preserve the existing HTML probe, project, cases and dependency lock.
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'This experiment requires Windows and installed Edge.' }
$repository = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$temporaryProject = Join-Path ([IO.Path]::GetTempPath()) ('FigVamHtmlClipping-' + [Guid]::NewGuid().ToString('N'))
$htmlDirectory = Join-Path $temporaryProject 'Html'
New-Item -ItemType Directory -Path $htmlDirectory | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Html/Html.csproj') -Destination $htmlDirectory
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Html/packages.lock.json') -Destination $htmlDirectory
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'HtmlClippingProbe.cs') -Destination (Join-Path $htmlDirectory 'Program.cs')
# Preserve the original project and its ../RectanglePixels.cs link exactly.
$projectPath = Join-Path $htmlDirectory 'Html.csproj'
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'RectanglePixels.cs') -Destination $temporaryProject
Write-Output ('Temporary project: ' + $temporaryProject)
Write-Output ('Original HTML lock SHA256: ' + (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'Html/packages.lock.json')).Hash)
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
    $exitCode = $process.ExitCode
    $process.Dispose()
    if ($exitCode -ne 0) { throw "Experiment failed with exit code $exitCode." }
}
Invoke-ProbeCommand @('restore', $projectPath, '--locked-mode')
Invoke-ProbeCommand @('run', '--project', $projectPath, '--no-restore', '--', (Join-Path $PSScriptRoot 'cases.json'))
