$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..'))

# ZHS 0.1.5 declares Requires-Python >=3.13,<3.15.
$pythonSupported = python -c "import sys; raise SystemExit(0 if (3, 13) <= sys.version_info[:2] < (3, 15) else 1)"
if ($LASTEXITCODE -ne 0) {
  throw 'StudyFlow standalone Zhidao packaging requires Python 3.13 or 3.14 (ZHS 0.1.5).'
}

python -m pip install -e '.[desktop,dev]'
if ($LASTEXITCODE -ne 0) { throw 'Python dependencies failed' }
python -m pytest -q
if ($LASTEXITCODE -ne 0) { throw 'Python tests failed' }
npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'Root npm install failed' }
npm install --prefix frontend --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'Frontend npm install failed' }
npm --prefix frontend run build
if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed' }
& (Join-Path $PSScriptRoot 'build-sidecar.ps1')
# build-sidecar.ps1 throws if frozen ZHS, JSONL IPC, or bundle verification fails.
npm run tauri -- icon packaging/icon.svg
if ($LASTEXITCODE -ne 0) { throw 'Icon generation failed' }
npm run tauri -- build
if ($LASTEXITCODE -ne 0) { throw 'Windows NSIS packaging failed' }
Write-Host 'Find the NSIS installer in src-tauri/target/release/bundle/nsis/'
