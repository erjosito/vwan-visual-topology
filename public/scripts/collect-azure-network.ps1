#requires -Version 7.0
<#
.SYNOPSIS
Read an Azure Resource Group's standalone networking topology into a local v2 simulator capture.
.DESCRIPTION
Reads Virtual Networks, Subnets, VNet Peerings, Route Tables (UDRs), Virtual Network Gateways,
Azure Route Servers (including BGP peerings), Private Endpoints, and Network Interfaces in a
single Azure Resource Group using read-only Azure CLI commands.
When -IncludeEffectiveRoutes is set, also captures NIC effective route tables (including any
GatewaySubnet proxy NIC) and Azure Route Server learned/advertised BGP routes.
All resource reads pin the selected subscription and project non-secret fields.
VPN NAT is observed as gateway rule IDs and connection ingress/egress reference IDs only;
rule mappings and secrets are not collected, and import rejects observed associations.
Capture v2 adds observationVersion=1 and explicit section states; older v2 files remain importable.
Limits: 500 invocations, 20 minutes overall, 60 seconds/invocation by default,
2 million stdout characters, 65536 stderr characters, 6 MB projected data and 8 MB final UTF-8.
Failures preserve partial observations, not invented empty network state. No CLI error text is exported.
.EXAMPLE
./collect-azure-network.ps1 -ResourceGroupName 'rg-aznet-sim-lab-20261103' -IncludeEffectiveRoutes -OutputFile ./azure-net-capture.json -Force
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ResourceGroupName,
    [string]$SubscriptionId = '',
    [string]$OutputFile = './azure-net-capture.json',
    [switch]$IncludeEffectiveRoutes,
    [ValidateRange(1, 180)][int]$CommandTimeoutSeconds = 60,
    [ValidateRange(1, 1200)][int]$OverallTimeoutSeconds = 1200,
    [ValidateRange(1024, 8000000)][int]$MaxOutputChars = 2000000,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
if ((Test-Path -LiteralPath $OutputFile) -and !$Force) {
    throw "Output file '$OutputFile' already exists. Pass -Force to overwrite."
}

$warnings = [System.Collections.Generic.List[string]]::new()
$sections = [ordered]@{}
$clock = [Diagnostics.Stopwatch]::StartNew()
$script:requests = 0
$script:projectedBytes = 0
$azPath = (Get-Command az -ErrorAction Stop).Source
$subArgs = @()
if ($SubscriptionId) {
    $subArgs = @('--subscription', $SubscriptionId)
}

function Invoke-CaptureAz([string[]]$Arguments) {
    $remaining = $OverallTimeoutSeconds * 1000 - $clock.ElapsedMilliseconds
    if ($remaining -le 0) { throw 'TIMED_OUT' }
    if (++$script:requests -gt 500) { throw 'TRUNCATED' }
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.UseShellExecute = $false
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.Environment['AZURE_EXTENSION_USE_DYNAMIC_INSTALL'] = 'no'
    if ($IsWindows -and [IO.Path]::GetExtension($azPath) -in @('.cmd', '.bat')) {
        $info.FileName = $env:ComSpec
        $info.Environment['AZNET_CAPTURE_AZ'] = $azPath
        $quoted = for ($i = 0; $i -lt $Arguments.Count; $i++) {
            if ($Arguments[$i] -match '["\r\n\x00]') { throw 'FAILED' }
            $info.Environment["AZNET_CAPTURE_ARG_$i"] = $Arguments[$i]
            '"%AZNET_CAPTURE_ARG_' + $i + '%"'
        }
        $info.Arguments = '/d /v:off /s /c ""%AZNET_CAPTURE_AZ%" ' + ($quoted -join ' ') + '"'
    } else {
        $info.FileName = $azPath
        foreach ($arg in $Arguments) { $info.ArgumentList.Add($arg) }
    }
    $process = [Diagnostics.Process]::Start($info)
    $watch = [Diagnostics.Stopwatch]::StartNew()
    try {
        $outBuffer = [char[]]::new(8192)
        $errBuffer = [char[]]::new(8192)
        $stdout = [Text.StringBuilder]::new()
        $stderr = [Text.StringBuilder]::new()
        $outTask = $process.StandardOutput.ReadAsync($outBuffer, 0, $outBuffer.Length)
        $errTask = $process.StandardError.ReadAsync($errBuffer, 0, $errBuffer.Length)
        while ($null -ne $outTask -or $null -ne $errTask -or !$process.HasExited) {
            if ($watch.ElapsedMilliseconds -gt [Math]::Min($CommandTimeoutSeconds * 1000, $remaining)) { throw 'TIMED_OUT' }
            if ($null -ne $outTask -and $outTask.IsCompleted) {
                $count = $outTask.GetAwaiter().GetResult()
                if (!$count) { $outTask = $null } else {
                    if ($stdout.Length + $count -gt $MaxOutputChars) { throw 'TRUNCATED' }
                    $null = $stdout.Append($outBuffer, 0, $count)
                    $outTask = $process.StandardOutput.ReadAsync($outBuffer, 0, $outBuffer.Length)
                }
            }
            if ($null -ne $errTask -and $errTask.IsCompleted) {
                $count = $errTask.GetAwaiter().GetResult()
                if (!$count) { $errTask = $null } else {
                    if ($stderr.Length + $count -gt 65536) { throw 'TRUNCATED' }
                    $null = $stderr.Append($errBuffer, 0, $count)
                    $errTask = $process.StandardError.ReadAsync($errBuffer, 0, $errBuffer.Length)
                }
            }
            Start-Sleep -Milliseconds 5
        }
        $process.WaitForExit()
        if ($process.ExitCode -ne 0) {
            if ($stderr.ToString() -match '(?i)\b(AuthorizationFailed|Forbidden|AuthorizationDenied|403)\b') { throw 'DENIED' }
            if ($stderr.ToString() -match '(?i)(unrecognized arguments|not recognized|requires the extension|NotSupported|InvalidApiVersionParameter)') { throw 'UNSUPPORTED' }
            throw 'FAILED'
        }
        return ,($stdout.ToString() | ConvertFrom-Json -AsHashtable -NoEnumerate -Depth 50)
    } finally {
        if (!$process.HasExited) { $process.Kill($true); $process.WaitForExit() }
        $process.Dispose()
    }
}

# Project both before CLI output and before serialization; no raw resource or CLI error text is exported.
function Select-CaptureFields($Data, $Shape) {
    if ($null -eq $Data) { return $null }
    if ($Shape -is [array]) {
        if ($Data -isnot [array] -or $Data.Count -gt 10000) { throw 'TRUNCATED' }
        return ,@($Data | ForEach-Object { Select-CaptureFields $_ $Shape[0] })
    }
    if ($Shape -is [Collections.IDictionary]) {
        if ($Data -isnot [Collections.IDictionary]) { throw 'FAILED' }
        $result = [ordered]@{}
        foreach ($key in $Shape.Keys) {
            $value = $Data[$key]
            if ($null -eq $value -and $key.Contains('IP')) { $value = $Data[$key.Replace('IP', 'Ip')] }
            if ($null -ne $value) { $result[$key] = Select-CaptureFields $value $Shape[$key] }
        }
        return $result
    }
    if ($Data -is [Collections.IDictionary] -or ($Data -is [array] -and @($Data | Where-Object { $_ -is [Collections.IDictionary] -or $_ -is [array] }).Count)) { throw 'FAILED' }
    if (($Data -is [string] -and $Data.Length -gt 4096) -or
        ($Data -is [array] -and ($Data.Count -gt 10000 -or @($Data | Where-Object { $_ -is [string] -and $_.Length -gt 4096 }).Count))) { throw 'TRUNCATED' }
    if ($Data -is [array]) { return ,$Data }
    return $Data
}
function Get-CaptureQuery($Shape) {
    if ($Shape -is [array]) { return '[].' + (Get-CaptureQuery $Shape[0]) }
    if ($Shape -is [Collections.IDictionary]) {
        $fields = foreach ($key in $Shape.Keys) {
            $source = if ($key.Contains('IP')) { 'not_null(' + $key + ',' + $key.Replace('IP', 'Ip') + ')' } else { $key }
            $value = if ($Shape[$key] -is [array]) { $source + (Get-CaptureQuery $Shape[$key]) }
                elseif ($Shape[$key] -is [Collections.IDictionary]) { $source + '.' + (Get-CaptureQuery $Shape[$key]) }
                else { $source }
            "${key}:$value"
        }
        return '{' + ($fields -join ',') + '}'
    }
}
function Invoke-AzJson([string]$Section, [string[]]$CliArgs, $Shape) {
    try {
        $data = Invoke-CaptureAz ($CliArgs + $subArgs + @('--query', (Get-CaptureQuery $Shape), '--output', 'json', '--only-show-errors'))
        if ($Shape -is [Collections.IDictionary]) {
            if ($Shape.Contains('value') -and ($null -eq $data.value -or $data.value -isnot [array])) { throw 'FAILED' }
            if ($Shape.Contains('RouteServiceRole_IN_0') -and $null -eq $data.RouteServiceRole_IN_0 -and $null -eq $data.RouteServiceRole_IN_1) { throw 'FAILED' }
        }
        $selected = Select-CaptureFields $data $Shape
        if ($null -eq $selected) { throw 'FAILED' }
        $bytes = [Text.Encoding]::UTF8.GetByteCount((ConvertTo-Json -InputObject $selected -Depth 50 -Compress))
        if ($script:projectedBytes + $bytes -gt 6000000) { throw 'TRUNCATED' }
        $script:projectedBytes += $bytes
        $empty = ($selected -is [array] -and !$selected.Count) -or
            ($selected -is [Collections.IDictionary] -and $selected.Contains('value') -and !$selected.value.Count) -or
            ($selected -is [Collections.IDictionary] -and $selected.Contains('RouteServiceRole_IN_0') -and !$selected.RouteServiceRole_IN_0.Count -and !$selected.RouteServiceRole_IN_1.Count)
        $state = if ($empty) { 'empty' } else { 'succeeded' }
        $sections[$Section] = @{ state = $state; complete = $true }
        return $selected
    } catch {
        $state = switch ($_.Exception.Message) {
            'TIMED_OUT' { 'timed-out' }
            'TRUNCATED' { 'truncated' }
            'DENIED' { 'denied' }
            'UNSUPPORTED' { 'unsupported' }
            default { 'failed' }
        }
        $sections[$Section] = @{ state = $state; complete = $false }
        if ($warnings.Count -lt 100) { $warnings.Add("Section '$Section' is $state; missing data is not evidence of absence.") }
        return $null
    }
}
$ref = @{ id = $true }
$ipConfiguration = @{ id = $true; name = $true; privateIPAddress = $true; primary = $true; subnet = $ref; publicIPAddress = $ref; loadBalancerBackendAddressPools = @($ref); loadBalancerInboundNatRules = @($ref) }
$bgp = @{ asn = $true; bgpPeeringAddress = $true }
$route = @{ name = $true; addressPrefix = $true; nextHopType = $true; nextHopIpAddress = $true }
$peer = @{ id = $true; name = $true; remoteVirtualNetwork = $ref; allowVirtualNetworkAccess = $true; allowForwardedTraffic = $true; allowGatewayTransit = $true; useRemoteGateways = $true; peerCompleteVnets = $true; localSubnetNames = $true; remoteSubnetNames = $true; enableOnlyIPv6Peering = $true }
$subnet = @{ id = $true; name = $true; addressPrefix = $true; addressPrefixes = $true; routeTable = $ref; networkSecurityGroup = $ref; defaultOutboundAccess = $true; natGateway = $ref; privateEndpointNetworkPolicies = $true; delegations = @(@{ serviceName = $true }); serviceEndpoints = @(@{ service = $true }); ipConfigurations = @($ref) }
$vnet = @{ id = $true; name = $true; location = $true; addressSpace = @{ addressPrefixes = $true }; subnets = @($subnet); virtualNetworkPeerings = @($peer); summarizedGatewayPrefixes = @{ addressPrefixes = $true } }
$gateway = @{ id = $true; name = $true; gatewayType = $true; enableBgp = $true; activeActive = $true; bgpSettings = $bgp; ipConfigurations = @($ipConfiguration); natRules = @($ref) }
$bgpRoute = @{ network = $true; nextHop = $true; sourcePeer = $true; origin = $true; asPath = $true; localAddress = $true; weight = $true }
$account = Invoke-AzJson 'account' @('account', 'show') @{ id = $true; tenantId = $true; environmentName = $true }
$resolvedSubId = if ($SubscriptionId) { $SubscriptionId } elseif ($account) { [string]$account.id } else { '' }
if ($resolvedSubId -notmatch '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$') { throw 'A valid explicit or observed subscription ID is required.' }
if ($account -and $account.id -and $account.id -ine $resolvedSubId) { throw 'Selected account subscription does not match requested scope.' }
$subArgs = @('--subscription', $resolvedSubId)
$context = @{ subscriptionId = $resolvedSubId; tenantId = $account.tenantId; cloud = $account.environmentName }
if ($context.tenantId -isnot [string] -or $context.tenantId -notmatch '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$') { $context.tenantId = $null }
if ($context.cloud -isnot [string] -or $context.cloud -notmatch '^[A-Za-z][A-Za-z0-9]{0,40}$') { $context.cloud = $null }
if (!$context.cloud) { $warnings.Add('Account cloud is unknown; public-Azure semantics are not confirmed.') }
elseif ($context.cloud -ne 'AzureCloud') { $warnings.Add('Non-public Azure cloud: simulator coverage is unsupported.') }

Write-Host "[1/6] Reading Route Tables and Virtual Networks in '$ResourceGroupName'..."
$routeTables = @(Invoke-AzJson 'routeTables' @('network', 'route-table', 'list', '-g', $ResourceGroupName) @(@{ id = $true; name = $true; disableBgpRoutePropagation = $true; routes = @($route) }))
$vnets = @(Invoke-AzJson 'vnets' @('network', 'vnet', 'list', '-g', $ResourceGroupName) @($vnet))
$publicIpAddresses = @(Invoke-AzJson 'publicIpAddresses' @('network', 'public-ip', 'list', '-g', $ResourceGroupName) @(@{ id = $true; name = $true; sku = @{ name = $true }; ipAddress = $true; publicIPAllocationMethod = $true; publicIPAddressVersion = $true; ipConfiguration = $ref; natGateway = $ref }))
$publicIpPrefixes = @(Invoke-AzJson 'publicIpPrefixes' @('network', 'public-ip', 'prefix', 'list', '-g', $ResourceGroupName) @(@{ id = $true; name = $true; sku = @{ name = $true }; ipPrefix = $true; prefixLength = $true; publicIPAddressVersion = $true }))
$natGateways = @(Invoke-AzJson 'natGateways' @('network', 'nat', 'gateway', 'list', '-g', $ResourceGroupName) @(@{ id = $true; name = $true; sku = @{ name = $true }; subnets = @($ref); publicIpAddresses = @($ref); publicIpPrefixes = @($ref) }))

Write-Host "[2/6] Reading Virtual Network Gateways, Local Gateways, Connections, and Route Servers..."
$vnetGateways = @(Invoke-AzJson 'vnetGateways' @('network', 'vnet-gateway', 'list', '-g', $ResourceGroupName) @($gateway))
$localNetworkGateways = @(Invoke-AzJson 'localNetworkGateways' @('network', 'local-gateway', 'list', '-g', $ResourceGroupName) @(@{ id = $true; name = $true; bgpSettings = $bgp; localNetworkAddressSpace = @{ addressPrefixes = $true } }))
$vpnConnections = @(Invoke-AzJson 'vpnConnections' @('network', 'vpn-connection', 'list', '-g', $ResourceGroupName) @(@{ id = $true; name = $true; enableBgp = $true; virtualNetworkGateway1 = $ref; localNetworkGateway2 = $ref; ingressNatRules = @($ref); egressNatRules = @($ref) }))
$vngLearnedRoutes = @{}
$vngBgpPeerStatus = @{}
if ($IncludeEffectiveRoutes) {
    foreach ($vng in $vnetGateways) {
        if ($null -eq $vng) { continue }
        $vngName = [string]$vng.name
        $learned = Invoke-AzJson "vngLearnedRoutes:$vngName" @('network', 'vnet-gateway', 'list-learned-routes', '-g', $ResourceGroupName, '-n', $vngName) @{ value = @($bgpRoute) }
        if ($learned) {
            $vngLearnedRoutes[$vngName] = @($learned.value)
        }
        $peerStatus = Invoke-AzJson "vngBgpPeerStatus:$vngName" @('network', 'vnet-gateway', 'list-bgp-peer-status', '-g', $ResourceGroupName, '-n', $vngName) @{ value = @(@{ neighbor = $true; state = $true; localAddress = $true; asn = $true; routesReceived = $true; connectedDuration = $true; messagesSent = $true; messagesReceived = $true }) }
        if ($peerStatus) {
            $vngBgpPeerStatus[$vngName] = @($peerStatus.value)
        }
    }
}
$rawRouteServers = @(Invoke-AzJson 'routeServers' @('network', 'routeserver', 'list', '-g', $ResourceGroupName) @(@{ id = $true; name = $true; location = $true; allowBranchToBranchTraffic = $true; hubRoutingPreference = $true; virtualRouterAsn = $true; virtualRouterIps = $true; ipConfigurations = @($ipConfiguration) }))
$routeServers = @()
$arsLearnedRoutes = @{}
$arsAdvertisedRoutes = @{}

foreach ($rs in $rawRouteServers) {
    if ($null -eq $rs) { continue }
    $rsName = [string]$rs.name
    $peerings = @(Invoke-AzJson "routeServerPeerings:$rsName" @('network', 'routeserver', 'peering', 'list', '-g', $ResourceGroupName, '--routeserver', $rsName) @(@{ id = $true; name = $true; peerIp = $true; peerAsn = $true }))
    $subnetId = ''
    if ($rs.ipConfigurations -and $rs.ipConfigurations.Count -gt 0) {
        $subnetId = [string]$rs.ipConfigurations[0].subnet.id
    }
    if ([string]::IsNullOrWhiteSpace($subnetId)) {
        foreach ($v in $vnets) {
            if ($null -eq $v -or -not $v.subnets) { continue }
            foreach ($s in $v.subnets) {
                if ($s.name -eq 'RouteServerSubnet' -and $s.ipConfigurations) {
                    foreach ($ipc in $s.ipConfigurations) {
                        if ([string]$ipc.id -match "/virtualHubs/$([Regex]::Escape($rsName))/") {
                            $subnetId = [string]$s.id
                            break
                        }
                    }
                }
                if (-not [string]::IsNullOrWhiteSpace($subnetId)) { break }
            }
            if (-not [string]::IsNullOrWhiteSpace($subnetId)) { break }
        }
    }
    $routeServers += [pscustomobject]@{
        id                         = [string]$rs.id
        name                       = $rsName
        location                   = [string]$rs.location
        allowBranchToBranchTraffic = [bool]$rs.allowBranchToBranchTraffic
        hubRoutingPreference       = [string]$rs.hubRoutingPreference
        virtualRouterAsn           = $rs.virtualRouterAsn
        virtualRouterIps           = $rs.virtualRouterIps
        subnetId                   = $subnetId
        peerings                   = $peerings
    }

    if ($IncludeEffectiveRoutes) {
        foreach ($peer in $peerings) {
            if ($null -eq $peer) { continue }
            $peerName = [string]$peer.name
            $key = "$rsName/$peerName"
            $learned = Invoke-AzJson "arsLearnedRoutes:$key" @('network', 'routeserver', 'peering', 'list-learned-routes', '-g', $ResourceGroupName, '--routeserver', $rsName, '-n', $peerName) @{ RouteServiceRole_IN_0 = @($bgpRoute); RouteServiceRole_IN_1 = @($bgpRoute) }
            if ($learned) {
                $arsLearnedRoutes[$key] = @((@($learned.RouteServiceRole_IN_0) + @($learned.RouteServiceRole_IN_1)) | Where-Object { $null -ne $_ })
            }
            $advertised = Invoke-AzJson "arsAdvertisedRoutes:$key" @('network', 'routeserver', 'peering', 'list-advertised-routes', '-g', $ResourceGroupName, '--routeserver', $rsName, '-n', $peerName) @{ RouteServiceRole_IN_0 = @($bgpRoute); RouteServiceRole_IN_1 = @($bgpRoute) }
            if ($advertised) {
                $arsAdvertisedRoutes[$key] = @((@($advertised.RouteServiceRole_IN_0) + @($advertised.RouteServiceRole_IN_1)) | Where-Object { $null -ne $_ })
            }
        }
    }
}

Write-Host "[3/6] Reading Private Endpoints and Network Interfaces..."
$rawPes = @(Invoke-AzJson 'privateEndpoints' @('network', 'private-endpoint', 'list', '-g', $ResourceGroupName) @(@{ id = $true; name = $true; subnet = $ref; customDnsConfigs = @(@{ ipAddresses = $true }); networkInterfaces = @($ref) }))
$rawNics = @(Invoke-AzJson 'networkInterfaces' @('network', 'nic', 'list', '-g', $ResourceGroupName) @(@{ id = $true; name = $true; enableIPForwarding = $true; virtualMachine = $ref; networkSecurityGroup = $ref; ipConfigurations = @($ipConfiguration) }))
$virtualMachines = @(Invoke-AzJson 'virtualMachines' @('vm', 'list', '-g', $ResourceGroupName) @(@{ id = $true; name = $true; networkProfile = @{ networkInterfaces = @($ref) } }))
$nsgRule = @{ id = $true; name = $true; priority = $true; direction = $true; access = $true; protocol = $true; sourceAddressPrefix = $true; sourceAddressPrefixes = $true; destinationAddressPrefix = $true; destinationAddressPrefixes = $true; sourcePortRange = $true; sourcePortRanges = $true; destinationPortRange = $true; destinationPortRanges = $true; sourceApplicationSecurityGroups = @($ref); destinationApplicationSecurityGroups = @($ref) }
$networkSecurityGroups = @(Invoke-AzJson 'networkSecurityGroups' @('network', 'nsg', 'list', '-g', $ResourceGroupName) @(@{ id = $true; name = $true; location = $true; securityRules = @($nsgRule) }))
$lbFrontend = @{ id = $true; name = $true; publicIPAddress = $ref; privateIPAddress = $true; subnet = $ref }
$lbPool = @{ id = $true; name = $true; backendIPConfigurations = @($ref); loadBalancerBackendAddresses = @(@{ name = $true; ipAddress = $true; virtualNetwork = $ref }); tunnelInterfaces = @(@{ identifier = $true }) }
$lbProbe = @{ id = $true; name = $true; protocol = $true; port = $true; requestPath = $true; noHealthyBackendsBehavior = $true }
$lbRule = @{ id = $true; name = $true; frontendIPConfiguration = $ref; backendAddressPool = $ref; backendAddressPools = @($ref); probe = $ref; protocol = $true; frontendPort = $true; backendPort = $true; loadDistribution = $true; disableOutboundSnat = $true; enableFloatingIP = $true; enableConnectionTracking = $true }
$lbNat = @{ id = $true; name = $true; frontendIPConfiguration = $ref; backendIPConfiguration = $ref; backendAddressPool = $ref; protocol = $true; frontendPort = $true; backendPort = $true; frontendPortRangeStart = $true; frontendPortRangeEnd = $true; enableFloatingIP = $true }
$lbOutbound = @{ id = $true; name = $true; frontendIPConfigurations = @($ref); backendAddressPool = $ref; protocol = $true }
$loadBalancers = @(Invoke-AzJson 'loadBalancers' @('network', 'lb', 'list', '-g', $ResourceGroupName) @(@{ id = $true; name = $true; sku = @{ name = $true; tier = $true }; frontendIPConfigurations = @($lbFrontend); backendAddressPools = @($lbPool); probes = @($lbProbe); loadBalancingRules = @($lbRule); inboundNatRules = @($lbNat); inboundNatPools = @($ref); outboundRules = @($lbOutbound) }))
$firewallNatRule = @{ name = $true; ruleType = $true; protocols = $true; ipProtocols = $true; sourceAddresses = $true; sourceIpGroups = $true; destinationAddresses = $true; destinationPorts = $true; translatedAddress = $true; translatedPort = $true; translatedFqdn = $true }
$firewallCollection = @{ id = $true; name = $true; priority = $true; ruleCollectionType = $true; action = @{ type = $true }; rules = @($firewallNatRule) }
$azureFirewalls = @(Invoke-AzJson 'azureFirewalls' @('network', 'firewall', 'list', '-g', $ResourceGroupName) @(@{ id = $true; name = $true; sku = @{ tier = $true; name = $true }; ipConfigurations = @($ipConfiguration); managementIpConfiguration = $ipConfiguration; firewallPolicy = $ref; natRuleCollections = @($firewallCollection) }))
$firewallPolicies = @(Invoke-AzJson 'firewallPolicies' @('network', 'firewall', 'policy', 'list', '-g', $ResourceGroupName) @(@{ id = $true; name = $true; basePolicy = $ref }))
$firewallPolicyRuleCollectionGroups = @()
foreach ($policy in $firewallPolicies) {
    if ($null -eq $policy) { continue }
    $policyName = [string]$policy.name
    $groups = @(Invoke-AzJson "firewallPolicyRuleCollectionGroups:$policyName" @('network', 'firewall', 'policy', 'rule-collection-group', 'list', '-g', $ResourceGroupName, '--policy-name', $policyName) @(@{ id = $true; name = $true; priority = $true; ruleCollections = @($firewallCollection) }))
    $firewallPolicyRuleCollectionGroups += @{ policyId = [string]$policy.id; groups = @($groups | Where-Object { $null -ne $_ }) }
}

$privateEndpoints = @()
foreach ($pe in $rawPes) {
    if ($null -eq $pe) { continue }
    $peIp = ''
    if ($pe.customDnsConfigs -and $pe.customDnsConfigs.Count -gt 0 -and $pe.customDnsConfigs[0].ipAddresses.Count -gt 0) {
        $peIp = [string]$pe.customDnsConfigs[0].ipAddresses[0]
    } elseif ($pe.networkInterfaces -and $pe.networkInterfaces.Count -gt 0) {
        $peNicId = [string]$pe.networkInterfaces[0].id
        $matchedNic = $rawNics | Where-Object { $_.id -eq $peNicId } | Select-Object -First 1
        if ($matchedNic -and $matchedNic.ipConfigurations.Count -gt 0) {
            $peIp = [string]$matchedNic.ipConfigurations[0].privateIPAddress
        }
    }
    $privateEndpoints += [pscustomobject]@{
        id          = [string]$pe.id
        name        = [string]$pe.name
        subnetId    = [string]$pe.subnet.id
        privateIp   = $peIp
        serviceName = 'privatelink.azure.net'
    }
}

$nicEffectiveRoutes = @()
if ($IncludeEffectiveRoutes) {
    Write-Host "[4/6] Querying NIC Effective Route Tables..."
    foreach ($nic in $rawNics) {
        if ($null -eq $nic) { continue }
        $nicName = [string]$nic.name
        if ($nicName -like '*pe-*' -or $null -eq $nic.virtualMachine) {
            continue
        }
        $subId = [string]$nic.ipConfigurations[0].subnet.id
        $vnetName = ''
        $subnetName = ''
        if ($subId -match '/virtualNetworks/([^/]+)/subnets/([^/]+)$') {
            $vnetName = $Matches[1]
            $subnetName = $Matches[2]
        }
        Write-Host "  -> NIC '$nicName' ($vnetName / $subnetName)..."
        $eff = Invoke-AzJson "nicEffectiveRoutes:$nicName" @('network', 'nic', 'show-effective-route-table', '-g', $ResourceGroupName, '-n', $nicName) @{ value = @(@{ addressPrefix = $true; source = $true; state = $true; nextHopType = $true; nextHopIpAddress = $true; name = $true }) }
        if ($eff -and $null -eq $eff.value) { $sections["nicEffectiveRoutes:$nicName"] = @{ state = 'failed'; complete = $false } }
        if ($eff -and $null -ne $eff.value) {
            $nicEffectiveRoutes += [pscustomobject]@{
                nicName            = $nicName
                nicId              = [string]$nic.id
                vnetName           = $vnetName
                subnetName         = $subnetName
                privateIp          = [string]$nic.ipConfigurations[0].privateIPAddress
                enableIPForwarding = [bool]$nic.enableIPForwarding
                effectiveRoutes    = @($eff.value)
                observation        = @{ state = $(if ($eff.value.Count) { 'succeeded' } else { 'empty' }); complete = $true }
            }
        } else {
            $nicEffectiveRoutes += [pscustomobject]@{
                nicName = $nicName; nicId = [string]$nic.id; vnetName = $vnetName; subnetName = $subnetName
                effectiveRoutes = @(); observation = $sections["nicEffectiveRoutes:$nicName"]
            }
            $warnings.Add("Effective route query returned no routes for NIC '$nicName'.")
        }
    }
}

Write-Host "[5/6] Assembling v2 capture envelope..."
$configurationComplete = !(@($sections.GetEnumerator() | Where-Object {
    $_.Key -notmatch '^(nicEffectiveRoutes|arsLearnedRoutes|arsAdvertisedRoutes|vngLearnedRoutes|vngBgpPeerStatus):' -and !$_.Value.complete
}).Count)
foreach ($section in @('nicEffectiveRoutes', 'arsLearnedRoutes', 'arsAdvertisedRoutes', 'vngLearnedRoutes', 'vngBgpPeerStatus')) {
    $children = @($sections.GetEnumerator() | Where-Object { $_.Key.StartsWith("${section}:") })
    $complete = $IncludeEffectiveRoutes -and $configurationComplete -and !(@($children | Where-Object { !$_.Value.complete }).Count)
    $state = if (!$IncludeEffectiveRoutes) { 'not-requested' } elseif (!$complete) { 'failed' } elseif (!$children.Count) { 'empty' } else { 'succeeded' }
    $sections[$section] = @{ state = $state; complete = [bool]$complete }
}
$capture = [ordered]@{
    kind               = 'azure-network-capture'
    version            = 2
    collectorVersion   = '2026.11.16.10'
    connectivityVersion = 1
    observationVersion = 1
    context            = $context
    configurationComplete = $configurationComplete
    complete           = !(@($sections.Values | Where-Object { !$_.complete }).Count) -and $context.cloud -eq 'AzureCloud'
    sections           = $sections
    includeEffectiveRoutes = [bool]$IncludeEffectiveRoutes
    capturedAt         = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    subscriptionId     = $resolvedSubId
    resourceGroup      = $ResourceGroupName
    warnings           = @($warnings)
    routeTables          = @($routeTables | Where-Object { $null -ne $_ })
    vnets                = @($vnets | Where-Object { $null -ne $_ })
    publicIpAddresses    = @($publicIpAddresses | Where-Object { $null -ne $_ })
    publicIpPrefixes     = @($publicIpPrefixes | Where-Object { $null -ne $_ })
    natGateways          = @($natGateways | Where-Object { $null -ne $_ })
    vnetGateways         = @($vnetGateways | Where-Object { $null -ne $_ })
    localNetworkGateways = @($localNetworkGateways | Where-Object { $null -ne $_ })
    vpnConnections       = @($vpnConnections | Where-Object { $null -ne $_ })
    routeServers         = $routeServers
    privateEndpoints     = $privateEndpoints
    networkInterfaces    = @($rawNics | Where-Object { $null -ne $_ })
    virtualMachines      = @($virtualMachines | Where-Object { $null -ne $_ })
    networkSecurityGroups = @($networkSecurityGroups | Where-Object { $null -ne $_ })
    loadBalancers        = @($loadBalancers | Where-Object { $null -ne $_ })
    azureFirewalls       = @($azureFirewalls | Where-Object { $null -ne $_ })
    firewallPolicies     = @($firewallPolicies | Where-Object { $null -ne $_ })
    firewallPolicyRuleCollectionGroups = $firewallPolicyRuleCollectionGroups
    nicEffectiveRoutes   = $nicEffectiveRoutes
    arsLearnedRoutes     = $arsLearnedRoutes
    arsAdvertisedRoutes  = $arsAdvertisedRoutes
    vngLearnedRoutes     = $vngLearnedRoutes
    vngBgpPeerStatus     = $vngBgpPeerStatus
}

Write-Host "[6/6] Writing capture to '$OutputFile'..."
$json = $capture | ConvertTo-Json -Depth 50 -Compress
if ([Text.Encoding]::UTF8.GetByteCount($json) -gt 8000000) { throw 'Capture exceeds the 8 MB limit; no file was written. Narrow the resource group or omit effective routes.' }
$parentDir = Split-Path -Parent $OutputFile
$resolvedDir = if ([string]::IsNullOrWhiteSpace($parentDir)) { $PWD.Path } else { (Resolve-Path -LiteralPath $parentDir).Path }
$outPath = Join-Path $resolvedDir (Split-Path -Leaf $OutputFile)
[IO.File]::WriteAllText($outPath, $json, [Text.UTF8Encoding]::new($false))
Write-Host "Done! Wrote $($capture.vnets.Count) VNets, $($capture.routeTables.Count) Route Tables, and $($nicEffectiveRoutes.Count) NIC observations."
