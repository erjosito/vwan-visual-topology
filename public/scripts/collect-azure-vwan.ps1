#requires -Version 7.0
<#
.SYNOPSIS
Read one Standard Virtual WAN into an allowlisted, local topology capture.
.DESCRIPTION
Configuration-only captures use ARM GETs, version 1 and a 2 MB limit.
-IncludeEffectiveRoutes opts into version 2 (8 MB) and the Azure CLI's
observational effectiveRoutes POST action, including CLI-managed async polling.
Requires metadata reads (including subscription hub discovery) and
Microsoft.Network/virtualHubs/effectiveRoutes/action; Reader alone is insufficient.
Only discovered selected-WAN hub route tables are queried, not connection/NIC
tables. Observations are non-atomic and independent of configuration completeness.
Limits: 500 CLI invocations, 20 hubs, 20 minutes overall, 180 seconds per
effective-route invocation, no diagnostic retries, 100 route tables, 10000 rows/table, 20000 total.
CLI-owned polling/retries share the invocation deadline, not a separate REST backend.
Version 2 also records only the CLI version and selected subscription/tenant/cloud
metadata. Missing metadata is explicitly warned; a known cloud/subscription mismatch
fails before resource reads. No account user details or credentials are requested.
Effective-route actions are skipped unless account metadata confirms AzureCloud
and the selected subscription; explicit public-ARM configuration GETs remain usable.
See https://learn.microsoft.com/cli/azure/network/vhub#az-network-vhub-get-effective-routes
.EXAMPLE
./collect-azure-vwan.ps1 -VirtualWanId '/subscriptions/.../resourceGroups/.../providers/Microsoft.Network/virtualWans/...' -OutputFile ./vwan-capture.json
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$VirtualWanId,
    [string]$OutputFile = './vwan-capture.json',
    [switch]$AllowCrossSubscriptionVnets,
    [switch]$IncludeEffectiveRoutes,
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
$script:clock = [Diagnostics.Stopwatch]::StartNew()
$warnings = [System.Collections.Generic.List[string]]::new()

function Invoke-CaptureAz([string[]]$Arguments, [int]$TimeoutSeconds = 60, [int]$MaxOutputChars = 16000000) {
    if (++$script:requests -gt 500) { throw 'Capture request limit reached.' }
    $remaining = 1200000 - $script:clock.ElapsedMilliseconds
    if ($remaining -le 0) { throw 'Capture runtime limit reached.' }
    $info = [System.Diagnostics.ProcessStartInfo]::new()
    $info.UseShellExecute = $false
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.Environment['AZURE_EXTENSION_USE_DYNAMIC_INSTALL'] = 'no'
    if ($IsWindows -and [IO.Path]::GetExtension($azPath) -in @('.cmd', '.bat')) {
        $info.FileName = $env:ComSpec
        $info.Environment['VWAN_CAPTURE_AZ'] = $azPath
        $quoted = for ($i = 0; $i -lt $Arguments.Count; $i++) {
            if ($Arguments[$i] -match '["\r\n\x00]') { throw 'Unsafe CLI argument.' }
            $info.Environment["VWAN_CAPTURE_ARG_$i"] = $Arguments[$i]
            '"%VWAN_CAPTURE_ARG_' + $i + '%"'
        }
        # Expand once inside quotes; disable delayed expansion for literal ! in names.
        $info.Arguments = '/d /v:off /s /c ""%VWAN_CAPTURE_AZ%" ' + ($quoted -join ' ') + '"'
    } else {
        $info.FileName = $azPath
        foreach ($arg in $Arguments) { $info.ArgumentList.Add($arg) }
    }
    $process = [Diagnostics.Process]::Start($info)
    $watch = [Diagnostics.Stopwatch]::StartNew()
    try {
        # Drain both pipes concurrently, bounding memory even for oversized/error output.
        $outBuffer = [char[]]::new(8192)
        $errBuffer = [char[]]::new(8192)
        $stdout = [Text.StringBuilder]::new()
        $stderr = [Text.StringBuilder]::new()
        $outTask = $process.StandardOutput.ReadAsync($outBuffer, 0, $outBuffer.Length)
        $errTask = $process.StandardError.ReadAsync($errBuffer, 0, $errBuffer.Length)
        while ($null -ne $outTask -or $null -ne $errTask -or !$process.HasExited) {
            if ($watch.ElapsedMilliseconds -gt [Math]::Min($TimeoutSeconds * 1000, $remaining)) { throw 'CLI operation timed out.' }
            if ($null -ne $outTask -and $outTask.IsCompleted) {
                $count = $outTask.GetAwaiter().GetResult()
                if ($count -eq 0) { $outTask = $null }
                else {
                    if ($stdout.Length + $count -gt $MaxOutputChars) { throw 'CLI response size limit reached.' }
                    $null = $stdout.Append($outBuffer, 0, $count)
                    $outTask = $process.StandardOutput.ReadAsync($outBuffer, 0, $outBuffer.Length)
                }
            }
            if ($null -ne $errTask -and $errTask.IsCompleted) {
                $count = $errTask.GetAwaiter().GetResult()
                if ($count -eq 0) { $errTask = $null }
                else {
                    if ($stderr.Length -lt 65536) { $null = $stderr.Append($errBuffer, 0, [Math]::Min($count, 65536 - $stderr.Length)) }
                    $errTask = $process.StandardError.ReadAsync($errBuffer, 0, $errBuffer.Length)
                }
            }
            Start-Sleep -Milliseconds 5
        }
        $process.WaitForExit()
        if ($process.ExitCode -ne 0) {
            # Classify only; never export CLI text, headers, tokens or exception details.
            if ($stderr.ToString() -match '(?i)\b(AuthorizationFailed|Forbidden|AuthorizationDenied|403)\b') { throw 'CLI_DENIED' }
            if ($stderr.ToString() -match "(?i)(unrecognized arguments|not in the.*command group|is misspelled|extension.*not installed|requires the extension|InvalidApiVersionParameter|NotSupported)") { throw 'CLI_UNSUPPORTED' }
            throw 'CLI_FAILED'
        }
        try { return ($stdout.ToString() | ConvertFrom-Json -AsHashtable -Depth 50) }
        catch { throw 'Invalid CLI JSON response.' }
    } finally {
        if (!$process.HasExited) { $process.Kill($true); $process.WaitForExit() }
        $process.Dispose()
    }
}
function Read-CaptureContext {
    $script:effectiveContextVerified = $false
    $context = @{ cloud = 'AzureCloud'; subscriptionId = $subscriptionId; tenantId = $null; azureCliVersion = $null }
    try {
        $version = Invoke-CaptureAz @('version', '--output', 'json', '--only-show-errors') 15 65536
        if ($version -isnot [System.Collections.IDictionary] -or $version['azure-cli'] -isnot [string] -or
            $version['azure-cli'] -notmatch '^\d{1,5}\.\d{1,5}\.\d{1,5}[a-zA-Z0-9.+-]{0,40}$') { throw 'Invalid version metadata.' }
        $context.azureCliVersion = $version['azure-cli']
    } catch {
        $warnings.Add('Azure CLI version metadata is unavailable or invalid; azureCliVersion is null.')
        Write-Warning $warnings[$warnings.Count - 1]
    }
    $account = $null
    try {
        $account = Invoke-CaptureAz @('account', 'show', '--subscription', $subscriptionId,
            '--query', '{subscriptionId:id,tenantId:tenantId,cloud:environmentName}',
            '--output', 'json', '--only-show-errors') 15 65536
    } catch {
        # Account metadata failure does not invalidate independently captured configuration.
    }
    if ($account -is [System.Collections.IDictionary]) {
        if ($account.cloud -is [string] -and $account.cloud -cne 'AzureCloud') {
            throw 'Selected account cloud does not match public Azure; no capture was written.'
        }
        if ($account.subscriptionId -is [string] -and $account.subscriptionId -ine $subscriptionId) {
            throw 'Selected account subscription does not match the Virtual WAN; no capture was written.'
        }
        if ($account.cloud -is [string] -and $account.subscriptionId -is [string] -and
            $account.cloud -ceq 'AzureCloud' -and $account.subscriptionId -ieq $subscriptionId) {
            $script:effectiveContextVerified = $true
            if ($account.tenantId -is [string] -and $account.tenantId -match '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$') {
                $context.tenantId = $account.tenantId
            }
        }
    }
    if ($null -eq $context.tenantId) {
        $warnings.Add('Selected account metadata is unavailable or invalid; tenantId is null. AzureCloud and subscriptionId identify the requested capture scope, not a verified account context.')
        Write-Warning $warnings[$warnings.Count - 1]
    }
    $tenantDisplay = if ($null -eq $context.tenantId) { 'unknown (metadata unavailable)' } else { $context.tenantId }
    Write-Host "Selected public Azure subscription: $subscriptionId. Tenant: $tenantDisplay."
    return $context
}
function Read-Arm([string]$Uri) {
    $target = [uri]$Uri
    if ($target.Scheme -ne 'https' -or $target.Host -ne 'management.azure.com' -or $target.Port -ne 443 -or $target.UserInfo -or $target.Fragment) {
        throw 'Unexpected ARM endpoint.'
    }
    for ($attempt = 0; $attempt -lt 3; $attempt++) {
        try {
            return (Invoke-CaptureAz @('rest', '--method', 'get', '--url', $target.AbsoluteUri, '--output', 'json', '--only-show-errors'))
        } catch {
            if ($attempt -eq 2) { throw }
            Start-Sleep -Seconds ($attempt + 1)
        }
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
function Read-EffectiveTable($Hub, [bool]$DiscoveredDefault, [string]$TableId = "$($Hub.id)/hubRouteTables/defaultRouteTable") {
    $entry = @{
        hubResourceId = $Hub.id; resourceId = $TableId
        resourceType = 'RouteTable'; status = 'unsupported'
        capturedAt = [DateTime]::UtcNow.ToString('o')
        apiVersion = 'az network vhub get-effective-routes'
        routes = @(); warnings = @()
    }
    if (!$script:effectiveContextVerified) {
        $entry.warnings = @('Effective routes were not queried because account metadata did not confirm AzureCloud and the selected subscription. Configuration uses explicit public Azure ARM GETs; this route section is unavailable.')
        return $entry
    }
    if (!$DiscoveredDefault) {
        $entry.warnings = @('Default table was not discovered; effective routes were not queried.')
        return $entry
    }
    try {
        if ($Hub.id -notmatch '^/subscriptions/([a-f0-9-]{36})/resourceGroups/([^/?"#\r\n]+)/providers/Microsoft\.Network/virtualHubs/([^/?"#\r\n]+)$' -or $Matches[1] -ine $subscriptionId) {
            throw 'Invalid hub scope.'
        }
        $group = $Matches[2]
        $hubName = $Matches[3]
        $response = Invoke-CaptureAz @('network', 'vhub', 'get-effective-routes',
            '--resource-type', 'RouteTable', '--resource-id', $entry.resourceId,
            '--name', $hubName, '--resource-group', $group, '--subscription', $subscriptionId,
            '--output', 'json', '--only-show-errors') 180
        if ($response -isnot [System.Collections.IDictionary] -or !$response.ContainsKey('value') -or $response.value -isnot [array]) {
            $entry.warnings = @('Unsupported effective-route response shape; no rows accepted.')
            return $entry
        }
        $rows = [System.Collections.Generic.List[object]]::new()
        $limit = [Math]::Min(10000, 20000 - $script:effectiveRowCount)
        foreach ($row in $response.value) {
            if ($rows.Count -ge $limit) { break }
            if ($row -isnot [System.Collections.IDictionary] -or
                @($row.Keys | Where-Object { $_ -notin @('addressPrefixes', 'nextHopType', 'nextHops', 'routeOrigin', 'asPath') }).Count -gt 0 -or
                $row.nextHopType -isnot [string] -or $row.routeOrigin -isnot [string] -or
                ($null -ne $row.asPath -and $row.asPath -isnot [string])) {
                $entry.warnings = @('Unsupported effective-route row shape; no rows accepted.')
                return $entry
            }
            foreach ($field in @('addressPrefixes', 'nextHops')) {
                if ($null -ne $row[$field] -and ($row[$field] -isnot [array] -or @($row[$field] | Where-Object { $_ -isnot [string] }).Count -gt 0)) {
                    $entry.warnings = @('Unsupported effective-route array shape; no rows accepted.')
                    return $entry
                }
            }
            $rows.Add(@{
                addressPrefixes = $(if ($null -eq $row.addressPrefixes) { ,@() } else { ,$row.addressPrefixes })
                nextHopType = $row.nextHopType
                nextHops = $(if ($null -eq $row.nextHops) { ,@() } else { ,$row.nextHops })
                routeOrigin = $row.routeOrigin
                asPath = $(if ($null -eq $row.asPath) { '' } else { $row.asPath })
            })
        }
        $entry.routes = $rows.ToArray()
        $script:effectiveRowCount += $rows.Count
        if ($response.value.Count -gt $limit -or $response.nextLink) {
            $entry.status = 'truncated'
            $entry.warnings = @('Effective routes exceeded the 10000/table or 20000/total row bound, or returned pagination. Only the retained rows are present; absence is not evidence.')
        } elseif ($rows.Count -eq 0) { $entry.status = 'empty' }
        else { $entry.status = 'complete' }
    } catch {
        $entry.status = switch ($_.Exception.Message) {
            'CLI_DENIED' { 'denied' }
            'CLI_UNSUPPORTED' { 'unsupported' }
            default { 'failed' }
        }
        $entry.warnings = @('Effective routes unavailable. Check CLI virtual-wan support, az login, metadata reads and Microsoft.Network/virtualHubs/effectiveRoutes/action permissions (Reader alone is insufficient), or retry later. No CLI error details were exported.')
    } finally { $entry.capturedAt = [DateTime]::UtcNow.ToString('o') }
    return $entry
}

$observations = @{ version = 1; startedAt = [DateTime]::UtcNow.ToString('o'); completedAt = $null; tables = @() }
$effectiveTables = [System.Collections.Generic.List[object]]::new()
$script:effectiveRowCount = 0
$context = if ($IncludeEffectiveRoutes) { Read-CaptureContext } else { $null }
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
    $priorLimitations = $limitations.Count
    $tables = @(Read-HubCollection "$($hub.id)/hubRouteTables" 'Route tables' $limitations)
    $tablesKnown = $priorLimitations -eq $limitations.Count
    if ($tables.Count -gt 64) {
        $tablesKnown = $false
        $tables = @($tables | Select-Object -First 64)
        $limitations.Add('Hub route-table inventory exceeds the supported bound; configuration is incomplete.')
    }
    if ($IncludeEffectiveRoutes) {
        $defaultDiscovered = @($tables | Where-Object { $_.name -ieq 'defaultRouteTable' -and $_.id -ieq "$($hub.id)/hubRouteTables/defaultRouteTable" }).Count -eq 1
        $effectiveTables.Add((Read-EffectiveTable $hub $defaultDiscovered))
        foreach ($table in @($tables | Where-Object { $_.name -notin @('defaultRouteTable','noneRouteTable') } | Sort-Object id)) {
            $remainingDefaults = $selectedHubs.Count - $capturedHubs.Count - 1
            if ($effectiveTables.Count -ge (100 - $remainingDefaults)) {
                $warnings.Add('Additional hub effective-route tables were not requested at the 100-table safety limit.')
                break
            }
            if ($table.id -ine "$($hub.id)/hubRouteTables/$($table.name)" -or $table.name -notmatch '^[^/?#\r\n]+$') {
                $tablesKnown = $false
                $limitations.Add('A hub route-table identity was inconsistent; its routes were not queried.')
                continue
            }
            $effectiveTables.Add((Read-EffectiveTable $hub $true $table.id))
        }
    }
    $projectedTables = @($tables | ForEach-Object {
        if ($_.properties.routes -isnot [array] -or $_.properties.labels -isnot [array] -or
            $_.properties.routes.Count -gt 1000 -or $_.properties.labels.Count -gt 64) { $tablesKnown = $false }
        @{
            id = $_.id; name = $_.name
            labels = @($_.properties.labels | Where-Object { $null -ne $_ } | Select-Object -First 64)
            staticRoutes = @($_.properties.routes | Where-Object { $null -ne $_ } | Select-Object -First 1000 | ForEach-Object {
                @{ name = $_.name; destinationType = $_.destinationType; destinations = @($_.destinations)
                   nextHopType = $_.nextHopType; nextHop = [string]$_.nextHop }
            })
        }
    })
    if (@($tables | Where-Object { $_.properties.routes.Count -gt 0 }).Count -gt 0) {
        $limitations.Add('Hub static-route controls are captured; their arbitrary next-hop forwarding is not simulated.')
    }
    if ($hub.properties.routeTable.routes.Count -gt 0 -or $hub.properties.virtualHubRouteTableV2s.Count -gt 0) {
        $tablesKnown = $false
        $limitations.Add('Legacy hub static-route controls are not simulated.')
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
        $unsupported = [System.Collections.Generic.List[string]]::new()
        if ($routing.inboundRouteMap.id -or $routing.outboundRouteMap.id) {
            $unsupported.Add('VNet connection route-map controls are not reconstructed.')
        }
        if ($routing.vnetRoutes.staticRoutes.Count -gt 0 -or $routing.vnetRoutes.staticRoutesConfig.propagateStaticRoutes -eq $false) {
            $unsupported.Add('VNet connection static/NVA route controls are not simulated.')
        }
        $routingKnown = $null -ne $routing -and $routing.associatedRouteTable.id -is [string] -and
            $null -ne $propagated -and $propagated.labels -is [array] -and
            $unsupported.Count -eq 0 -and $ids.Count -le 64 -and $labels.Count -le 64
        $defaultRouting = $null -ne $routing -and $routing.associatedRouteTable.id -ieq $defaultTable -and
            ($ids.Count -gt 0 -or $labels.Count -gt 0) -and
            @($ids | Where-Object { $_ -ine $defaultTable }).Count -eq 0 -and
            @($labels | Where-Object { $_ -ine 'Default' }).Count -eq 0 -and
            !$routing.inboundRouteMap.id -and !$routing.outboundRouteMap.id -and
            $routing.vnetRoutes.staticRoutes.Count -eq 0 -and
            $routing.vnetRoutes.staticRoutesConfig.propagateStaticRoutes -ne $false
        $connections.Add(@{
            id = $connection.id
            name = ($vnetId -split '/')[-1]
            virtualNetworkId = $vnetId
            addressPrefixes = $vnetCache[$vnetId]
            defaultRouting = [bool]$defaultRouting
            routingConfiguration = @{
                status = $(if ($routingKnown) { 'captured' } else { 'unknown' })
                associatedTableId = $(if ($routing.associatedRouteTable.id -is [string]) { $routing.associatedRouteTable.id } else { $null })
                propagatedTableIds = @($ids | Select-Object -First 64)
                labels = @($labels | Select-Object -First 64)
                unsupportedControls = $unsupported.ToArray()
            }
            enableInternetSecurity = $(if ($connection.properties.enableInternetSecurity -is [bool]) { $connection.properties.enableInternetSecurity } else { $null })
        })
    }
    $gateways = @(
        if ($hub.properties.vpnGateway.id) { 'VPN' }
        if ($hub.properties.expressRouteGateway.id) { 'ExpressRoute' }
        if ($hub.properties.p2SVpnGateway.id) { 'P2S' }
    )
    $priorLimitations = $limitations.Count
    $bgpConnections = @(Read-HubCollection "$($hub.id)/bgpConnections" 'Hub BGP connections' $limitations)
    $branchScopeKnown = $priorLimitations -eq $limitations.Count -and $gateways.Count -eq 0 -and $bgpConnections.Count -eq 0
    $capturedHubs.Add(@{
        id = $hub.id; name = $hub.name; location = $hub.location
        virtualWanId = $hub.properties.virtualWan.id; addressPrefix = $hub.properties.addressPrefix
        hubRoutingPreference = $hub.properties.hubRoutingPreference
        routingPolicies = $policies; gatewayTypes = $gateways
        routeTablesStatus = $(if ($tablesKnown) { 'captured' } else { 'unknown' })
        routeTables = $projectedTables
        branchRoutingStatus = $(if ($branchScopeKnown) { 'captured' } else { 'unknown' })
        connections = $connections.ToArray(); unsupportedFeatures = $limitations.ToArray()
    })
}
$capture = @{
    kind = 'azure-vwan-capture'; version = 1; collectorVersion = '1'; routingContextVersion = 1
    capturedAt = [DateTime]::UtcNow.ToString('o'); complete = $script:complete
    wan = @{
        id = $wan.id; name = $wan.name; location = $wan.location; type = $wan.properties.type
        allowBranchToBranchTraffic = $wan.properties.allowBranchToBranchTraffic
        allowVnetToVnetTraffic = $wan.properties.allowVnetToVnetTraffic
    }
    hubs = $capturedHubs.ToArray(); warnings = $warnings.ToArray()
}
$json = $capture | ConvertTo-Json -Depth 20
if ($IncludeEffectiveRoutes) {
    $capture.version = 2
    $capture.collectorVersion = '2'
    $capture.context = $context
    $observations.tables = $effectiveTables.ToArray()
    $observations.completedAt = [DateTime]::UtcNow.ToString('o')
    $capture.observations = $observations
    $json = $capture | ConvertTo-Json -Depth 20
}
$byteLimit = if ($IncludeEffectiveRoutes) { 8000000 } else { 2000000 }
if ([Text.Encoding]::UTF8.GetByteCount($json) -gt $byteLimit) { throw "Capture exceeds the app limit of $($byteLimit / 1000000) MB; no file was written." }
Set-Content -LiteralPath $OutputFile -Value $json -Encoding utf8 -NoNewline
Write-Host "Saved $($selectedHubs.Count) hubs and $connectionCount VNet references. Complete: $script:complete. Import this file into Topology Lab and review all limitations."
