#requires -Version 7.0
$ErrorActionPreference = 'Stop'
$subscription = '11111111-1111-1111-1111-111111111111'
$prefix = "/subscriptions/$subscription/resourceGroups/network/providers/Microsoft.Network"
$command = $args[0..([Math]::Min(2, $args.Count - 1))] -join ' '
Add-Content -LiteralPath $env:MOCK_NETWORK_LOG -Value (ConvertTo-Json -InputObject @($args) -Compress)
if ($args -notcontains '--query' -or $args -notcontains '--only-show-errors') { throw 'Missing projected, quiet CLI invocation.' }
if (($command.StartsWith('network ') -or $args[0] -eq 'vm') -and $args[[Array]::IndexOf($args, '--subscription') + 1] -ne $subscription) { throw 'Subscription not pinned.' }
if ($env:MOCK_NETWORK_MODE -like 'connectivity*') {
    $vnet = "$prefix/virtualNetworks/vnet-first"
    $nic = "$prefix/networkInterfaces/server"; $configuration = "$nic/ipConfigurations/primary"
    $vm = "/subscriptions/$subscription/resourceGroups/network/providers/Microsoft.Compute/virtualMachines/server"
    $nsg = "$prefix/networkSecurityGroups/backend"
    $lb = "$prefix/loadBalancers/service"; $frontend = "$lb/frontendIPConfigurations/public"
    $pool = "$lb/backendAddressPools/servers"; $probe = "$lb/probes/health"
    $firewall = "$prefix/azureFirewalls/service"; $policy = "$prefix/firewallPolicies/policy"
    if (($command -eq 'network nsg list' -and $env:MOCK_NETWORK_MODE -eq 'connectivity-denied') -or
        ($args -contains 'rule-collection-group' -and $env:MOCK_NETWORK_MODE -eq 'connectivity-group-denied')) {
        [Console]::Error.WriteLine('AuthorizationFailed 403 must-not-be-exported'); exit 1
    }
    $result = switch ($command) {
        'network nic list' {
            @(@{ id = $nic; name = 'server'; virtualMachine = @{ id = $vm }; networkSecurityGroup = @{ id = $nsg }
                ipConfigurations = @(@{ id = $configuration; name = 'primary'; privateIpAddress = '10.82.1.4'; primary = $true
                    subnet = @{ id = "$vnet/subnets/app" }; loadBalancerBackendAddressPools = @(@{ id = $pool }) })
                secret = 'must-not-be-exported' })
        }
        'vm list -g' {
            @(@{ id = $vm; name = 'server'; networkProfile = @{ networkInterfaces = @(@{ id = $nic }) }
                osProfile = @{ adminUsername = 'must-not-be-exported'; customData = 'must-not-be-exported' }
                storageProfile = @{ imageReference = @{ offer = 'must-not-be-exported' } } })
        }
        'network nsg list' {
            @(@{ id = $nsg; name = 'backend'; location = 'swedencentral'
                securityRules = @(@{ id = "$nsg/securityRules/AllowClient"; name = 'AllowClient'; priority = 100
                    direction = 'Inbound'; access = 'Allow'; protocol = 'Tcp'; sourceAddressPrefix = '8.8.8.8/32'
                    destinationAddressPrefix = '10.82.1.4'; sourcePortRange = '*'; destinationPortRange = '8443'
                    secret = 'must-not-be-exported' }) })
        }
        'network lb list' {
            @(@{ id = $lb; name = $(if ($env:MOCK_NETWORK_MODE -eq 'connectivity-truncated') { 'x' * 5000 } else { 'service' })
                sku = @{ name = 'Standard'; tier = 'Regional' }
                frontendIpConfigurations = @(@{ id = $frontend; name = 'public'; publicIpAddress = @{ id = "$prefix/publicIPAddresses/lb-ip" } })
                backendAddressPools = @(@{ id = $pool; name = 'servers'; backendIpConfigurations = @(@{ id = $configuration }) })
                probes = @(@{ id = $probe; name = 'health'; protocol = 'Tcp'; port = 8080; runtimeHealth = 'must-not-be-exported' })
                loadBalancingRules = @(@{ id = "$lb/loadBalancingRules/web"; name = 'web'; frontendIpConfiguration = @{ id = $frontend }
                    backendAddressPool = @{ id = $pool }; probe = @{ id = $probe }; protocol = 'Tcp'; frontendPort = 443
                    backendPort = 8443; disableOutboundSnat = $true; enableFloatingIp = $false })
                secret = 'must-not-be-exported' })
        }
        'network firewall list' {
            @(@{ id = $firewall; name = 'service'; sku = @{ name = 'AZFW_VNet'; tier = 'Standard' }; firewallPolicy = @{ id = $policy }
                ipConfigurations = @(@{ id = "$firewall/azureFirewallIpConfigurations/public"; name = 'public'
                    privateIpAddress = '10.82.2.4'; subnet = @{ id = "$vnet/subnets/AzureFirewallSubnet" }
                    publicIpAddress = @{ id = "$prefix/publicIPAddresses/fw-ip" } })
                secret = 'must-not-be-exported' })
        }
        'network firewall policy' {
            if ($args -contains 'rule-collection-group') {
                @(@{ id = "$policy/ruleCollectionGroups/inbound"; name = 'inbound'; priority = 200
                    ruleCollections = @(@{ name = 'dnat'; priority = 200; ruleCollectionType = 'FirewallPolicyNatRuleCollection'
                        action = @{ type = 'DNAT' }; rules = @(@{ name = 'web'; ruleType = 'NatRule'; ipProtocols = @('TCP')
                            sourceAddresses = @('8.8.8.8'); destinationAddresses = @('20.40.50.62'); destinationPorts = @('443')
                            translatedAddress = '10.82.1.4'; translatedPort = '8443'; secret = 'must-not-be-exported' }) }) })
            } else { @(@{ id = $policy; name = 'policy'; secret = 'must-not-be-exported' }) }
        }
    }
    if ($null -ne $result) { ConvertTo-Json -InputObject @($result) -Depth 20 -Compress; exit 0 }
}
if ($command -eq 'network vnet list' -and $env:MOCK_NETWORK_MODE -eq 'overall-budget') {
    Start-Sleep -Seconds 30
}
if ($command -eq 'network route-table list' -and $env:MOCK_NETWORK_MODE -eq 'denied') {
    [Console]::Error.WriteLine('AuthorizationFailed 403 Bearer must-not-be-exported'); exit 1
}
if ($command -eq 'network vnet-gateway list' -and $env:MOCK_NETWORK_MODE -eq 'failed') {
    [Console]::Error.WriteLine('Internal error sharedKey=must-not-be-exported'); exit 1
}
if ($command -eq 'network nat gateway' -and $env:MOCK_NETWORK_MODE -eq 'nat-denied') {
    [Console]::Error.WriteLine('AuthorizationFailed 403 must-not-be-exported'); exit 1
}
if ($command -eq 'network nic show-effective-route-table') {
    switch ($env:MOCK_NETWORK_MODE) {
        'timeout' {
            [IO.File]::WriteAllText($env:MOCK_NETWORK_TIMEOUT_START, [string][Diagnostics.Stopwatch]::GetTimestamp())
            Start-Sleep -Seconds 30
        }
        'oversize' { [Console]::Write('must-not-be-exported' * 100000); exit 0 }
        'stderr-limit' { [Console]::Error.Write('must-not-be-exported' * 5000); exit 1 }
        'unsupported' { [Console]::Error.WriteLine('NotSupported must-not-be-exported'); exit 1 }
        'bad-json' { 'not JSON must-not-be-exported'; exit 0 }
        'bad-envelope' { '{"other":[]}'; exit 0 }
        'long-field' { @{ value = @(@{ addressPrefix = @('10.82.0.0/16'); name = 'x' * 5000 }) } | ConvertTo-Json -Depth 10 -Compress; exit 0 }
        'empty' { '{"value":[]}'; exit 0 }
    }
    @{
        value = @(@{ addressPrefix = @('10.82.0.0/16'); source = 'Default'; state = 'Active'; nextHopType = 'VnetLocal'; secret = 'must-not-be-exported' })
        secret = 'must-not-be-exported'
    } | ConvertTo-Json -Depth 10 -Compress
} elseif ($args[0] -eq 'account') {
    @{ id = $subscription; tenantId = '33333333-3333-3333-3333-333333333333'; environmentName = 'AzureCloud'; user = @{ name = 'must-not-be-exported' } } | ConvertTo-Json -Compress
} elseif ($command -eq 'network vnet list') {
    $result = @('second', 'first') | ForEach-Object {
        $id = "$prefix/virtualNetworks/vnet-$_"
        $subnetPeering = $env:MOCK_NETWORK_MODE -eq 'subnet-peering'
        $octet = if ($subnetPeering -and $_ -eq 'second') { 83 } else { 82 }
        @{
            id = $id; name = "vnet-$_"; location = 'swedencentral'; secret = 'must-not-be-exported'
            addressSpace = @{ addressPrefixes = @("10.$octet.0.0/16") }
            virtualNetworkPeerings = @(if ($subnetPeering) {
                $remote = if ($_ -eq 'first') { 'second' } else { 'first' }
                @{ name = "to-$remote"; remoteVirtualNetwork = @{ id = "$prefix/virtualNetworks/vnet-$remote" }
                    peerCompleteVnets = $false; localSubnetNames = @('RouteServerSubnet'); remoteSubnetNames = @('RouteServerSubnet')
                    enableOnlyIPv6Peering = $false; allowVirtualNetworkAccess = $true; secret = 'must-not-be-exported' }
            })
            subnets = @(@{
                id = "$id/subnets/RouteServerSubnet"; name = 'RouteServerSubnet'; secret = 'must-not-be-exported'
                addressPrefix = "10.$octet.254.0/26"
                ipConfigurations = @(@{ id = "$prefix/virtualHubs/ars-$_/ipConfigurations/default" })
                defaultOutboundAccess = $false
                natGateway = if ($_ -eq 'first') { @{ id = "$prefix/natGateways/nat" } } else { $null }
            }) + $(if ($env:MOCK_NETWORK_MODE -like 'vpn-nat-*' -and $_ -eq 'first') {
                @(@{ id = "$id/subnets/GatewaySubnet"; name = 'GatewaySubnet'; addressPrefix = '10.82.253.0/26' })
            } else { @() }) + $(if ($env:MOCK_NETWORK_MODE -like 'connectivity*' -and $_ -eq 'first') {
                @(@{ id = "$id/subnets/app"; name = 'app'; addressPrefix = '10.82.1.0/24'; defaultOutboundAccess = $false
                        networkSecurityGroup = @{ id = "$prefix/networkSecurityGroups/backend" } }
                    @{ id = "$id/subnets/AzureFirewallSubnet"; name = 'AzureFirewallSubnet'; addressPrefix = '10.82.2.0/24' })
            } else { @() })
        }
    }
    ConvertTo-Json -InputObject @($result) -Depth 10 -Compress
} elseif ($command -eq 'network vnet-gateway list' -and ($env:MOCK_NETWORK_MODE -like 'vpn-nat-*' -or $env:MOCK_NETWORK_MODE -eq 'bgp-neighbors')) {
    $gateway = @{ id = "$prefix/virtualNetworkGateways/vpn"; name = 'vpn'; gatewayType = 'Vpn'; enableBgp = $true
        bgpSettings = @{ asn = 65515; bgpPeeringAddress = '10.82.253.4' }
        ipConfigurations = @(@{ id = "$prefix/virtualNetworkGateways/vpn/ipConfigurations/default"
            subnet = @{ id = "$prefix/virtualNetworks/vnet-first/subnets/GatewaySubnet" } })
        natRules = @(); secret = 'must-not-be-exported' }
    if ($env:MOCK_NETWORK_MODE -eq 'vpn-nat-gateway') {
        $gateway.natRules = @(@{ id = "$prefix/virtualNetworkGateways/vpn/natRules/overlap"
            name = 'must-not-be-exported'; internalMappings = @(@{ addressSpace = 'must-not-be-exported' })
            externalMappings = @(@{ addressSpace = 'must-not-be-exported' }); secret = 'must-not-be-exported' })
    }
    ConvertTo-Json -InputObject @($gateway) -Depth 10 -Compress
} elseif ($command -eq 'network vpn-connection list' -and $env:MOCK_NETWORK_MODE -like 'vpn-nat-*') {
    $connection = @{ id = "$prefix/connections/site"; name = 'site'; enableBgp = $true
        virtualNetworkGateway1 = @{ id = "$prefix/virtualNetworkGateways/vpn" }
        localNetworkGateway2 = @{ id = "$prefix/localNetworkGateways/site" }
        ingressNatRules = @(); egressNatRules = @(); sharedKey = 'must-not-be-exported' }
    if ($env:MOCK_NETWORK_MODE -in @('vpn-nat-ingress', 'vpn-nat-egress')) {
        $key = if ($env:MOCK_NETWORK_MODE -eq 'vpn-nat-ingress') { 'ingressNatRules' } else { 'egressNatRules' }
        $connection[$key] = @(@{ id = "$prefix/virtualNetworkGateways/vpn/natRules/overlap"; secret = 'must-not-be-exported' })
    }
    ConvertTo-Json -InputObject @($connection) -Depth 10 -Compress
} elseif ($command -eq 'network local-gateway list' -and $env:MOCK_NETWORK_MODE -like 'vpn-nat-*') {
    ConvertTo-Json -InputObject @(@{ id = "$prefix/localNetworkGateways/site"; name = 'site'
        localNetworkAddressSpace = @{ addressPrefixes = @('10.90.0.0/16') }
        bgpSettings = @{ asn = 65001; bgpPeeringAddress = '10.90.0.4' } }) -Depth 10 -Compress
} elseif ($command -eq 'network vnet-gateway list-bgp-peer-status' -and $env:MOCK_NETWORK_MODE -eq 'bgp-neighbors') {
    '{"value":[{"localAddress":"10.82.253.4","neighbor":"192.0.2.9","asn":65001,"state":"Connected","routesReceived":0,"connectedDuration":"00:01:00","messagesSent":12,"messagesReceived":11,"secret":"must-not-be-exported"}]}'
} elseif ($command -in @('network vnet-gateway list-learned-routes', 'network vnet-gateway list-bgp-peer-status')) {
    '{"value":[]}'
} elseif ($command -eq 'network public-ip list') {
    if ($env:MOCK_NETWORK_MODE -eq 'nat-prefix') { '[]' } else {
        $ip = @{ id = "$prefix/publicIPAddresses/nat-ip"; name = 'nat-ip'; sku = @{ name = 'Standard' }; publicIPAllocationMethod = 'Static'; secret = 'must-not-be-exported' }
        if ($env:MOCK_NETWORK_MODE -ne 'nat-unallocated') { $ip.ipAddress = '20.40.50.60' }
        $additional = if ($env:MOCK_NETWORK_MODE -like 'connectivity*') {
            @(@{ id = "$prefix/publicIPAddresses/lb-ip"; name = 'lb-ip'; sku = @{ name = 'Standard' }; publicIpAllocationMethod = 'Static'
                    ipAddress = '20.40.50.61'; ipConfiguration = @{ id = "$prefix/loadBalancers/service/frontendIPConfigurations/public" } }
                @{ id = "$prefix/publicIPAddresses/fw-ip"; name = 'fw-ip'; sku = @{ name = 'Standard' }; publicIpAllocationMethod = 'Static'
                    ipAddress = '20.40.50.62'; ipConfiguration = @{ id = "$prefix/azureFirewalls/service/azureFirewallIpConfigurations/public" } })
        } else { @() }
        ConvertTo-Json -InputObject (@($ip) + @($additional)) -Depth 10 -Compress
    }
} elseif ($command -eq 'network public-ip prefix') {
    if ($env:MOCK_NETWORK_MODE -eq 'nat-prefix') {
        ConvertTo-Json -InputObject @(@{ id = "$prefix/publicIPPrefixes/nat-prefix"; name = 'nat-prefix'; sku = @{ name = 'Standard' }; prefixLength = 31; ipPrefix = '20.40.50.64/31'; secret = 'must-not-be-exported' }) -Depth 10 -Compress
    } else { '[]' }
} elseif ($command -eq 'network nat gateway') {
    $sku = if ($env:MOCK_NETWORK_MODE -eq 'nat-unsupported-sku') { 'StandardV2' } else { 'Standard' }
    $nat = @{ id = "$prefix/natGateways/nat"; name = 'nat'; sku = @{ name = $sku }; subnets = @(@{ id = "$prefix/virtualNetworks/vnet-first/subnets/RouteServerSubnet" }); secret = 'must-not-be-exported' }
    if ($env:MOCK_NETWORK_MODE -eq 'nat-prefix') { $nat.publicIpPrefixes = @(@{ id = "$prefix/publicIPPrefixes/nat-prefix" }) }
    else { $nat.publicIpAddresses = @(@{ id = "$prefix/publicIPAddresses/nat-ip" }) }
    ConvertTo-Json -InputObject @($nat) -Depth 10 -Compress
} elseif ($command -eq 'network routeserver list') {
    $result = @('first', 'second') | ForEach-Object {
        $configuration = @{ id = "$prefix/virtualHubs/ars-$_/ipConfigurations/default" }
        if ($env:MOCK_NETWORK_MODE -ne 'subnet-reference') { $configuration.subnet = @{ id = "$prefix/virtualNetworks/vnet-$_/subnets/RouteServerSubnet" } }
        @{ id = "$prefix/virtualHubs/ars-$_"; name = "ars-$_"; location = 'swedencentral'; ipConfigurations = @($configuration) }
    }
    ConvertTo-Json -InputObject @($result) -Depth 10 -Compress
} elseif ($command -eq 'network routeserver peering') {
    if ($args -contains 'list') {
        '[{"name":"same-peer","peerIp":"10.82.254.4","peerAsn":65001,"secret":"must-not-be-exported"}]'
    } else {
        '{"RouteServiceRole_IN_0":[{"network":"10.90.0.0/16","sourcePeer":"10.82.254.4","secret":"must-not-be-exported"}],"RouteServiceRole_IN_1":[]}'
    }
} elseif ($command -eq 'network nic list') {
    @{
        id = "$prefix/networkInterfaces/nic-probe"; name = 'nic-probe'; virtualMachine = @{ id = '/mock/vm' }
        ipConfigurations = @(@{ privateIPAddress = '10.82.254.4'; subnet = @{ id = "$prefix/virtualNetworks/vnet-first/subnets/RouteServerSubnet" }; secret = 'must-not-be-exported' })
        secret = 'must-not-be-exported'
    } | ForEach-Object { ConvertTo-Json -InputObject @($_) -Depth 10 -Compress }
} elseif ($command -in @('network route-table list', 'network vnet-gateway list', 'network local-gateway list', 'network vpn-connection list', 'network private-endpoint list', 'vm list -g', 'network nsg list', 'network lb list', 'network firewall list', 'network firewall policy')) {
    '[]'
} else { throw "Unexpected CLI command: $command" }
