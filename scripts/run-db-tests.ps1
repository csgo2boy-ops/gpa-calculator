# Local launcher: run from PowerShell; no credentials are sent to chat or saved.
param([switch]$Concurrency, [switch]$Cleanup)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$previousLocation = Get-Location
$previousPassword = $env:GPA_TEST_PASSWORD
try {
    Set-Location -LiteralPath $repo
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        throw 'Install Node.js 20+ first.'
    }
    $runnerArgs = @('scripts/test-supabase-safety.cjs')
    if ($Cleanup) { $runnerArgs += '--cleanup' }
    elseif ($Concurrency) { $runnerArgs += '--concurrency' }
    & node @runnerArgs --initialize-only
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the new local report.' }
    if (-not (Test-Path -LiteralPath 'node_modules/pg/package.json') -or
        -not (Test-Path -LiteralPath 'node_modules/ajv/package.json')) {
        & npm.cmd ci --ignore-scripts --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. No database connection attempted.' }
    }
    if (-not (Test-Path -LiteralPath 'db-test.local.json')) {
        Write-Host 'Only use the gpa-tracker-test project. Do not enter production details.'
        $testRef = Read-Host 'Test project reference (Dashboard project URL, 20 letters)'
        $confirmRef = Read-Host 'Re-enter test project reference to confirm'
        $poolHost = Read-Host 'Session pooler host from Connect (port 5432)'
        $configuration = [ordered]@{
            projectName = 'gpa-tracker-test'
            projectRef = $testRef
            confirmTestProjectRef = $confirmRef
            host = $poolHost
            port = 5432
            database = 'postgres'
            user = "postgres.$testRef"
        }
        $configuration | ConvertTo-Json | Set-Content -LiteralPath 'db-test.local.json' -Encoding utf8
    } else {
        try {
            $configuration = Get-Content -LiteralPath 'db-test.local.json' -Raw | ConvertFrom-Json -ErrorAction Stop
            if (-not $configuration.confirmTestProjectRef) {
                $confirmRef = Read-Host 'Re-enter the gpa-tracker-test project reference to confirm'
                $configuration | Add-Member -NotePropertyName confirmTestProjectRef -NotePropertyValue $confirmRef
                $configuration | ConvertTo-Json | Set-Content -LiteralPath 'db-test.local.json' -Encoding utf8
            }
        } catch {
            # Let Node replace the report and report a sanitized config failure.
            & node @runnerArgs
            return
        }
    }
    $secret = Read-Host 'gpa-tracker-test database password (hidden, not stored)' -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    try {
        $env:GPA_TEST_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
        & node @runnerArgs
        if ($LASTEXITCODE -ne 0) {
            Write-Host 'Run did not pass. See the new local JSON/Markdown report.'
        }
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
} finally {
    $env:GPA_TEST_PASSWORD = $previousPassword
    Set-Location -LiteralPath $previousLocation
}
