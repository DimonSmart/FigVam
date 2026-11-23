param(
  [string]$Test,
  [switch]$List,
  [switch]$Setup,
  [switch]$Demo,
  [switch]$Headed,
  [switch]$Debug,
  [ValidateRange(0, 10000)][int]$SlowMo = 0,
  [ValidateRange(0, 60000)][int]$StepDelay = 0
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$testsDir = Join-Path $root 'tests/FigVam.Ui.Tests'

# IDs are stable: append new entries; never renumber existing tests.
$catalog = [ordered]@{
  '1'  = 'login-flow.spec.js'
  '2'  = 'visual-editor-workflow.spec.js'
  '3'  = 'screen-variants.spec.js'
  '4'  = 'canvas-node-editor.spec.js'
  '5'  = 'collaboration.spec.js'
  '6'  = 'components.spec.js'
  '7'  = 'datasets.spec.js'
  '8'  = 'diagnostics.spec.js'
  '9'  = 'document-deletion.spec.js'
  '10' = 'document-import.spec.js'
  '11' = 'document-rename.spec.js'
  '12' = 'editor-shell.spec.js'
  '13' = 'editor.spec.js'
  '14' = 'export.spec.js'
  '15' = 'google-login.spec.js'
  '16' = 'history-actions.spec.js'
  '17' = 'home.spec.js'
  '18' = 'layer-move.spec.js'
  '19' = 'members.spec.js'
  '20' = 'node-delete.spec.js'
  '21' = 'node-metadata.spec.js'
  '22' = 'node-reorder.spec.js'
  '23' = 'node-reparent.spec.js'
  '24' = 'presence.spec.js'
  '25' = 'scenarios.spec.js'
  '26' = 'screen-rename.spec.js'
  '27' = 'screen-resize.spec.js'
  '28' = 'tokens.spec.js'
  '29' = 'visual-node-editor.spec.js'
  '30' = 'visual-screen.spec.js'
  '31' = 'demo-overlay.spec.js'
  '32' = 'layer-labels.spec.js'
}

if ($List -or (-not $Test -and -not $Setup)) {
  Write-Host 'FigVam UI tests (stable IDs):'
  foreach ($id in $catalog.Keys) {
    $name = $catalog[$id]
    if (-not (Test-Path -LiteralPath (Join-Path $testsDir $name))) {
      throw "Test catalog refers to a missing file: $name"
    }
    Write-Host ('{0,3}  {1}' -f $id, $name)
  }
  Write-Host ''
  Write-Host 'Example: ./run-ui-tests.ps1 -Test 1 -Demo -SlowMo 700 -StepDelay 2000'
  if (-not $Test -and -not $Setup) { return }
  if ($List) { return }
}

Push-Location -LiteralPath $testsDir
try {
  if ($Setup) {
    & dotnet build (Join-Path $root 'src/FigVam.Server/FigVam.Server.csproj')
    if ($LASTEXITCODE -ne 0) { throw 'Failed to build FigVam.Server' }
    & npm ci
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
    & npx playwright install chromium
    if ($LASTEXITCODE -ne 0) { throw 'Chromium installation failed' }
    if (-not $Test) { return }
  }

  $selected = $null
  if ($Test -and $Test -ne 'all') {
    if ($catalog.Contains($Test)) {
      $selected = $catalog[$Test]
    }
    else {
      if ($Test -match '[/\\]') { throw 'Specify a test name, not a path' }
      $selected = if ($Test.EndsWith('.spec.js')) { $Test } else { $Test + '.spec.js' }
      if (-not (Test-Path -LiteralPath (Join-Path $testsDir $selected))) {
        throw "Unknown test '$Test'. Use -List to see available tests."
      }
    }
  }

  if (-not $PSBoundParameters.ContainsKey('SlowMo') -and $Demo) { $SlowMo = 500 }
  if (-not $PSBoundParameters.ContainsKey('StepDelay') -and $Demo) { $StepDelay = 2000 }
  $env:FIGVAM_DEMO = if ($Demo) { '1' } else { '0' }
  $env:FIGVAM_SLOWMO_MS = [string]$SlowMo
  $env:FIGVAM_STEP_DELAY_MS = [string]$StepDelay
  if ($Headed -and -not $Demo) {
    Write-Host 'Captions are disabled. Add -Demo to display narrated steps in the browser.'
  }
  if ($Demo) {
    Write-Host 'Demo captions enabled: compact banner at bottom of browser window.'
  }

  $options = @('--workers=1')
  if ($Demo -or $Headed) { $options += '--headed' }
  if ($Debug) { $options += '--debug' }

  if ($selected) {
    Write-Host "Running $selected (demo=$Demo, slowMo=$SlowMo ms, stepDelay=$StepDelay ms)"
    & npx playwright test $selected @options
  }
  else {
    Write-Host "Running all UI tests (demo=$Demo, slowMo=$SlowMo ms)"
    & npx playwright test @options
  }
  exit $LASTEXITCODE
}
finally {
  Pop-Location
}
