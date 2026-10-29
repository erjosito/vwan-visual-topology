#requires -Version 7.0
<#
.SYNOPSIS
Read one Standard Virtual WAN into an allowlisted, local topology capture.
.EXAMPLE
./collect-azure-vwan.ps1 -VirtualWanId '/subscriptions/.../resourceGroups/.../providers/Microsoft.Network/virtualWans/...' -OutputFile ./vwan-capture.json
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$VirtualWanId,
    [string]$OutputFile = './vwan-capture.json',
    [switch]$AllowCrossSubscriptionVnets,
    [switch]$Force
)
$ErrorActionPreference = 'Stop'
if ($VirtualWanId -notmatch '^/subscriptions/([a-f0-9-]{36})/resourceGroups/[^/?#\r\n]+/providers/Microsoft\.Network/virtualWans/[^/?#\r\n]+$') {
    throw 'Supply the full Virtual WAN ARM ID (public Azure only).'
}
$subscriptionId = $Matches[1]
if ((Test-Path -LiteralPath $OutputFile) -and !$Force) { throw 'Output file exists. Choose another file or explicitly use -Force.' }
$azPath = (Get-Command az -ErrorAction Stop).Source
$apiVersion = '2024-10-01'
$script:complete = $true
$script:requests = 0
$warnings = [System.Collections.Generic.List[string]]::new()

function Read-Arm([string]$Uri) {
    $target = [uri]$Uri
    if ($target.Scheme -ne 'https' -or $target.Host -ne 'management.azure.com' -or $target.Port -ne 443 -or $target.UserInfo -or $target.Fragment) {
        throw 'Unexpected ARM endpoint.'
    }
    for ($attempt = 0; $attempt -lt 3; $attempt++) {
        if (++$script:requests -gt 500) { throw 'Capture request limit reached.' }
        $info = [System.Diagnostics.ProcessStartInfo]::new()
        $info.UseShellExecute = $false
        $info.RedirectStandardOutput = $true
        $info.RedirectStandardError = $true
        if ($IsWindows -and [IO.Path]::GetExtension($azPath) -in @('.cmd', '.bat')) {
            # Environment expansion preserves quoted pagination URLs containing both & and percent escapes.
            $info.FileName = $env:ComSpec
            $info.Environment['VWAN_CAPTURE_AZ'] = $azPath
            $info.Environment['VWAN_CAPTURE_URI'] = $target.AbsoluteUri
            $info.Arguments = '/d /s /c ""%VWAN_CAPTURE_AZ%" rest --method get --url "%VWAN_CAPTURE_URI%" --output json --only-show-errors"'
        } else {
            $info.FileName = $azPath
            foreach ($arg in @('rest', '--method', 'get', '--url', $target.AbsoluteUri, '--output', 'json', '--only-show-errors')) { $info.ArgumentList.Add($arg) }
        }
        $process = [System.Diagnostics.Process]::Start($info)
        try {
            $stdout = $process.StandardOutput.ReadToEndAsync()
            $stderr = $process.StandardError.ReadToEndAsync()
            if (!$process.WaitForExit(60000)) {
                $process.Kill($true)
                $process.WaitForExit()
                throw 'ARM read timed out after 60 seconds.'
            }
            if ($process.ExitCode -ne 0) { throw 'ARM read failed. Verify az login and read permissions.' }
            return ($stdout.GetAwaiter().GetResult() | ConvertFrom-Json -AsHashtable -Depth 50)
        } catch {
            if ($attempt -eq 2) { throw }
            Start-Sleep -Seconds ($attempt + 1)
        } finally { $process.Dispose() }
    }
}
function Read-Resource([string]$ResourceId) {
    Read-Arm "https://management.azure.com${ResourceId}?api-version=$apiVersion"
}
function Read-Collection([string]$ResourceId) {
    $uri = "https://management.azure.com${ResourceId}?api-version=$apiVersion"
    $path = ([uri]$uri).AbsolutePath
    $seen = [System.Collections.Generic.HashSet[string]]::new()
    $items = [System.Collections.Generic.List[object]]::new()
    while ($uri) {
        if ($seen.Count -ge 20 -or !$seen.Add($uri) -or ([uri]$uri).AbsolutePath -ne $path) { throw 'Invalid or excessive ARM pagination.' }
        $page = Read-Arm $uri
        if (!$page.ContainsKey('value') -or $page.value -isnot [array]) { throw 'Invalid ARM collection response.' }
        foreach ($item in $page.value) {
            $items.Add($item)
            if ($items.Count -gt 2000) { throw 'ARM collection limit reached.' }
        }
        $uri = $page.nextLink
    }
    $items.ToArray()
}
function Read-HubCollection([string]$ResourceId, [string]$Label, [System.Collections.Generic.List[string]]$Limitations) {
    try { Read-Collection $ResourceId }
    catch {
        $script:complete = $false
        $Limitations.Add("$Label could not be read; configuration is incomplete.")
    }
}

$wan = Read-Resource $VirtualWanId
if ($wan.id -ine $VirtualWanId -or $wan.properties.type -ne 'Standard') { throw 'The selected resource must be a Standard Virtual WAN.' }
$allHubs = @(Read-Collection "/subscriptions/$subscriptionId/providers/Microsoft.Network/virtualHubs")
$selectedHubs = @($allHubs | Where-Object { $_.properties.virtualWan.id -ieq $VirtualWanId } | Sort-Object id)
if ($selectedHubs.Count -gt 20) { throw 'This WAN exceeds the app limit of 20 hubs.' }
$capturedHubs = [System.Collections.Generic.List[object]]::new()
$vnetCache = @{}
$connectionCount = 0
foreach ($hub in $selectedHubs) {
    $limitations = [System.Collections.Generic.List[string]]::new()
    if ($hub.properties.provisioningState -ne 'Succeeded') { $limitations.Add('Hub provisioning is not Succeeded.') }
    if ($hub.properties.allowBranchToBranchTraffic -eq $false) { $limitations.Add('Hub branch-to-branch transit is disabled.') }
    $tables = @(Read-HubCollection "$($hub.id)/hubRouteTables" 'Route tables' $limitations)
    if (@($tables | Where-Object { $_.name -notin @('defaultRouteTable', 'noneRouteTable') -or $_.properties.routes.Count -gt 0 }).Count -gt 0 -or $hub.properties.routeTable.routes.Count -gt 0 -or $hub.properties.virtualHubRouteTableV2s.Count -gt 0) {
        $limitations.Add('Custom hub route tables or static routes are not reconstructed.')
    }
    $maps = @(Read-HubCollection "$($hub.id)/routeMaps" 'Route maps' $limitations)
    if ($maps.Count -gt 0) { $limitations.Add('Azure route maps are not reconstructed.') }
    if ($hub.properties.securityPartnerProvider.id -or $hub.properties.securityProviderName) { $limitations.Add('Security partner/NVA settings are not reconstructed.') }
    $intents = @(Read-HubCollection "$($hub.id)/routingIntent" 'Routing intent' $limitations)
    $policies = @($intents | ForEach-Object { $_.properties.routingPolicies } | ForEach-Object {
        @{ destinations = @($_.destinations); nextHop = $_.nextHop }
    })
    $connections = [System.Collections.Generic.List[object]]::new()
    foreach ($connection in @(Read-HubCollection "$($hub.id)/hubVirtualNetworkConnections" 'VNet connections' $limitations)) {
        if (++$connectionCount -gt 60) { throw 'This WAN exceeds the app limit of 60 VNet connections.' }
        $vnetId = $connection.properties.remoteVirtualNetwork.id
        if ($vnetId -notmatch '^/subscriptions/([a-f0-9-]{36})/resourceGroups/[^/?#\r\n]+/providers/Microsoft\.Network/virtualNetworks/[^/?#\r\n]+$') { throw 'Invalid referenced VNet ID.' }
        $crossSubscription = $Matches[1] -ine $subscriptionId
        if (!$vnetCache.ContainsKey($vnetId)) {
            $prefixes = $null
            if ($crossSubscription -and !$AllowCrossSubscriptionVnets) {
                $script:complete = $false
                $limitations.Add('Cross-subscription VNet read skipped. Opt in with -AllowCrossSubscriptionVnets to read only referenced VNets.')
            } else {
                try {
                    $vnet = Read-Resource $vnetId
                    if ($vnet.id -ine $vnetId) { throw 'Unexpected VNet resource.' }
                    $prefixes = @($vnet.properties.addressSpace.addressPrefixes)
                } catch {
                    $script:complete = $false
                    $limitations.Add('A referenced VNet read failed; check read permissions.')
                }
            }
            $vnetCache[$vnetId] = $prefixes
        }
        $routing = $connection.properties.routingConfiguration
        $defaultTable = "$($hub.id)/hubRouteTables/defaultRouteTable"
        $propagated = $routing.propagatedRouteTables
        $ids = @($propagated.ids | ForEach-Object { $_.id })
        $labels = @($propagated.labels)
        $defaultRouting = $null -ne $routing -and $routing.associatedRouteTable.id -ieq $defaultTable -and
            ($ids.Count -gt 0 -or $labels.Count -gt 0) -and
            @($ids | Where-Object { $_ -ine $defaultTable }).Count -eq 0 -and
            @($labels | Where-Object { $_ -ine 'Default' }).Count -eq 0 -and
            !$routing.inboundRouteMap.id -and !$routing.outboundRouteMap.id -and
            $routing.vnetRoutes.staticRoutes.Count -eq 0 -and
            $routing.vnetRoutes.staticRoutesConfig.propagateStaticRoutes -ne $false -and
            !$routing.vnetRoutes.staticRoutesConfig.vnetLocalRouteOverrideCriteria
        $connections.Add(@{
            name = ($vnetId -split '/')[-1]
            virtualNetworkId = $vnetId
            addressPrefixes = $vnetCache[$vnetId]
            defaultRouting = [bool]$defaultRouting
        })
    }
    $gateways = @(
        if ($hub.properties.vpnGateway.id) { 'VPN' }
        if ($hub.properties.expressRouteGateway.id) { 'ExpressRoute' }
        if ($hub.properties.p2SVpnGateway.id) { 'P2S' }
    )
    $capturedHubs.Add(@{
        id = $hub.id; name = $hub.name; location = $hub.location
        virtualWanId = $hub.properties.virtualWan.id; addressPrefix = $hub.properties.addressPrefix
        hubRoutingPreference = $hub.properties.hubRoutingPreference
        routingPolicies = $policies; gatewayTypes = $gateways
        connections = $connections.ToArray(); unsupportedFeatures = $limitations.ToArray()
    })
}
$capture = @{
    kind = 'azure-vwan-capture'; version = 1; collectorVersion = '1'
    capturedAt = [DateTime]::UtcNow.ToString('o'); complete = $script:complete
    wan = @{
        id = $wan.id; name = $wan.name; location = $wan.location; type = $wan.properties.type
        allowBranchToBranchTraffic = $wan.properties.allowBranchToBranchTraffic
        allowVnetToVnetTraffic = $wan.properties.allowVnetToVnetTraffic
    }
    hubs = $capturedHubs.ToArray(); warnings = $warnings.ToArray()
}
$json = $capture | ConvertTo-Json -Depth 20
if ([Text.Encoding]::UTF8.GetByteCount($json) -gt 2000000) { throw 'Capture exceeds the app limit of 2 MB.' }
Set-Content -LiteralPath $OutputFile -Value $json -Encoding utf8 -NoNewline
Write-Host "Saved $($selectedHubs.Count) hubs and $connectionCount VNet references. Complete: $script:complete. Import this file into Topology Lab and review all limitations."
