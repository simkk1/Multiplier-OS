$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$dist = Join-Path $root "dist"
$server = Join-Path $dist "server"
$openai = Join-Path $dist ".openai"
$src = Join-Path $root "src"

if (-not (Test-Path $src)) {
  throw "Missing src directory"
}

if (Test-Path $dist) {
  $resolvedDist = Resolve-Path $dist
  if (-not ($resolvedDist.Path.StartsWith($root.Path))) {
    throw "Refusing to remove dist outside project root"
  }
  Remove-Item -LiteralPath $resolvedDist.Path -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $server | Out-Null
Copy-Item -Path (Join-Path $src "*") -Destination $server -Recurse -Force
New-Item -ItemType Directory -Force -Path $openai | Out-Null
Copy-Item -Path (Join-Path $root ".openai\hosting.json") -Destination (Join-Path $openai "hosting.json") -Force
if (Test-Path (Join-Path $root "drizzle")) {
  Copy-Item -Path (Join-Path $root "drizzle") -Destination (Join-Path $openai "drizzle") -Recurse -Force
}

Write-Host "Built dist/server/index.js"
