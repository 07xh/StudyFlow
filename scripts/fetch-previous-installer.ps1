# Download the immediately previous official StudyFlow RC installer and
# verify GitHub's published SHA-256 before the upgrade smoke. No user data.
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$manifest = Get-Content -LiteralPath (Join-Path $repo 'src-tauri/tauri.conf.json') -Raw | ConvertFrom-Json
$version = [string]$manifest.version
$versionMatch = [regex]::Match($version, '^(\d+\.\d+\.\d+-rc\.)(\d+)
if ($number -lt 2) { throw 'No preceding RC available for upgrade validation' }
$previousVersion = "$prefix$($number - 1)"
$previousTag = "v$previousVersion"
$expectedAsset = "StudyFlow_${previousVersion}_x64-setup.exe"
$releaseRepo = '07xh/StudyFlow'
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw 'GitHub CLI is required to download the official previous installer'
}
$releaseJson = gh api "repos/$releaseRepo/releases/tags/$previousTag" | Out-String
if ($LASTEXITCODE -ne 0) { throw "Could not fetch previous official release metadata: $previousTag" }
$release = $releaseJson | ConvertFrom-Json -ErrorAction Stop
if ($release.draft -or $release.tag_name -cne $previousTag) {
    throw "Previous official release is not published: $previousTag"
}
$assets = @($release.assets | Where-Object { $_.name -ceq $expectedAsset })
if ($assets.Count -ne 1) { throw "Expected one official $expectedAsset asset" }
$asset = $assets[0]
$expectedUrl = "https://github.com/$releaseRepo/releases/download/$previousTag/$expectedAsset"
if ($asset.browser_download_url -cne $expectedUrl -or
    $asset.digest -cnotmatch '^sha256:[a-fA-F0-9]{64}$') {
    throw 'Previous release asset metadata or SHA-256 digest is invalid'
}
$destination = Join-Path $env:RUNNER_TEMP ('StudyFlowPrevious-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $destination -Force | Out-Null
gh release download $previousTag --repo $releaseRepo --pattern $expectedAsset --dir $destination
if ($LASTEXITCODE -ne 0) { throw "Official previous installer download failed: $previousTag" }
$installer = Join-Path $destination $expectedAsset
if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) { throw 'Previous installer not downloaded' }
$actualSha = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash
$expectedSha = $asset.digest.Substring(7)
if ($actualSha -cne $expectedSha.ToUpperInvariant()) {
    throw 'Previous installer SHA-256 does not match GitHub Release metadata'
}
if (-not $env:GITHUB_ENV) { throw 'GitHub Actions environment file unavailable' }
"STUDYFLOW_PREVIOUS_INSTALLER=$installer" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8
Write-Host "[VERIFIED] Official $previousTag installer: $expectedAsset, SHA-256 $expectedSha"
)
if (-not $versionMatch.Success) {
    throw "Previous release upgrade smoke requires a versioned RC: $version"
}
$prefix = $versionMatch.Groups[1].Value
$number = [int]$versionMatch.Groups[2].Value
if ($number -lt 2) { throw 'No preceding RC available for upgrade validation' }
$previousVersion = "$prefix$($number - 1)"
$previousTag = "v$previousVersion"
$expectedAsset = "StudyFlow_${previousVersion}_x64-setup.exe"
$releaseRepo = '07xh/StudyFlow'
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw 'GitHub CLI is required to download the official previous installer'
}
$releaseJson = gh api "repos/$releaseRepo/releases/tags/$previousTag"
if ($LASTEXITCODE -ne 0) { throw "Could not fetch previous official release metadata: $previousTag" }
$release = $releaseJson | ConvertFrom-Json -ErrorAction Stop
if ($release.draft -or $release.tag_name -cne $previousTag) {
    throw "Previous official release is not published: $previousTag"
}
$assets = @($release.assets | Where-Object { $_.name -ceq $expectedAsset })
if ($assets.Count -ne 1) { throw "Expected one official $expectedAsset asset" }
$asset = $assets[0]
$expectedUrl = "https://github.com/$releaseRepo/releases/download/$previousTag/$expectedAsset"
if ($asset.browser_download_url -cne $expectedUrl -or
    $asset.digest -cnotmatch '^sha256:[a-fA-F0-9]{64}$') {
    throw 'Previous release asset metadata or SHA-256 digest is invalid'
}
$destination = Join-Path $env:RUNNER_TEMP ('StudyFlowPrevious-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $destination -Force | Out-Null
gh release download $previousTag --repo $releaseRepo --pattern $expectedAsset --dir $destination
if ($LASTEXITCODE -ne 0) { throw "Official previous installer download failed: $previousTag" }
$installer = Join-Path $destination $expectedAsset
if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) { throw 'Previous installer not downloaded' }
$actualSha = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash
$expectedSha = $asset.digest.Substring(7)
if ($actualSha -cne $expectedSha.ToUpperInvariant()) {
    throw 'Previous installer SHA-256 does not match GitHub Release metadata'
}
if (-not $env:GITHUB_ENV) { throw 'GitHub Actions environment file unavailable' }
"STUDYFLOW_PREVIOUS_INSTALLER=$installer" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8
Write-Host "[VERIFIED] Official $previousTag installer: $expectedAsset, SHA-256 $expectedSha"
