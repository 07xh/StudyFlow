# Disposable install/upgrade/uninstall smoke; no account or platform requests.
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$installers = @(Get-ChildItem (Join-Path $repo 'src-tauri/target/release/bundle/nsis') -Filter '*.exe')
if ($installers.Count -ne 1) { throw 'Expected exactly one NSIS installer' }
$root = Join-Path ([IO.Path]::GetTempPath()) ('StudyFlowSmoke-' + [guid]::NewGuid().ToString('N'))
$markerDirectory = Join-Path $env:LOCALAPPDATA 'StudyFlow'
$marker = Join-Path $markerDirectory ('install-smoke-' + [guid]::NewGuid().ToString('N') + '.txt')
$legacyInstallDirectory = Join-Path $env:LOCALAPPDATA 'ZHSDesktop'
$legacyInstallMarker = Join-Path $legacyInstallDirectory ('studyflow-preserve-' + [guid]::NewGuid().ToString('N') + '.txt')
$legacyDataDirectory = Join-Path $env:USERPROFILE '.zhs'
$legacyDataMarker = Join-Path $legacyDataDirectory ('studyflow-preserve-' + [guid]::NewGuid().ToString('N') + '.txt')
New-Item -ItemType Directory -Force $markerDirectory,$legacyInstallDirectory,$legacyDataDirectory | Out-Null
[IO.File]::WriteAllText($marker, 'preserve-user-data')
[IO.File]::WriteAllText($legacyInstallMarker, 'preserve-original-zhs-install')
[IO.File]::WriteAllText($legacyDataMarker, 'preserve-original-zhs-data')
$app = $null
$bridgeLockHolder = $null
$oldPath = $env:PATH
$oldYktHome = $env:YKT_HOME
$probeYktHome = Join-Path ([IO.Path]::GetTempPath()) ('StudyFlowYktSmoke-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $probeYktHome | Out-Null
try {
    # Prove the bundled sidecar works without a machine-wide Python installation.
    $env:PATH = Join-Path $env:SystemRoot 'System32'
    $env:YKT_HOME = $probeYktHome
    function Invoke-InstalledJsonlProbe([string]$requestJson) {
        $lines = @($requestJson | & $bridge)
        if ($LASTEXITCODE -ne 0) { throw 'Installed JSONL bridge failed.' }
        if ($lines.Count -ne 1) { throw 'Installed JSONL bridge did not return exactly one response.' }
        try { return ($lines[0] | ConvertFrom-Json -ErrorAction Stop) }
        catch { throw 'Installed JSONL bridge returned invalid JSON.' }
    }
    foreach ($phase in @('install','upgrade')) {
        $setup = Start-Process -FilePath $installers[0].FullName -ArgumentList @('/S', "/D=$root") -Wait -PassThru
        if ($setup.ExitCode -ne 0) { throw "NSIS $phase failed: $($setup.ExitCode)" }
        $bridge = Join-Path $root 'bin/studyflow-bridge.exe'
        if (-not (Test-Path -LiteralPath $bridge)) { throw 'Installed bundled Python sidecar missing' }
        & $bridge --zhidao-env-check
        if ($LASTEXITCODE -ne 0) { throw 'Installed ZHS runtime failed' }
        & $bridge --yuketang-env-check
        if ($LASTEXITCODE -ne 0) { throw 'Installed Rain Classroom runtime failed' }
        $ping = Invoke-InstalledJsonlProbe '{"id":"installed-smoke","version":1,"operation":"ping"}'
        if (-not $ping.ok -or $ping.id -cne 'installed-smoke' -or $ping.data.service -cne 'studyflow') {
            throw 'Installed JSONL response failed'
        }
        # StudyFlow's Xuexitong adapter must be present inside the packaged
        # sidecar. These are local read-only checks; no login or learning
        # progress requests are made against the platform.
        $xxtSettings = Invoke-InstalledJsonlProbe '{"id":"installed-xxt-settings","version":1,"operation":"xuexitong.settings.get"}'
        if (-not $xxtSettings.ok -or $xxtSettings.id -cne 'installed-xxt-settings' -or
            $xxtSettings.data.PSObject.Properties.Name -notcontains 'playback_speed' -or
            $xxtSettings.data.PSObject.Properties.Name -notcontains 'concurrency') {
            throw 'Installed Xuexitong settings adapter failed'
        }
        $xxtStatus = Invoke-InstalledJsonlProbe '{"id":"installed-xxt-status","version":1,"operation":"xuexitong.heartbeat.status","course_id":"100001:200002:300003"}'
        if (-not $xxtStatus.ok -or $xxtStatus.id -cne 'installed-xxt-status' -or
            $xxtStatus.data.course_key -cne '100001:200002:300003' -or
            $xxtStatus.data.PSObject.Properties.Name -notcontains 'queue_controls' -or
            $xxtStatus.data.PSObject.Properties.Name -notcontains 'heartbeats') {
            throw 'Installed Xuexitong status IPC adapter failed'
        }
        $zhidao = Invoke-InstalledJsonlProbe '{"id":"installed-zhidao","version":1,"operation":"zhidao.player.settings.get"}'
        if (-not $zhidao.ok -or $zhidao.data.speed -notin @('1','1.25','1.5','2')) {
            throw 'Installed Zhidao settings adapter failed'
        }
        # Pair the native Rust allowlist test with the installed Python handler.
        # A course-scoped read must work without altering user settings.
        $zhsKey = 'a' * 64
        $zhsSettings = Invoke-InstalledJsonlProbe ('{"id":"installed-zhs","version":1,"operation":"zhidao.zhs.settings.get","course_key":"' + $zhsKey + '"}')
        if (-not $zhsSettings.ok -or $zhsSettings.id -cne 'installed-zhs' -or
            $zhsSettings.data.speed -lt 1 -or $zhsSettings.data.speed -gt 2) {
            throw 'Installed ZHS course settings IPC adapter failed'
        }
        $yuketang = Invoke-InstalledJsonlProbe '{"id":"installed-yuketang","version":1,"operation":"yuketang.settings.get"}'
        $expectedFields = @(
            'video_speed','heartbeat_interval','max_concurrent_videos','completion_threshold',
            'skip_completed','use_concurrent','test_mode','test_video_count','auto_richtext',
            'debug','richtext_stay_seconds','richtext_skip_delay'
        )
        if (-not $yuketang.ok -or $yuketang.id -cne 'installed-yuketang') {
            throw 'Installed Rain Classroom settings adapter failed'
        }
        foreach ($field in $expectedFields) {
            if ($yuketang.data.PSObject.Properties.Name -notcontains $field) {
                throw "Installed Rain Classroom setting is missing: $field"
            }
        }
        if ([IO.File]::ReadAllText($marker) -cne 'preserve-user-data') { throw 'Install/upgrade changed StudyFlow user data' }
        if ([IO.File]::ReadAllText($legacyInstallMarker) -cne 'preserve-original-zhs-install' -or
            [IO.File]::ReadAllText($legacyDataMarker) -cne 'preserve-original-zhs-data') {
            throw 'Install/upgrade changed the original ZHSDesktop installation or ~/.zhs user data'
        }
    }
    # Regression: a detached Python bridge can hold the EXE after the UI exits.
    # Hold its JSONL stdin pipe open without making platform/network requests.
    $bridgeLockHolder = [System.Diagnostics.Process]::new()
    $bridgeStart = [System.Diagnostics.ProcessStartInfo]::new()
    $bridgeStart.FileName = $bridge
    $bridgeStart.UseShellExecute = $false
    $bridgeStart.CreateNoWindow = $true
    $bridgeStart.RedirectStandardInput = $true
    $bridgeStart.RedirectStandardOutput = $true
    $bridgeLockHolder.StartInfo = $bridgeStart
    if (-not $bridgeLockHolder.Start()) { throw 'Could not launch detached bridge regression worker' }
    Start-Sleep -Seconds 2
    if ($bridgeLockHolder.HasExited) { throw 'Detached bridge exited before the upgrade lock check' }
    $originalBridgeHash = (Get-FileHash -LiteralPath $bridge -Algorithm SHA256).Hash
    $blocked = Start-Process -FilePath $installers[0].FullName -ArgumentList @('/S', "/D=$root") -Wait -PassThru
    if ($blocked.ExitCode -eq 0) { throw 'Silent upgrade must refuse to overwrite a running Python bridge' }
    if ((Get-FileHash -LiteralPath $bridge -Algorithm SHA256).Hash -cne $originalBridgeHash) {
        throw 'Blocked installer changed the in-use Python bridge'
    }
    if ([IO.File]::ReadAllText($marker) -cne 'preserve-user-data') {
        throw 'Blocked upgrade changed StudyFlow user data'
    }
    $bridgeLockHolder.StandardInput.Close()
    if (-not $bridgeLockHolder.WaitForExit(10000)) {
        $bridgeLockHolder.Kill()
        $bridgeLockHolder.WaitForExit()
    }
    $bridgeLockHolder.Dispose()
    $bridgeLockHolder = $null
    $retried = Start-Process -FilePath $installers[0].FullName -ArgumentList @('/S', "/D=$root") -Wait -PassThru
    if ($retried.ExitCode -ne 0) { throw "Upgrade retry after bridge exit failed: $($retried.ExitCode)" }
    if (-not (Test-Path -LiteralPath $bridge)) { throw 'Bridge missing after successful upgrade retry' }
    if ([IO.File]::ReadAllText($marker) -cne 'preserve-user-data') {
        throw 'Upgrade retry changed StudyFlow user data'
    }

    # Restore the normal process environment before launching the desktop app.
    $env:PATH = $oldPath
    if ($null -eq $oldYktHome) { Remove-Item Env:YKT_HOME -ErrorAction SilentlyContinue }
    else { $env:YKT_HOME = $oldYktHome }
    $executable = Join-Path $root 'studyflow.exe'
    $app = Start-Process -FilePath $executable -PassThru
    Start-Sleep -Seconds 5
    $app.Refresh()
    if ($app.HasExited) { throw "Installed desktop app exited early: $($app.ExitCode)" }
    # Exercise normal user exit, not a hard kill. Hard-killing the desktop
    # bypasses Tauri window-destroyed cleanup and can orphan its Python bridge.
    # On GitHub's headless Windows runner, the borderless WebView can take
    # longer to finish its native teardown than in the interactive PR smoke.
    # Retry only the close request; never force an exit or pass on a live app.
    $app.Refresh()
    Write-Host "[SHUTDOWN] Requesting normal window close, pid=$($app.Id), handle=$($app.MainWindowHandle)"
    $closeRequested = $false
    $exitedGracefully = $false
    for ($attempt = 1; $attempt -le 6; $attempt++) {
        $app.Refresh()
        if ($app.HasExited) {
            $exitedGracefully = $true
            break
        }
        if ($app.CloseMainWindow()) { $closeRequested = $true }
        if ($app.WaitForExit(5000)) {
            $exitedGracefully = $true
            break
        }
        Write-Host "[SHUTDOWN] Still running after attempt $attempt; windowHandle=$($app.MainWindowHandle)"
    }
    if (-not $exitedGracefully) {
        # Only diagnostic enumeration: do not kill other processes to hide a
        # desktop lifecycle regression from the release gate.
        Get-CimInstance Win32_Process |
            Where-Object { $_.Name -in @('studyflow.exe','studyflow-bridge.exe') } |
            Select-Object ProcessId,ParentProcessId,Name |
            Format-Table -Wrap | Out-String | Write-Host
        throw "StudyFlow did not exit gracefully after 30 seconds (closeRequested=$closeRequested)"
    }
    Write-Host "[SHUTDOWN] Desktop app exited after normal close; code=$($app.ExitCode)"
    $app.Dispose()
    $app = $null

    # The installer refuses to overwrite/delete the bridge while it is running.
    # Verify normal exit releases the exact packaged EXE before uninstall.
    $bridgeReleased = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        try {
            $probe = [IO.File]::Open($bridge, [IO.FileMode]::Open, [IO.FileAccess]::Write, [IO.FileShare]::Read)
            $probe.Dispose()
            $bridgeReleased = $true
            break
        } catch [IO.IOException] {
            Start-Sleep -Milliseconds 250
        }
    }
    if (-not $bridgeReleased) { throw 'StudyFlow background bridge was not released after normal exit' }

    $uninstaller = Join-Path $root 'uninstall.exe'
    if (-not (Test-Path -LiteralPath $uninstaller)) { throw 'NSIS uninstaller missing' }
    $remove = Start-Process -FilePath $uninstaller -ArgumentList @('/S', "_?=$root") -Wait -PassThru
    if ($remove.ExitCode -ne 0) { throw "NSIS uninstall failed: exit code $($remove.ExitCode)" }
    if ([IO.File]::ReadAllText($marker) -cne 'preserve-user-data') { throw 'Uninstall changed StudyFlow user data' }
    if ([IO.File]::ReadAllText($legacyInstallMarker) -cne 'preserve-original-zhs-install' -or
        [IO.File]::ReadAllText($legacyDataMarker) -cne 'preserve-original-zhs-data') {
        throw 'Uninstall changed the original ZHSDesktop installation or ~/.zhs user data'
    }
    Write-Host '[READY] NSIS install, upgrade, installed runtimes, app launch, uninstall and data marker preserved.'
} finally {
    $env:PATH = $oldPath
    if ($null -eq $oldYktHome) { Remove-Item Env:YKT_HOME -ErrorAction SilentlyContinue }
    else { $env:YKT_HOME = $oldYktHome }
    if ($null -ne $app -and -not $app.HasExited) { Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue }
    if ($null -ne $bridgeLockHolder) {
        if (-not $bridgeLockHolder.HasExited) {
            $bridgeLockHolder.Kill()
            $bridgeLockHolder.WaitForExit()
        }
        $bridgeLockHolder.Dispose()
    }
    Remove-Item -LiteralPath $marker -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $legacyInstallMarker,$legacyDataMarker -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $probeYktHome -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
