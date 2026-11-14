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
$qrScript = (Resolve-Path 'src/studyflow/platforms/zhidao/qr_login_core.py').Path
$yktOriginal = (Resolve-Path 'legacy/yuketang/main.py').Path
python -m PyInstaller --noconfirm --clean --onefile --console --name studyflow-bridge --paths src --collect-all keyring --add-data "$qrScript;studyflow/platforms/zhidao" --add-data "$yktOriginal;legacy/yuketang" --hidden-import=dotenv --distpath packaging/sidecar --workpath build/pyinstaller --specpath build/specs packaging/bridge_entry.py
if ($LASTEXITCODE -ne 0) { throw 'Python sidecar build failed' }
npm run tauri -- icon packaging/icon.svg
if ($LASTEXITCODE -ne 0) { throw 'Icon generation failed' }
npm run tauri -- build
if ($LASTEXITCODE -ne 0) { throw 'Windows NSIS packaging failed' }
Write-Host 'Find the NSIS installer in src-tauri/target/release/bundle/nsis/'
