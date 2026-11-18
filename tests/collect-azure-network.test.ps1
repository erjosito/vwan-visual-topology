#requires -Version 7.0
param([switch]$VpnNatOnly, [switch]$SubnetPeeringOnly, [switch]$BgpNeighborsOnly)
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
    $natModes = @('vpn-nat-gateway', 'vpn-nat-ingress', 'vpn-nat-egress')
    $modes = if ($BgpNeighborsOnly) { @('bgp-neighbors') } elseif ($SubnetPeeringOnly) { @('subnet-peering') } elseif ($VpnNatOnly) { $natModes } else {
        @('direct', 'subnet-reference', 'empty', 'denied', 'failed', 'timeout', 'oversize', 'stderr-limit', 'long-field', 'unsupported', 'bad-json', 'bad-envelope', 'nat-prefix', 'nat-denied', 'nat-unsupported-sku', 'nat-unallocated', 'subnet-peering', 'bgp-neighbors') + $natModes
    }
    $importer = Join-Path $output 'vpn-nat-importer.cjs'
    @'
const { join } = require('node:path');
const { createRequire } = require('node:module');
const [repo, output] = process.argv.slice(2);
createRequire(join(repo, 'package.json'))('esbuild').buildSync({
  entryPoints: [join(repo, 'src', 'azure-net', 'azure-import.ts')], outfile: output,
  bundle: true, platform: 'node', format: 'cjs',
});
'@ | node - $repo $importer
    Assert ($LASTEXITCODE -eq 0) 'Could not build the current capture importer for collector integration.'
    foreach ($mode in $modes) {
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
        if ($mode -eq 'bgp-neighbors') {
            $peer = $capture.vngBgpPeerStatus.vpn[0]
            Assert ($peer.localAddress -eq '10.82.253.4' -and $peer.neighbor -eq '192.0.2.9') 'Captured BGP endpoint identities were lost.'
            Assert ($peer.routesReceived -eq 0 -and $peer.messagesSent -eq 12 -and $peer.messagesReceived -eq 11 -and $peer.connectedDuration -eq '00:01:00') 'Captured BGP counters were dropped or invented.'
            Assert ($capture.sections.'vngBgpPeerStatus:vpn'.complete) 'Successful neighbor projection lost capture coverage.'
            @'
const { readFileSync } = require('node:fs');
const { importAzNetCapture } = require(process.argv[2]);
const capture = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const observed = importAzNetCapture(capture).observations;
require('node:assert/strict').deepEqual(JSON.parse(JSON.stringify(observed.vngBgpPeerStatus)), capture.vngBgpPeerStatus);
'@ | node - $importer $file
            Assert ($LASTEXITCODE -eq 0) 'Collected BGP neighbors did not survive current capture import.'
        }
        if ($mode -eq 'subnet-peering') {
            foreach ($vnet in $capture.vnets) {
                $peer = $vnet.virtualNetworkPeerings[0]
                Assert ($peer.peerCompleteVnets -eq $false -and $peer.enableOnlyIPv6Peering -eq $false) 'Subnet peering type was lost during collection.'
                Assert ($peer.localSubnetNames[0] -eq 'RouteServerSubnet' -and $peer.remoteSubnetNames[0] -eq 'RouteServerSubnet') 'Participating subnet names were not preserved.'
            }
            @'
const { readFileSync } = require('node:fs');
const { importAzNetCapture } = require(process.argv[2]);
const topology = importAzNetCapture(readFileSync(process.argv[3], 'utf8')).topology;
if (topology.vnetPeerings.length !== 1 || topology.vnetPeerings[0].scope?.type !== 'subnets') throw new Error('Collected subnet peering became whole-VNet peering.');
for (const ids of [topology.vnetPeerings[0].scope.subnetAIds, topology.vnetPeerings[0].scope.subnetBIds]) {
  if (ids.length !== 1) throw new Error('Collected participating subnet identity was lost.');
}
'@ | node - $importer $file
            Assert ($LASTEXITCODE -eq 0) 'Collected subnet-peering scope did not survive current capture import.'
        }
        foreach ($name in @('first', 'second')) {
            $server = $capture.routeServers | Where-Object name -eq "ars-$name"
            Assert ($server.subnetId -eq "$prefix/virtualNetworks/vnet-$name/subnets/RouteServerSubnet") "$mode has incorrect Route Server ownership."
        }
        Assert ($capture.arsLearnedRoutes.'ars-first/same-peer'.Count -eq 1 -and $capture.arsLearnedRoutes.'ars-second/same-peer'.Count -eq 1) "$mode overwrote a same-named peer from another server."
        if ($mode -in $natModes) {
            $reference = "$prefix/virtualNetworkGateways/vpn/natRules/overlap"
            $observed = switch ($mode) {
                'vpn-nat-gateway' { $capture.vnetGateways[0].natRules }
                'vpn-nat-ingress' { $capture.vpnConnections[0].ingressNatRules }
                'vpn-nat-egress' { $capture.vpnConnections[0].egressNatRules }
            }
            Assert ($observed.Count -eq 1 -and $observed[0].id -eq $reference) "$mode lost known original VPN NAT association."
            Assert ($observed[0].PSObject.Properties.Count -eq 1) "$mode reconstructed NAT mappings instead of observing reference IDs only."
            Assert ($capture.configurationComplete) "$mode masked a lost NAT reference as incomplete capture."
            $requests = Get-Content -LiteralPath $env:MOCK_NETWORK_LOG | ForEach-Object { ,($_ | ConvertFrom-Json) }
            $gatewayRequest = $requests | Where-Object { $_[0..2] -join ' ' -eq 'network vnet-gateway list' } | Select-Object -Last 1
            $connectionRequest = $requests | Where-Object { $_[0..2] -join ' ' -eq 'network vpn-connection list' } | Select-Object -Last 1
            Assert (($gatewayRequest -join ' ') -match 'natRules\[\]\.\{id:id\}') "$mode did not request allowlisted gateway NAT references from Azure CLI."
            Assert (($connectionRequest -join ' ') -match 'ingressNatRules\[\]\.\{id:id\}' -and
                ($connectionRequest -join ' ') -match 'egressNatRules\[\]\.\{id:id\}') "$mode did not request both allowlisted connection NAT references from Azure CLI."
            @'
const { readFileSync } = require('node:fs');
const { importAzNetCapture } = require(process.argv[2]);
let rejected = false;
try { importAzNetCapture(readFileSync(process.argv[3], 'utf8')); }
catch (error) {
  if (!String(error.message).includes('VPN overlap NAT capture reconstruction is unsupported')) throw error;
  rejected = true;
}
if (!rejected) throw new Error('Known collected VPN NAT became healthy ordinary routing.');
'@ | node - $importer $file
            Assert ($LASTEXITCODE -eq 0) "$mode bypassed current importer NAT rejection."
        }
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
    if ($VpnNatOnly -or $SubnetPeeringOnly -or $BgpNeighborsOnly) { return }
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
