#requires -Version 7.0
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot
$output = Join-Path $repo 'test-artifacts' 'azure-files' 'collector-network'
$null = New-Item -ItemType Directory -Force -Path $output
$subscription = '11111111-1111-1111-1111-111111111111'
$prefix = "/subscriptions/$subscription/resourceGroups/network/providers/Microsoft.Network"

function az {
    $global:LASTEXITCODE = 0
    $command = $args[0..([Math]::Min(2, $args.Count - 1))] -join ' '
    if ($command -eq 'account show --subscription') {
        @{ id = $subscription } | ConvertTo-Json -Compress
    } elseif ($command -eq 'network vnet list') {
        @('second', 'first') | ForEach-Object {
            $id = "$prefix/virtualNetworks/vnet-$_"
            @{
                id = $id; name = "vnet-$_"; location = 'swedencentral'
                subnets = @(@{
                    id = "$id/subnets/RouteServerSubnet"; name = 'RouteServerSubnet'
                    addressPrefix = '10.82.254.0/26'
                    ipConfigurations = @(@{ id = "$prefix/virtualHubs/ars-$_/ipConfigurations/default" })
                })
            }
        } | ConvertTo-Json -Depth 10 -Compress
    } elseif ($command -eq 'network routeserver list') {
        @('first', 'second') | ForEach-Object {
            $configuration = @{ id = "$prefix/virtualHubs/ars-$_/ipConfigurations/default" }
            if ($script:mode -eq 'direct') {
                $configuration.subnet = @{ id = "$prefix/virtualNetworks/vnet-$_/subnets/RouteServerSubnet" }
            }
            @{
                id = "$prefix/virtualHubs/ars-$_"; name = "ars-$_"; location = 'swedencentral'
                ipConfigurations = @($configuration)
            }
        } | ConvertTo-Json -Depth 10 -Compress
    } elseif ($command -in @(
        'network route-table list', 'network vnet-gateway list', 'network local-gateway list',
        'network vpn-connection list', 'network routeserver peering',
        'network private-endpoint list', 'network nic list'
    )) {
        '[]'
    } else {
        throw "Unexpected CLI command: $command"
    }
}

foreach ($script:mode in @('direct', 'subnet-reference')) {
    $file = Join-Path $output "$mode.json"
    & (Join-Path $repo 'public' 'scripts' 'collect-azure-network.ps1') `
        -ResourceGroupName network -SubscriptionId $subscription -OutputFile $file -Force
    $capture = Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
    foreach ($name in @('first', 'second')) {
        $server = $capture.routeServers | Where-Object name -eq "ars-$name"
        $expected = "$prefix/virtualNetworks/vnet-$name/subnets/RouteServerSubnet"
        if ($server.subnetId -ne $expected) {
            throw "$mode associated ars-$name with '$($server.subnetId)' instead of '$expected'"
        }
    }
    Write-Host "Passed $mode Route Server subnet ownership."
}
