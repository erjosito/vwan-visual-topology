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
    $env:MOCK_NETWORK_TIMEOUT_START = Join-Path $output 'timeout-start-ticks.txt'
    foreach ($mode in @('direct', 'subnet-reference', 'empty', 'denied', 'failed', 'timeout', 'oversize', 'stderr-limit', 'long-field', 'unsupported', 'bad-json', 'bad-envelope', 'nat-prefix', 'nat-denied', 'nat-unsupported-sku', 'nat-unallocated')) {
        $env:MOCK_NETWORK_MODE = $mode
        $file = Join-Path $output "$mode.json"
        $watch = [Diagnostics.Stopwatch]::StartNew()
        & (Join-Path $repo 'public' 'scripts' 'collect-azure-network.ps1') `
            -ResourceGroupName network -SubscriptionId $subscription -OutputFile $file -Force `
            -IncludeEffectiveRoutes -CommandTimeoutSeconds 5 -MaxOutputChars 8192
        $text = Get-Content -LiteralPath $file -Raw
        $capture = $text | ConvertFrom-Json
        Assert (!$text.Contains('must-not-be-exported')) "$mode leaked raw fields or CLI error text."
        Assert ($capture.vnets[0].subnets[0].defaultOutboundAccess -eq $false) "$mode lost the explicit private-subnet setting."
        Assert ($capture.vnets[1].subnets[0].natGateway.id -eq "$prefix/natGateways/nat") "$mode lost the original NAT association."
        if ($mode -eq 'nat-denied') {
            Assert ($capture.sections.natGateways.state -eq 'denied' -and !$capture.configurationComplete) 'NAT denial became successful absence.'
        } else { Assert ($capture.natGateways.Count -eq 1) "$mode lost NAT Gateway metadata." }
        if ($mode -eq 'nat-prefix') { Assert ($capture.publicIpPrefixes[0].prefixLength -eq 31) 'Public prefix size was not preserved.' }
        if ($mode -eq 'nat-unallocated') { Assert (!$capture.publicIpAddresses[0].ipAddress) 'An unknown public address was invented.' }
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
        if ($mode -eq 'timeout') {
            $started = [long](Get-Content -LiteralPath $env:MOCK_NETWORK_TIMEOUT_START -Raw)
            $timeoutElapsed = ([Diagnostics.Stopwatch]::GetTimestamp() - $started) / [Diagnostics.Stopwatch]::Frequency
            Assert ($timeoutElapsed -lt 8) 'Timed-out subprocess or descendant was not bounded.'
        }
        Write-Host "Passed $mode bounded capture, projections and provenance."
    }
    $env:MOCK_NETWORK_MODE = 'direct'
    $configFile = Join-Path $output 'configuration-only.json'
    & (Join-Path $repo 'public' 'scripts' 'collect-azure-network.ps1') -ResourceGroupName network -OutputFile $configFile -Force
    $config = Get-Content $configFile -Raw | ConvertFrom-Json
    Assert ($config.subscriptionId -eq $subscription -and $config.configurationComplete) 'Observed subscription was not pinned for configuration reads.'
    Assert ($config.sections.nicEffectiveRoutes.state -eq 'not-requested' -and !$config.sections.nicEffectiveRoutes.complete) 'Unrequested observations were declared complete.'
    $env:MOCK_NETWORK_MODE = 'overall-budget'
    $budgetFile = Join-Path $output 'overall-budget.json'
    $watch = [Diagnostics.Stopwatch]::StartNew()
    & (Join-Path $repo 'public' 'scripts' 'collect-azure-network.ps1') -ResourceGroupName network -SubscriptionId $subscription `
        -OutputFile $budgetFile -Force -OverallTimeoutSeconds 1
    $budget = Get-Content $budgetFile -Raw | ConvertFrom-Json
    Assert (!$budget.configurationComplete -and $budget.sections.vnets.state -eq 'timed-out' -and $watch.Elapsed.TotalSeconds -lt 8) 'Overall deadline was not enforced.'
    Write-Host 'Passed optional observations, pinned ambient scope and overall deadline.'
    foreach ($mode in @('connectivity', 'connectivity-denied', 'connectivity-truncated', 'connectivity-group-denied')) {
        $env:MOCK_NETWORK_MODE = $mode
        $file = Join-Path $output "$mode.json"
        & (Join-Path $repo 'public' 'scripts' 'collect-azure-network.ps1') -ResourceGroupName network -SubscriptionId $subscription `
            -OutputFile $file -Force -CommandTimeoutSeconds 5 -MaxOutputChars 16384
        $text = Get-Content -LiteralPath $file -Raw
        $capture = $text | ConvertFrom-Json
        Assert (!$text.Contains('must-not-be-exported')) "$mode leaked guest, secret, health or error fields."
        Assert ($capture.connectivityVersion -eq 1) "$mode lost the connectivity schema discriminator."
        Assert ($capture.virtualMachines[0].networkProfile.networkInterfaces[0].id -eq "$prefix/networkInterfaces/server") "$mode lost original VM/NIC binding."
        Assert ($capture.networkInterfaces[0].ipConfigurations[0].privateIPAddress -eq '10.82.1.4') "$mode lost SDK-cased NIC addressing."
        Assert ($capture.networkInterfaces[0].ipConfigurations[0].loadBalancerBackendAddressPools[0].id -eq "$prefix/loadBalancers/service/backendAddressPools/servers") "$mode lost NIC pool membership."
        Assert ($capture.publicIpAddresses[1].publicIPAllocationMethod -eq 'Static') "$mode lost SDK-cased public allocation."
        Assert ($capture.azureFirewalls[0].ipConfigurations[0].privateIPAddress -eq '10.82.2.4') "$mode lost SDK-cased Firewall addressing."
        if ($mode -eq 'connectivity-denied') {
            Assert ($capture.sections.networkSecurityGroups.state -eq 'denied' -and !$capture.configurationComplete) 'Denied filtering became observed absence.'
        } elseif ($mode -eq 'connectivity-truncated') {
            Assert ($capture.sections.loadBalancers.state -eq 'truncated' -and !$capture.configurationComplete) 'Truncated LB configuration became observed absence.'
        } elseif ($mode -eq 'connectivity-group-denied') {
            Assert ($capture.sections.'firewallPolicyRuleCollectionGroups:policy'.state -eq 'denied' -and !$capture.configurationComplete) 'Denied policy group became an observed empty policy.'
        } else {
            Assert ($capture.configurationComplete) 'Supported nonempty configuration was not collected completely.'
            Assert ($capture.loadBalancers[0].backendAddressPools[0].backendIPConfigurations[0].id -eq "$prefix/networkInterfaces/server/ipConfigurations/primary") 'Original LB backend was lost.'
            Assert ($capture.firewallPolicyRuleCollectionGroups[0].groups[0].ruleCollections[0].rules[0].translatedAddress -eq '10.82.1.4') 'Original Firewall DNAT backend was lost.'
        }
        Write-Host "Passed $mode original connectivity projection and uncertainty."
    }
} finally {
    $env:PATH = $originalPath
    Remove-Item Env:\MOCK_NETWORK_MODE, Env:\MOCK_NETWORK_LOG, Env:\MOCK_NETWORK_TIMEOUT_START -ErrorAction SilentlyContinue
}
