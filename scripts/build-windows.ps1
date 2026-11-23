$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..'))
python -m pip install -e '.[desktop,dev]'
if ($LASTEXITCODE -ne 0) { throw 'Python dependencies failed' }
python -m pytest -q
if ($LASTEXITCODE -ne 0) { throw 'Python tests failed' }
npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'Root npm install failed' }
# frontend/package-lock.json is committed: install exactly the tested dependency tree.
npm ci --prefix frontend --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'Frontend npm install failed' }
npm --prefix frontend run build
if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed' }
& (Join-Path $PSScriptRoot 'build-sidecar.ps1')
# Tauri's build script requires the bundled sidecar and generated icons to exist.
npm run tauri -- icon packaging/icon.svg
if ($LASTEXITCODE -ne 0) { throw 'Icon generation failed' }
cargo test --manifest-path src-tauri/Cargo.toml
if ($LASTEXITCODE -ne 0) { throw 'Tauri Rust unit tests failed' }
npm run tauri -- build
if ($LASTEXITCODE -ne 0) { throw 'Windows NSIS packaging failed' }
Write-Host 'Find the NSIS installer in src-tauri/target/release/bundle/nsis/'
