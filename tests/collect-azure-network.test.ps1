#requires -Version 7.0
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot
$output = Join-Path $repo 'test-artifacts' 'azure-files' 'collector-network'
$null = New-Item -ItemType Directory -Force -Path $output
$subscription = '11111111-1111-1111-1111-111111111111'
$prefix = "/subscriptions/$subscription/resourceGroups/network/providers/Microsoft.Network"
$pwshPath = (Get-Process -Id $PID).Path
$fixture = Join-Path $PSScriptRoot 'fixtures' 'az-network.ps1'
if ($IsWindows) {
    Set-Content (Join-Path $output 'az.cmd') "@echo off`r`n`"$pwshPath`" -NoLogo -NoProfile -File `"$fixture`" %*"
} else {
    $wrapper = Join-Path $output 'az'
    Set-Content $wrapper "#!/bin/sh`nexec '$pwshPath' -NoLogo -NoProfile -File '$fixture' `"`$@`""
    & chmod +x $wrapper
}
function Assert($Condition, [string]$Message) { if (!$Condition) { throw $Message } }
$originalPath = $env:PATH
try {
    $env:PATH = "$output$([IO.Path]::PathSeparator)$originalPath"
    $env:MOCK_NETWORK_LOG = Join-Path $output 'requests.log'
    foreach ($mode in @('direct', 'subnet-reference', 'empty', 'denied', 'failed', 'timeout', 'oversize', 'stderr-limit', 'long-field', 'unsupported', 'bad-json', 'bad-envelope')) {
        $env:MOCK_NETWORK_MODE = $mode
        $file = Join-Path $output "$mode.json"
        $watch = [Diagnostics.Stopwatch]::StartNew()
        & (Join-Path $repo 'public' 'scripts' 'collect-azure-network.ps1') `
            -ResourceGroupName network -SubscriptionId $subscription -OutputFile $file -Force `
            -IncludeEffectiveRoutes -CommandTimeoutSeconds 5 -MaxOutputChars 8192
        $text = Get-Content -LiteralPath $file -Raw
        $capture = $text | ConvertFrom-Json
        Assert (!$text.Contains('must-not-be-exported')) "$mode leaked raw fields or CLI error text."
        Assert ($capture.observationVersion -eq 1 -and $capture.version -eq 2) "$mode lost compatible versioned provenance."
        foreach ($name in @('first', 'second')) {
            $server = $capture.routeServers | Where-Object name -eq "ars-$name"
            Assert ($server.subnetId -eq "$prefix/virtualNetworks/vnet-$name/subnets/RouteServerSubnet") "$mode has incorrect Route Server ownership."
        }
        Assert ($capture.arsLearnedRoutes.'ars-first/same-peer'.Count -eq 1 -and $capture.arsLearnedRoutes.'ars-second/same-peer'.Count -eq 1) "$mode overwrote a same-named peer from another server."
        $expected = switch ($mode) {
            'timeout' { 'timed-out' }
            { $_ -in @('oversize','stderr-limit','long-field') } { 'truncated' }
            'unsupported' { 'unsupported' }
            { $_ -in @('bad-json','bad-envelope') } { 'failed' }
            'empty' { 'empty' }
            default { 'succeeded' }
        }
        Assert ($capture.nicEffectiveRoutes[0].observation.state -eq $expected) "$mode did not distinguish NIC observation state."
        if ($mode -eq 'denied') { Assert ($capture.sections.routeTables.state -eq 'denied' -and !$capture.complete) 'Denial became successful emptiness.' }
        if ($mode -eq 'failed') { Assert ($capture.sections.vnetGateways.state -eq 'failed' -and !$capture.complete) 'Failure became successful emptiness.' }
        if ($mode -eq 'timeout') { Assert ($watch.Elapsed.TotalSeconds -lt 35) 'Timed-out subprocess or descendant was not bounded.' }
        Write-Host "Passed $mode bounded capture, projections and provenance."
    }
    $env:MOCK_NETWORK_MODE = 'direct'
    $configFile = Join-Path $output 'configuration-only.json'
    & (Join-Path $repo 'public' 'scripts' 'collect-azure-network.ps1') -ResourceGroupName network -OutputFile $configFile -Force
    $config = Get-Content $configFile -Raw | ConvertFrom-Json
    Assert ($config.subscriptionId -eq $subscription -and $config.configurationComplete) 'Observed subscription was not pinned for configuration reads.'
    Assert ($config.sections.nicEffectiveRoutes.state -eq 'not-requested' -and !$config.sections.nicEffectiveRoutes.complete) 'Unrequested observations were declared complete.'
    $budgetFile = Join-Path $output 'overall-budget.json'
    $watch = [Diagnostics.Stopwatch]::StartNew()
    & (Join-Path $repo 'public' 'scripts' 'collect-azure-network.ps1') -ResourceGroupName network -SubscriptionId $subscription `
        -OutputFile $budgetFile -Force -OverallTimeoutSeconds 1
    $budget = Get-Content $budgetFile -Raw | ConvertFrom-Json
    Assert (!$budget.configurationComplete -and $budget.sections.vnets.state -eq 'timed-out' -and $watch.Elapsed.TotalSeconds -lt 8) 'Overall deadline was not enforced.'
    Write-Host 'Passed optional observations, pinned ambient scope and overall deadline.'
} finally {
    $env:PATH = $originalPath
    Remove-Item Env:\MOCK_NETWORK_MODE, Env:\MOCK_NETWORK_LOG -ErrorAction SilentlyContinue
}
