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
.EXAMPLE
./collect-azure-network.ps1 -ResourceGroupName 'rg-aznet-sim-lab-20261103' -IncludeEffectiveRoutes -OutputFile ./azure-net-capture.json -Force
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ResourceGroupName,
    [string]$SubscriptionId = '',
    [string]$OutputFile = './azure-net-capture.json',
    [switch]$IncludeEffectiveRoutes,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
if ((Test-Path -LiteralPath $OutputFile) -and !$Force) {
    throw "Output file '$OutputFile' already exists. Pass -Force to overwrite."
}

$warnings = [System.Collections.Generic.List[string]]::new()
$subArgs = @()
if ($SubscriptionId) {
    $subArgs = @('--subscription', $SubscriptionId)
}

function Invoke-AzJson([string[]]$CliArgs) {
    $fullArgs = $CliArgs + $subArgs + @('-o', 'json')
    $raw = & az @fullArgs 2>$null
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($raw)) {
        return $null
    }
    return ($raw | ConvertFrom-Json -Depth 50)
}

$account = Invoke-AzJson @('account', 'show')
$resolvedSubId = if ($SubscriptionId) { $SubscriptionId } elseif ($account) { [string]$account.id } else { '' }

Write-Host "[1/6] Reading Route Tables and Virtual Networks in '$ResourceGroupName'..."
$routeTables = @(Invoke-AzJson @('network', 'route-table', 'list', '-g', $ResourceGroupName))
$vnets = @(Invoke-AzJson @('network', 'vnet', 'list', '-g', $ResourceGroupName))

Write-Host "[2/6] Reading Virtual Network Gateways, Local Gateways, Connections, and Route Servers..."
$vnetGateways = @(Invoke-AzJson @('network', 'vnet-gateway', 'list', '-g', $ResourceGroupName))
$localNetworkGateways = @(Invoke-AzJson @('network', 'local-gateway', 'list', '-g', $ResourceGroupName))
$vpnConnections = @(Invoke-AzJson @('network', 'vpn-connection', 'list', '-g', $ResourceGroupName))
$vngLearnedRoutes = @{}
$vngBgpPeerStatus = @{}
if ($IncludeEffectiveRoutes) {
    foreach ($vng in $vnetGateways) {
        if ($null -eq $vng) { continue }
        $vngName = [string]$vng.name
        $learned = Invoke-AzJson @('network', 'vnet-gateway', 'list-learned-routes', '-g', $ResourceGroupName, '-n', $vngName)
        if ($learned -and $learned.value) {
            $vngLearnedRoutes[$vngName] = @($learned.value)
        }
        $peerStatus = Invoke-AzJson @('network', 'vnet-gateway', 'list-bgp-peer-status', '-g', $ResourceGroupName, '-n', $vngName)
        if ($peerStatus -and $peerStatus.value) {
            $vngBgpPeerStatus[$vngName] = @($peerStatus.value)
        }
    }
}
$rawRouteServers = @(Invoke-AzJson @('network', 'routeserver', 'list', '-g', $ResourceGroupName))
$routeServers = @()
$arsLearnedRoutes = @{}
$arsAdvertisedRoutes = @{}

foreach ($rs in $rawRouteServers) {
    if ($null -eq $rs) { continue }
    $rsName = [string]$rs.name
    $peerings = @(Invoke-AzJson @('network', 'routeserver', 'peering', 'list', '-g', $ResourceGroupName, '--routeserver', $rsName))
    $subnetId = ''
    if ($rs.ipConfigurations -and $rs.ipConfigurations.Count -gt 0) {
        $subnetId = [string]$rs.ipConfigurations[0].subnet.id
    }
    if ([string]::IsNullOrWhiteSpace($subnetId)) {
        foreach ($v in $rawVnets) {
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
            $learned = Invoke-AzJson @('network', 'routeserver', 'peering', 'list-learned-routes', '-g', $ResourceGroupName, '--routeserver', $rsName, '-n', $peerName)
            if ($learned -and $learned.RouteServiceRole_IN_0) {
                $arsLearnedRoutes[$peerName] = @($learned.RouteServiceRole_IN_0)
            }
            $advertised = Invoke-AzJson @('network', 'routeserver', 'peering', 'list-advertised-routes', '-g', $ResourceGroupName, '--routeserver', $rsName, '-n', $peerName)
            if ($advertised -and $advertised.RouteServiceRole_IN_0) {
                $arsAdvertisedRoutes[$peerName] = @($advertised.RouteServiceRole_IN_0)
            }
        }
    }
}

Write-Host "[3/6] Reading Private Endpoints and Network Interfaces..."
$rawPes = @(Invoke-AzJson @('network', 'private-endpoint', 'list', '-g', $ResourceGroupName))
$rawNics = @(Invoke-AzJson @('network', 'nic', 'list', '-g', $ResourceGroupName))

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
        $eff = Invoke-AzJson @('network', 'nic', 'show-effective-route-table', '-g', $ResourceGroupName, '-n', $nicName)
        if ($eff -and $eff.value) {
            $nicEffectiveRoutes += [pscustomobject]@{
                nicName            = $nicName
                nicId              = [string]$nic.id
                vnetName           = $vnetName
                subnetName         = $subnetName
                privateIp          = [string]$nic.ipConfigurations[0].privateIPAddress
                enableIPForwarding = [bool]$nic.enableIPForwarding
                effectiveRoutes    = @($eff.value)
            }
        } else {
            $warnings.Add("Effective route query returned no routes for NIC '$nicName'.")
        }
    }
}

Write-Host "[5/6] Assembling v2 capture envelope..."
$capture = [ordered]@{
    kind               = 'azure-network-capture'
    version            = 2
    collectorVersion   = '2026.11.03.1'
    capturedAt         = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    subscriptionId     = $resolvedSubId
    resourceGroup      = $ResourceGroupName
    warnings           = @($warnings)
    routeTables          = @($routeTables | Where-Object { $null -ne $_ })
    vnets                = @($vnets | Where-Object { $null -ne $_ })
    vnetGateways         = @($vnetGateways | Where-Object { $null -ne $_ })
    localNetworkGateways = @($localNetworkGateways | Where-Object { $null -ne $_ })
    vpnConnections       = @($vpnConnections | Where-Object { $null -ne $_ })
    routeServers         = $routeServers
    privateEndpoints     = $privateEndpoints
    networkInterfaces    = @($rawNics | Where-Object { $null -ne $_ })
    nicEffectiveRoutes   = $nicEffectiveRoutes
    arsLearnedRoutes     = $arsLearnedRoutes
    arsAdvertisedRoutes  = $arsAdvertisedRoutes
    vngLearnedRoutes     = $vngLearnedRoutes
    vngBgpPeerStatus     = $vngBgpPeerStatus
}

Write-Host "[6/6] Writing capture to '$OutputFile'..."
$json = $capture | ConvertTo-Json -Depth 50
$parentDir = Split-Path -Parent $OutputFile
$resolvedDir = if ([string]::IsNullOrWhiteSpace($parentDir)) { $PWD.Path } else { (Resolve-Path -LiteralPath $parentDir).Path }
$outPath = Join-Path $resolvedDir (Split-Path -Leaf $OutputFile)
[IO.File]::WriteAllText($outPath, $json, [Text.UTF8Encoding]::new($false))
Write-Host "Done! Wrote $($vnets.Count) VNets, $($routeTables.Count) Route Tables, and $($nicEffectiveRoutes.Count) NIC effective-route tables."
