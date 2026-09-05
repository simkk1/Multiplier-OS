$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$nodeScript = Join-Path $root "scripts\build.mjs"
$localNode = Join-Path $root ".tools\node-v24.20.0-win-x64\node.exe"

if (Test-Path $localNode) {
  & $localNode $nodeScript
  exit $LASTEXITCODE
}

if (Get-Command node -ErrorAction SilentlyContinue) {
  node $nodeScript
  exit $LASTEXITCODE
}

throw "Node is required to build Multipliers OS."
