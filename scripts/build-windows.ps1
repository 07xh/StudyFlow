$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..'))
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
