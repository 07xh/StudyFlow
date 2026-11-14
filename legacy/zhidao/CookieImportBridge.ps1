param(
    [Parameter(Mandatory=$true)][ValidateSet('file','text')][string]$Mode,
    [Parameter(Mandatory=$true)][string]$InputPath,
    [Parameter(Mandatory=$true)][string]$DoctorExecutable,
    [Parameter(Mandatory=$true)][ValidateSet('frozen','module')][string]$DoctorMode
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if ([string]::IsNullOrWhiteSpace($env:USERPROFILE)) {
    [Console]::Out.WriteLine('{"imported":false,"message":"Windows 用户目录不可用。"}')
    exit 1
}
$script:dataDir = Join-Path $env:USERPROFILE '.zhs'
$script:cookiePath = Join-Path $script:dataDir 'cookies.json'
$script:cookieImportActive = $false
$script:cookieImportPreviousExists = $false
$script:cookieImportPreviousBytes = $null
$script:cookieImportExpectedDigest = ''
. (Join-Path $PSScriptRoot 'SessionState.ps1')
. (Join-Path $PSScriptRoot 'CookieImport.ps1')
try {
    if (-not (Test-Path -LiteralPath $InputPath -PathType Leaf)) { throw 'NO_INPUT' }
    if ($Mode -eq 'file') {
        $json = Read-ZhidaoCookieImport $InputPath
    } else {
        $decoder = [System.Text.UTF8Encoding]::new($false, $true)
        $raw = [System.IO.File]::ReadAllText($InputPath, $decoder)
        $json = Convert-ZhidaoCookieText $raw
    }
    Begin-ZhidaoCookieImport $json
    if ($DoctorMode -eq 'frozen') {
        $arguments = @('--zhidao-readonly', 'doctor-server')
    } else {
        $arguments = @('-m', 'studyflow.platforms.zhidao.upstream.zhidao_only', 'doctor-server')
    }
    $process = Start-Process -FilePath $DoctorExecutable -ArgumentList $arguments -WorkingDirectory $env:USERPROFILE -Wait -PassThru -WindowStyle Hidden
    $message = Complete-ZhidaoCookieImport $process.ExitCode
    $accepted = $process.ExitCode -in @(0, 6, 7)
    $result = [ordered]@{ imported = [bool]$accepted; message = [string]$message }
    [Console]::Out.WriteLine((ConvertTo-Json -InputObject $result -Compress))
    if (-not $accepted) { exit 1 }
    exit 0
} catch {
    if ($script:cookieImportActive) {
        try { $null = Complete-ZhidaoCookieImport $null } catch { }
    }
    [Console]::Out.WriteLine('{"imported":false,"message":"Cookie 导入或服务器核验失败；原有登录状态已保留或尝试恢复。"}')
    exit 1
}
