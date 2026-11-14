# Disposable install/upgrade/uninstall smoke; no account or platform requests.
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$installers = @(Get-ChildItem (Join-Path $repo 'src-tauri/target/release/bundle/nsis') -Filter '*.exe')
if ($installers.Count -ne 1) { throw 'Expected exactly one NSIS installer' }
$root = Join-Path ([IO.Path]::GetTempPath()) ('StudyFlowSmoke-' + [guid]::NewGuid().ToString('N'))
$markerDirectory = Join-Path $env:LOCALAPPDATA 'StudyFlow'
$marker = Join-Path $markerDirectory ('install-smoke-' + [guid]::NewGuid().ToString('N') + '.txt')
New-Item -ItemType Directory -Force $markerDirectory | Out-Null
[IO.File]::WriteAllText($marker, 'preserve-user-data')
$app = $null
try {
    foreach ($phase in @('install','upgrade')) {
        $setup = Start-Process -FilePath $installers[0].FullName -ArgumentList @('/S', "/D=$root") -Wait -PassThru
        if ($setup.ExitCode -ne 0) { throw "NSIS $phase failed: $($setup.ExitCode)" }
        $bridge = Join-Path $root 'bin/studyflow-bridge.exe'
        if (-not (Test-Path -LiteralPath $bridge)) { throw 'Installed bundled Python sidecar missing' }
        & $bridge --zhidao-env-check
        if ($LASTEXITCODE -ne 0) { throw 'Installed ZHS runtime failed' }
        & $bridge --yuketang-env-check
        if ($LASTEXITCODE -ne 0) { throw 'Installed Rain Classroom runtime failed' }
        $response = '{"id":"installed-smoke","version":1,"operation":"ping"}' | & $bridge
        if ($LASTEXITCODE -ne 0) { throw 'Installed JSONL process failed' }
        $reply = $response | ConvertFrom-Json
        if (-not $reply.ok -or $reply.id -cne 'installed-smoke') { throw 'Installed JSONL response failed' }
        $yktSettings = '{"id":"installed-ykt-settings","version":1,"operation":"yuketang.settings.get"}' | & $bridge
        if ($LASTEXITCODE -ne 0) { throw 'Installed Rain Classroom settings IPC failed' }
        $yktReply = $yktSettings | ConvertFrom-Json
        if (-not $yktReply.ok -or $yktReply.id -cne 'installed-ykt-settings' -or
            $yktReply.data.video_speed -ne 1.5 -or $yktReply.data.heartbeat_interval -ne 5 -or
            $yktReply.data.max_concurrent_videos -ne 3 -or
            $yktReply.data.completion_threshold -ne 90) {
            throw 'Installed Rain Classroom settings JSONL contract failed'
        }
        if ([IO.File]::ReadAllText($marker) -cne 'preserve-user-data') { throw 'Install/upgrade changed user data' }
    }
    $executable = Join-Path $root 'studyflow.exe'
    $app = Start-Process -FilePath $executable -PassThru
    Start-Sleep -Seconds 5
    $app.Refresh()
    if ($app.HasExited) { throw "Installed desktop app exited early: $($app.ExitCode)" }
    Stop-Process -Id $app.Id -Force
    Wait-Process -Id $app.Id -ErrorAction SilentlyContinue
    $app = $null
    $uninstaller = Join-Path $root 'uninstall.exe'
    if (-not (Test-Path -LiteralPath $uninstaller)) { throw 'NSIS uninstaller missing' }
    $remove = Start-Process -FilePath $uninstaller -ArgumentList @('/S', "_?=$root") -Wait -PassThru
    if ($remove.ExitCode -ne 0) { throw 'NSIS uninstall failed' }
    if ([IO.File]::ReadAllText($marker) -cne 'preserve-user-data') { throw 'Uninstall changed user data' }
    Write-Host '[READY] NSIS install, upgrade, installed runtimes, app launch, uninstall and data marker preserved.'
} finally {
    if ($null -ne $app -and -not $app.HasExited) { Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue }
    Remove-Item -LiteralPath $marker -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
