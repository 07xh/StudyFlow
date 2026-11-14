# Reusable, isolated StudyFlow sidecar build. Never modifies the original ZHSDesktop.
$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..'))
$flags = @('--noconfirm','--clean','--onefile','--console',
  '--name','studyflow-bridge','--paths','src',
  '--collect-all','keyring','--collect-all','zhs','--copy-metadata','zhs',
  '--add-data',"$((Resolve-Path 'legacy/yuketang/main.py').Path);legacy/yuketang",
  '--add-data',"$((Resolve-Path 'legacy/yuketang/exe_entry.py').Path);legacy/yuketang",
  '--add-data',"$((Resolve-Path 'legacy/zhidao').Path);legacy/zhidao",
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
function Invoke-JsonlProbe([string]$requestJson) {
  $lines = @($requestJson | & $bridge)
  if ($LASTEXITCODE -ne 0) { throw 'Frozen StudyFlow JSONL IPC process failed' }
  if ($lines.Count -ne 1) { throw 'Frozen StudyFlow JSONL IPC must emit exactly one response line' }
  try { return ($lines[0] | ConvertFrom-Json -ErrorAction Stop) }
  catch { throw 'Frozen StudyFlow JSONL IPC returned invalid JSON' }
}

$ping = Invoke-JsonlProbe '{"id":"packaging-probe","version":1,"operation":"ping"}'
if ($ping.id -cne 'packaging-probe' -or -not $ping.ok -or $ping.data.service -cne 'studyflow') {
  throw 'Frozen StudyFlow ping contract mismatch'
}

# Exercise an adapter-backed operation as well: imports and platform status
# handlers must not leak diagnostics into the machine-readable stdout pipe.
$status = Invoke-JsonlProbe '{"id":"packaging-status","version":1,"operation":"platform.status"}'
if ($status.id -cne 'packaging-status' -or -not $status.ok -or $status.data.Count -ne 2) {
  throw 'Frozen StudyFlow platform.status JSONL contract mismatch'
}
Write-Host '[READY] Frozen ZHS, adapter-backed JSONL IPC and platform status verified without server access.'
