# Reusable, isolated StudyFlow sidecar build. Never modifies the original ZHSDesktop.
$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..'))
# Inject only the build-approved public mirror origin into this frozen sidecar.
python scripts/embed-update-mirror.py
if ($LASTEXITCODE -ne 0) { throw 'Mirror configuration rejected' }
# Never modify the installed pip package or original ZHSDesktop.
$stage = Join-Path $PSScriptRoot '..\build\zhs-stage'
python -m studyflow.services.zhs_upstream_patch prepare $stage
if ($LASTEXITCODE -ne 0) { throw 'Reviewed upstream ZHS sources do not match this installation' }
$flags = @('--noconfirm','--clean','--onefile','--console',
  '--name','studyflow-bridge','--paths','src','--paths',$stage,
  '--collect-all','keyring','--collect-all','zhs','--copy-metadata','zhs',
  '--add-data',"$((Resolve-Path 'legacy/yuketang/main.py').Path);legacy/yuketang",
  '--add-data',"$((Resolve-Path 'legacy/yuketang/exe_entry.py').Path);legacy/yuketang",
  '--add-data',"$((Resolve-Path 'legacy/zhidao').Path);legacy/zhidao",
  '--hidden-import','dotenv','--hidden-import','websocket',
  '--distpath','packaging/sidecar','--workpath','build/pyinstaller',
  '--specpath','build/specs','packaging/bridge_entry.py')
$previousPythonPath = $env:PYTHONPATH
$env:PYTHONPATH = "$stage" + $(if ($previousPythonPath) { ";$previousPythonPath" } else { "" })
try {
  python -m PyInstaller @flags
  if ($LASTEXITCODE -ne 0) { throw 'Standalone Zhidao sidecar build failed' }
} finally {
  if ($null -eq $previousPythonPath) { Remove-Item Env:PYTHONPATH -ErrorAction SilentlyContinue }
  else { $env:PYTHONPATH = $previousPythonPath }
}

$bridge = Join-Path $PSScriptRoot '..\packaging\sidecar\studyflow-bridge.exe'
if (-not (Test-Path -LiteralPath $bridge -PathType Leaf)) {
  throw 'Standalone StudyFlow sidecar is missing'
}
& $bridge --zhidao-env-check
if ($LASTEXITCODE -ne 0) { throw 'Frozen ZHS 0.1.5 import and dependency check failed' }
& $bridge --yuketang-env-check
if ($LASTEXITCODE -ne 0) { throw 'Frozen original Rain Classroom imports and configuration check failed' }
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

# Validate that the new local Socket.IO client is truly packaged in the frozen
# Python sidecar, without opening a socket or using a real school account.
$ucSocket = Invoke-JsonlProbe '{"id":"packaging-ucampus","version":1,"operation":"ucampus.heartbeat.capabilities"}'
if ($ucSocket.id -cne 'packaging-ucampus' -or -not $ucSocket.ok -or
    -not $ucSocket.data.local_generation -or
    -not $ucSocket.data.socket_transport_available -or
    $ucSocket.data.sender_connected -or $ucSocket.data.server_verified) {
  throw 'Frozen UCampus local heartbeat and socket dependency contract mismatch'
}
# Exercise a real local settings handler as well; this checks the request/response
# contract without requiring school credentials or contacting a remote platform.
$settings = Invoke-JsonlProbe '{"id":"packaging-settings","version":1,"operation":"zhidao.player.settings.get"}'
if ($settings.id -cne 'packaging-settings' -or -not $settings.ok -or
    $settings.data.speed -notin @('1','1.25','1.5','2')) {
  throw 'Frozen StudyFlow local settings JSONL contract mismatch'
}
# Isolate the probe from any settings already present on the build machine.
$oldYktHome = $env:YKT_HOME
$probeHome = Join-Path $env:TEMP ('studyflow-ykt-probe-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $probeHome -Force | Out-Null
try {
  $env:YKT_HOME = $probeHome
  $ykt = Invoke-JsonlProbe '{"id":"packaging-yuketang-settings","version":1,"operation":"yuketang.settings.get"}'
  $expectedFields = @(
    'video_speed','heartbeat_interval','max_concurrent_videos','completion_threshold',
    'skip_completed','use_concurrent','test_mode','test_video_count','auto_richtext',
    'debug','richtext_stay_seconds','richtext_skip_delay'
  )
  if ($ykt.id -cne 'packaging-yuketang-settings' -or -not $ykt.ok) {
    throw 'Frozen Rain Classroom settings JSONL contract failed'
  }
  foreach ($field in $expectedFields) {
    if ($ykt.data.PSObject.Properties.Name -notcontains $field) {
      throw "Frozen Rain Classroom setting is missing: $field"
    }
  }
} finally {
  if ($null -eq $oldYktHome) { Remove-Item Env:YKT_HOME -ErrorAction SilentlyContinue }
  else { $env:YKT_HOME = $oldYktHome }
  Remove-Item -LiteralPath $probeHome -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host '[READY] Frozen ZHS, Rain Classroom, clean JSONL output and both settings adapters verified without server access.'
