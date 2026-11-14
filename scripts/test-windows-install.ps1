$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$bundleDir = Join-Path $repoRoot 'src-tauri\target\release\bundle\nsis'
$installer = Get-ChildItem -LiteralPath $bundleDir -Filter '*.exe' -File |
  Where-Object { $_.Name -notmatch '^(unins|uninstall)' } |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if ($null -eq $installer) { throw 'NSIS installer was not produced.' }

# Use a brand-new path; do not reuse any pre-existing StudyFlow installation.
$installDir = Join-Path $env:RUNNER_TEMP 'studyflow-clean-install'
$probeHome = Join-Path $env:RUNNER_TEMP 'studyflow-clean-install-ykt'
Remove-Item -LiteralPath $installDir,$probeHome -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $installDir -Force | Out-Null

Write-Host '[1/4] Installing the generated NSIS package into a clean directory.'
$install = Start-Process -FilePath $installer.FullName -ArgumentList @('/S', "/D=$installDir") -Wait -PassThru
if ($install.ExitCode -ne 0) { throw "NSIS silent install failed with exit code $($install.ExitCode)." }

Write-Host '[2/4] Locating the packaged Python sidecar and testing it without Python on PATH.'
$bridgeFiles = @(Get-ChildItem -LiteralPath $installDir -Filter 'studyflow-bridge.exe' -File -Recurse)
if ($bridgeFiles.Count -ne 1) { throw "Expected one bundled sidecar; found $($bridgeFiles.Count)." }
$bridge = $bridgeFiles[0].FullName
$oldPath = $env:PATH
$oldYktHome = $env:YKT_HOME
New-Item -ItemType Directory -Path $probeHome -Force | Out-Null
try {
  $env:PATH = Join-Path $env:SystemRoot 'System32'
  $env:YKT_HOME = $probeHome

  & $bridge --packaged-runtime-self-test
  if ($LASTEXITCODE -ne 0) { throw 'Installed frozen Python runtime self-test failed.' }

  function Invoke-InstalledJsonlProbe([string]$requestJson) {
    $lines = @($requestJson | & $bridge)
    $code = $LASTEXITCODE
    if ($code -ne 0) { throw "Installed JSONL bridge exited with code $code." }
    if ($lines.Count -ne 1) { throw 'Installed JSONL bridge did not return exactly one response.' }
    try { return ($lines[0] | ConvertFrom-Json -ErrorAction Stop) }
    catch { throw 'Installed JSONL bridge returned invalid JSON.' }
  }

  $ping = Invoke-InstalledJsonlProbe '{"id":"clean-install-ping","version":1,"operation":"ping"}'
  if ($ping.id -cne 'clean-install-ping' -or -not $ping.ok -or $ping.data.service -cne 'studyflow') {
    throw 'Installed sidecar ping contract failed.'
  }

  $zhidao = Invoke-InstalledJsonlProbe '{"id":"clean-install-zhidao","version":1,"operation":"zhidao.player.settings.get"}'
  if ($zhidao.id -cne 'clean-install-zhidao' -or -not $zhidao.ok) {
    throw 'Installed Zhidao settings adapter failed.'
  }

  $yuketang = Invoke-InstalledJsonlProbe '{"id":"clean-install-yuketang","version":1,"operation":"yuketang.settings.get"}'
  $expected = @(
    'video_speed','heartbeat_interval','max_concurrent_videos','completion_threshold',
    'skip_completed','use_concurrent','test_mode','test_video_count','auto_richtext',
    'debug','richtext_stay_seconds','richtext_skip_delay'
  )
  if ($yuketang.id -cne 'clean-install-yuketang' -or -not $yuketang.ok) {
    throw 'Installed Rain Classroom settings adapter failed.'
  }
  foreach ($field in $expected) {
    if ($yuketang.data.PSObject.Properties.Name -notcontains $field) {
      throw "Installed Rain Classroom settings mapping is missing: $field"
    }
  }
} finally {
  $env:PATH = $oldPath
  if ($null -eq $oldYktHome) { Remove-Item Env:YKT_HOME -ErrorAction SilentlyContinue }
  else { $env:YKT_HOME = $oldYktHome }
  Remove-Item -LiteralPath $probeHome -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host '[3/4] Verifying the installed desktop executable exists and starts.'
$appFiles = @(Get-ChildItem -LiteralPath $installDir -Filter '*.exe' -File -Recurse |
  Where-Object { $_.Name -notmatch '^(studyflow-bridge|unins|uninstall)' })
$app = $appFiles | Where-Object { $_.Name -match 'studyflow' } | Select-Object -First 1
if ($null -eq $app) { $app = $appFiles | Select-Object -First 1 }
if ($null -eq $app) { throw 'Installed StudyFlow desktop executable is missing.' }
$desktop = Start-Process -FilePath $app.FullName -PassThru
try {
  Start-Sleep -Seconds 8
  $desktop.Refresh()
  if ($desktop.HasExited) { throw "StudyFlow desktop exited during startup with code $($desktop.ExitCode)." }
} finally {
  if (-not $desktop.HasExited) {
    & (Join-Path $env:SystemRoot 'System32\taskkill.exe') /PID $desktop.Id /T /F | Out-Null
  }
}

Write-Host '[4/4] Clean Windows install smoke test passed: bundled runtime, both settings adapters, JSONL IPC and desktop startup.'
