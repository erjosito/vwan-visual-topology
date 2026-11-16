#requires -Version 7.0
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot
$subscription = '11111111-1111-1111-1111-111111111111'
$tenant = '22222222-2222-2222-2222-222222222222'
$global:desktopWrapperMode = 'valid'
$global:desktopWrapperCalls = [Collections.Generic.List[object]]::new()
function az {
    if ($env:AZURE_CORE_COLLECT_TELEMETRY -ne 'no' -or $env:AZURE_LOGGING_ENABLE_LOG_FILE -ne 'no') {
        throw 'CLI telemetry and command-file logging must be disabled before the first read.'
    }
    $global:desktopWrapperCalls.Add(@($args))
    $global:LASTEXITCODE = 0
    $operation = $args[0..1] -join ' '
    if ($global:desktopWrapperMode -eq 'expired') { $global:LASTEXITCODE = 1; return }
    switch ($operation) {
        'account show' {
            @{ id = $subscription; tenantId = $(if ($global:desktopWrapperMode -eq 'wrong-tenant') { $subscription } else { $tenant }); environmentName = $(if ($global:desktopWrapperMode -eq 'wrong-cloud') { 'AzureUSGovernment' } else { 'AzureCloud' }) } | ConvertTo-Json -Compress
        }
        'group list' { '[{"name":"fixture-network","id":"fixture-group"}]' }
        'network vwan' { '[{"name":"fixture-wan","id":"fixture-wan"}]' }
        default { throw "Unexpected privileged/unsupported CLI operation: $operation" }
    }
}
$wrapper = Join-Path $repo 'platform' 'electron' 'azure-read.ps1'
$env:AZURE_CORE_COLLECT_TELEMETRY = 'yes'
$env:AZURE_LOGGING_ENABLE_LOG_FILE = 'yes'
foreach ($global:desktopWrapperMode in @('expired', 'wrong-tenant', 'wrong-cloud')) {
    $global:desktopWrapperCalls.Clear()
    $rejected = $false
    try { & $wrapper -Operation targets -SubscriptionId $subscription -TenantId $tenant | Out-Null }
    catch { $rejected = $true }
    if (!$rejected -or $global:desktopWrapperCalls.Count -ne 1) { throw "$global:desktopWrapperMode must stop before resource discovery." }
}
$global:desktopWrapperMode = 'valid'
$global:desktopWrapperCalls.Clear()
$result = & $wrapper -Operation targets -SubscriptionId $subscription -TenantId $tenant | ConvertFrom-Json
if ($result.groups.Count -ne 1 -or $result.wans.Count -ne 1 -or $global:desktopWrapperCalls.Count -ne 3) { throw 'Target discovery failed.' }
foreach ($call in $global:desktopWrapperCalls) {
    $index = [Array]::IndexOf($call, '--subscription')
    if ($index -lt 0 -or $call[$index + 1] -ne $subscription) { throw 'Every resource read must retain explicit subscription scope.' }
}
if ($env:AZURE_EXTENSION_USE_DYNAMIC_INSTALL -ne 'no') { throw 'Dynamic extension installation must stay disabled.' }
Write-Host 'Desktop wrapper passed (mock CLI): expired session, wrong tenant/cloud, fixed read-only operations, explicit scope and inherited telemetry/logging opt-out.'
