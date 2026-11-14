# Reusable, isolated StudyFlow sidecar build. Never modifies the original ZHSDesktop.
$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..'))
$flags = @('--noconfirm','--clean','--onefile','--console',
  '--name','studyflow-bridge','--paths','src',
  '--collect-all','keyring','--collect-all','zhs','--copy-metadata','zhs',
  '--add-data',"$((Resolve-Path 'legacy/yuketang/main.py').Path);legacy/yuketang",
  '--add-data',"$((Resolve-Path 'legacy/zhidao/ZHS-ConsoleMonitor.py').Path);legacy/zhidao",
  '--hidden-import','dotenv',
  '--distpath','packaging/sidecar','--workpath','build/pyinstaller',
  '--specpath','build/specs','packaging/bridge_entry.py')
python -m PyInstaller @flags
if ($LASTEXITCODE -ne 0) { throw 'Standalone Zhidao sidecar build failed' }

$bridge = Join-Path $PSScriptRoot '..\packaging\sidecar\studyflow-bridge.exe'
if (-not (Test-Path -LiteralPath $bridge -PathType Leaf)) {
  throw 'Standalone StudyFlow sidecar is missing'
}
& $bridge --zhidao-env-check
if ($LASTEXITCODE -ne 0) { throw 'Frozen ZHS 0.1.5 import and dependency check failed' }
$ping = '{"id":"packaging-probe","version":1,"operation":"ping"}' | & $bridge
if ($LASTEXITCODE -ne 0) { throw 'Frozen StudyFlow JSONL IPC failed' }
try { $reply = $ping | ConvertFrom-Json -ErrorAction Stop }
catch { throw 'Frozen StudyFlow JSONL IPC returned invalid JSON' }
if ($reply.id -cne 'packaging-probe' -or -not $reply.ok -or $reply.data.service -cne 'studyflow') {
  throw 'Frozen StudyFlow IPC contract mismatch'
}
Write-Host '[READY] Frozen ZHS and StudyFlow IPC verified without server access.'
