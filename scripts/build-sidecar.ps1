# Reusable, isolated StudyFlow sidecar build. Never modifies either original platform source.
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
if ($LASTEXITCODE -ne 0) { throw 'Standalone StudyFlow runtime build failed' }

$bridge = Join-Path $PSScriptRoot '..\packaging\sidecar\studyflow-bridge.exe'
if (-not (Test-Path -LiteralPath $bridge -PathType Leaf)) {
  throw 'Standalone StudyFlow sidecar is missing'
}

# These checks execute inside the frozen one-file executable. They prove that
# its embedded interpreter, ZHS runtime, Rain Classroom imports and source
# resources are present without relying on a machine-wide Python installation.
& $bridge --zhidao-env-check
if ($LASTEXITCODE -ne 0) { throw 'Frozen ZHS 0.1.5 import and dependency check failed' }
& $bridge --packaged-runtime-self-test
if ($LASTEXITCODE -ne 0) { throw 'Frozen dual-platform runtime self-test failed' }

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

# Exercise both platform-specific local settings adapters without credentials
# or network access. Keep this probe isolated from any developer profile.
$oldYktHome = $env:YKT_HOME
$probeHome = Join-Path $env:TEMP ('studyflow-ykt-probe-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $probeHome -Force | Out-Null
try {
  $env:YKT_HOME = $probeHome
  $settings = Invoke-JsonlProbe '{"id":"packaging-settings","version":1,"operation":"zhidao.player.settings.get"}'
  if ($settings.id -cne 'packaging-settings' -or -not $settings.ok -or
      $settings.data.speed -notin @('1','1.25','1.5','2')) {
    throw 'Frozen Zhidao local settings JSONL contract mismatch'
  }

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

Write-Host '[READY] Frozen Python runtime, both platform resources, ZHS imports, Rain Classroom source, JSONL IPC and settings adapters verified.'
