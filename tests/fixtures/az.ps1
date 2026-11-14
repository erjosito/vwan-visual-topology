$ErrorActionPreference = 'Stop'
if ($args[0] -ne 'rest' -or $args[1] -ne '--method' -or $args[2] -ne 'get') { throw 'Mock permits only az rest GET.' }
$uri = $args[[Array]::IndexOf($args, '--url') + 1]
Add-Content -LiteralPath $env:MOCK_AZ_LOG -Value $uri
$base = '/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/network/providers/Microsoft.Network'
$wan = "$base/virtualWans/wan"
$hub = "$base/virtualHubs/west"
$vnet = "$base/virtualNetworks/app"
$cross = $vnet.Replace('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222')
$path = ([uri]$uri).AbsolutePath
$response = switch -Wildcard ($path) {
    '*/virtualWans/wan' {
        @{ id = $wan; name = 'Captured WAN'; location = 'westeurope'; sharedKey = 'must-not-be-exported'
            properties = @{ type = $(if ($env:MOCK_AZ_MODE -eq 'basic') { 'Basic' } else { 'Standard' }); allowBranchToBranchTraffic = $true; allowVnetToVnetTraffic = $true } }
    }
    '/subscriptions/*/providers/Microsoft.Network/virtualHubs' {
        if ($uri -like '*skipToken=*') {
            @{ value = @(@{ id = "$base/virtualHubs/unrelated"; name = 'Ignore me'; properties = @{ virtualWan = @{ id = "$base/virtualWans/other" } } }) }
        } else {
            @{ value = @(@{ id = $hub; name = 'West hub'; location = 'westeurope'; properties = @{
                virtualWan = @{ id = $wan.ToUpperInvariant() }; addressPrefix = '10.250.0.0/23'
                hubRoutingPreference = 'VpnGateway'; provisioningState = 'Succeeded'
                vpnGateway = $(if ($env:MOCK_AZ_MODE -ne 'vnet-only') { @{ id = "$base/vpnGateways/vpn" } } else { $null })
            } }); nextLink = $(if ($env:MOCK_AZ_MODE -eq 'bad-next') { 'https://example.invalid/anything' } else { "$uri&skipToken=A%2FB%3D%3D" }) }
        }
    }
    '*/hubRouteTables' { @{ value = @(@{ name = 'defaultRouteTable'; properties = @{ routes = @(); labels = @('default') } }, @{ name = 'noneRouteTable'; properties = @{ routes = @(); labels = @('none') } }) } }
    '*/bgpConnections' { @{ value = @() } }
    '*/routeMaps' {
        if ($env:MOCK_AZ_MODE -eq 'partial') { Write-Error 'Mock permission denied'; exit 1 }
        @{ value = @() }
    }
    '*/routingIntent' { @{ value = @() } }
    '*/hubVirtualNetworkConnections' {
        $connections = @(@{ name = 'connection-to-app'; properties = @{
            remoteVirtualNetwork = @{ id = $vnet }; enableInternetSecurity = $false; routingConfiguration = @{
                associatedRouteTable = @{ id = "$hub/hubRouteTables/defaultRouteTable" }
                propagatedRouteTables = @{ ids = @(@{ id = "$hub/hubRouteTables/defaultRouteTable" }); labels = @('default') }
            }
        } })
        if ($env:MOCK_AZ_MODE -in @('normal', 'static-routes')) {
            $connections[0].properties.routingConfiguration.vnetRoutes = @{
                staticRoutes = @(
                    if ($env:MOCK_AZ_MODE -eq 'static-routes') {
                        @{ name = 'nva'; addressPrefixes = @('10.60.0.0/16'); nextHopIpAddress = '10.20.1.4' }
                    }
                )
                staticRoutesConfig = @{ propagateStaticRoutes = $true; vnetLocalRouteOverrideCriteria = 'Contains' }
            }
        }
        if ($env:MOCK_AZ_MODE -eq 'partial') {
            $connections += @{ name = 'cross-subscription'; properties = @{ remoteVirtualNetwork = @{ id = $cross } } }
        }
        @{ value = $connections }
    }
    '*/virtualNetworks/app' { @{ id = $path; properties = @{ addressSpace = @{ addressPrefixes = @('10.20.0.0/16') } }; diagnosticSecret = 'must-not-be-exported' } }
    default { throw "Unexpected mock GET: $path" }
}
$response | ConvertTo-Json -Depth 20 -Compress
