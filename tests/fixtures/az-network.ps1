#requires -Version 7.0
$ErrorActionPreference = 'Stop'
$subscription = '11111111-1111-1111-1111-111111111111'
$prefix = "/subscriptions/$subscription/resourceGroups/network/providers/Microsoft.Network"
$command = $args[0..([Math]::Min(2, $args.Count - 1))] -join ' '
Add-Content -LiteralPath $env:MOCK_NETWORK_LOG -Value (ConvertTo-Json -InputObject @($args) -Compress)
if ($args -notcontains '--query' -or $args -notcontains '--only-show-errors') { throw 'Missing projected, quiet CLI invocation.' }
if ($command.StartsWith('network ') -and $args[[Array]::IndexOf($args, '--subscription') + 1] -ne $subscription) { throw 'Subscription not pinned.' }
if ($command -eq 'network route-table list' -and $env:MOCK_NETWORK_MODE -eq 'denied') {
    [Console]::Error.WriteLine('AuthorizationFailed 403 Bearer must-not-be-exported'); exit 1
}
if ($command -eq 'network vnet-gateway list' -and $env:MOCK_NETWORK_MODE -eq 'failed') {
    [Console]::Error.WriteLine('Internal error sharedKey=must-not-be-exported'); exit 1
}
if ($command -eq 'network nic show-effective-route-table') {
    switch ($env:MOCK_NETWORK_MODE) {
        'timeout' { Start-Sleep -Seconds 30 }
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
        @{
            id = $id; name = "vnet-$_"; location = 'swedencentral'; secret = 'must-not-be-exported'
            addressSpace = @{ addressPrefixes = @('10.82.0.0/16') }
            subnets = @(@{
                id = "$id/subnets/RouteServerSubnet"; name = 'RouteServerSubnet'; secret = 'must-not-be-exported'
                addressPrefix = '10.82.254.0/26'
                ipConfigurations = @(@{ id = "$prefix/virtualHubs/ars-$_/ipConfigurations/default" })
            })
        }
    }
    ConvertTo-Json -InputObject @($result) -Depth 10 -Compress
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
} elseif ($command -in @('network route-table list', 'network vnet-gateway list', 'network local-gateway list', 'network vpn-connection list', 'network private-endpoint list')) {
    '[]'
} else { throw "Unexpected CLI command: $command" }
