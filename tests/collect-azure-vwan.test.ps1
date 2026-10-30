#requires -Version 7.0
param([ValidateSet('All', 'Metadata')][string]$Suite = 'All')
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot
$output = Join-Path $repo 'test-artifacts' 'azure-files' 'collector'
$null = New-Item -ItemType Directory -Force -Path $output
$pwshPath = (Get-Process -Id $PID).Path
$fixture = Join-Path $PSScriptRoot 'fixtures' 'az.ps1'
$driver = Join-Path $output 'az-driver.ps1'
Set-Content -LiteralPath $driver -Value @'
$ErrorActionPreference = 'Stop'
if ($args[0] -in @('version', 'account')) {
    Add-Content -LiteralPath $env:MOCK_METADATA_LOG -Value (ConvertTo-Json -InputObject @($args) -Compress)
    if ($env:MOCK_METADATA_MODE -eq 'failure' -or ($args[0] -eq 'version' -and $env:MOCK_METADATA_MODE -eq 'version-failure')) {
        [Console]::Error.WriteLine('metadata error must-not-be-exported'); exit 1
    }
    if ($args[0] -eq 'version') {
        $version = if ($env:MOCK_METADATA_MODE -eq 'invalid') { 'must-not-be-exported@example.invalid' } else { '2.80.0' }
        @{ 'azure-cli' = $version; extensions = @{ ignored = 'must-not-be-exported' } } | ConvertTo-Json -Compress
    } else {
        $metadata = @{
            subscriptionId = '11111111-1111-1111-1111-111111111111'
            tenantId = '33333333-3333-3333-3333-333333333333'; cloud = 'AzureCloud'
        }
        switch ($env:MOCK_METADATA_MODE) {
            'wrong-subscription' { $metadata.subscriptionId = '22222222-2222-2222-2222-222222222222' }
            'wrong-cloud' { $metadata.cloud = 'AzureUSGovernment' }
            'invalid' { $metadata.tenantId = 'must-not-be-exported@example.invalid' }
            'missing-fields' { $metadata = @{ tenantId = '33333333-3333-3333-3333-333333333333' } }
            'wrong-shape' { $metadata.cloud = @('AzureCloud'); $metadata.subscriptionId = @($metadata.subscriptionId) }
            'null-tenant' { $metadata.tenantId = $null }
        }
        $metadata.user = @{ name = 'must-not-be-exported@example.invalid' }
        $metadata | ConvertTo-Json -Compress
    }
    exit 0
}
if ($args[0] -eq 'network') {
    Add-Content -LiteralPath $env:MOCK_EFFECTIVE_LOG -Value (ConvertTo-Json -InputObject @($args) -Compress)
    if (($args[0..2] -join ' ') -ne 'network vhub get-effective-routes') { throw 'Unexpected diagnostic command.' }
    if ($args -contains '--no-wait' -or $args -contains '--debug' -or $args -contains '--verbose') { throw 'CLI must wait without verbose credentials/logs.' }
    switch ($env:MOCK_EFFECTIVE_MODE) {
        'denied' { [Console]::Error.WriteLine('AuthorizationFailed 403 Bearer must-not-be-exported'); exit 1 }
        'failed' { [Console]::Error.WriteLine('Internal error token=must-not-be-exported'); exit 1 }
        'unsupported' { [Console]::Error.WriteLine('get-effective-routes is misspelled or not recognized. must-not-be-exported'); exit 1 }
        'missing-extension' { [Console]::Error.WriteLine('The command requires the extension virtual-wan. must-not-be-exported'); exit 1 }
        '429' { [Console]::Error.WriteLine('429 TooManyRequests must-not-be-exported'); exit 1 }
        'timeout' { Start-Sleep -Seconds 30; '{"value":[]}'; exit 0 }
        'bad-json' { 'not-json must-not-be-exported'; exit 0 }
        'bad-envelope' { '{"value":null}'; exit 0 }
        'empty' { '{"value":[]}'; exit 0 }
    }
    $row = @{
        addressPrefixes = @('10.2.0.0/16', '2001:db8::/32')
        nextHops = @('/arbitrary/first', '/arbitrary/second')
        nextHopType = 'Unknown future type'; routeOrigin = 'raw origin'; asPath = $null
    }
    switch ($env:MOCK_EFFECTIVE_MODE) {
        'bad-row' { $row.addressPrefixes = 'not-an-array' }
        'bad-member' { $row.nextHops = @('good', 12) }
        'bad-path' { $row.asPath = @('65000') }
        'unknown-field' { $row.newField = 'not silently discarded' }
        'null-arrays' { $row.addressPrefixes = $null; $row.nextHops = $null }
        'oversize-v2' { $row.routeOrigin = 'x' * 8100000 }
    }
    $count = switch ($env:MOCK_EFFECTIVE_MODE) {
        'table-bound' { 10001 }
        'total-bound' { 10000 }
        default { 1 }
    }
    $rows = [Collections.Generic.List[object]]::new()
    for ($i = 0; $i -lt $count; $i++) { $rows.Add($row) }
    if ($env:MOCK_EFFECTIVE_MODE -eq 'normal') {
        $rows.Add(@{
            addressPrefixes = @('10.3.0.0/16'); nextHops = @('On-link')
            nextHopType = 'Virtual Network Connection'; routeOrigin = '/raw/source'
            asPath = '65000 65000 65520'
        })
    }
    $response = @{ value = $rows.ToArray() }
    if ($env:MOCK_EFFECTIVE_MODE -eq 'pagination') { $response.nextLink = 'https://example.invalid/do-not-follow' }
    $response | ConvertTo-Json -Compress -Depth 20
    exit 0
}
$result = & $env:MOCK_BASE_FIXTURE @args
if ($LASTEXITCODE) { exit $LASTEXITCODE }
$data = $result | ConvertFrom-Json -AsHashtable
$uri = $args[[Array]::IndexOf($args, '--url') + 1]
$path = [uri]::UnescapeDataString(([uri]$uri).AbsolutePath)
if ($path -like '*/hubRouteTables') {
    foreach ($table in $data.value) { $table.id = "$path/$($table.name)" }
    if ($env:MOCK_EFFECTIVE_MODE -eq 'missing-default') { $data.value = @() }
}
if ($path -like '*/hubVirtualNetworkConnections') {
    foreach ($connection in $data.value) {
        $connection.id = "$path/$($connection.name)"
        if ($env:MOCK_EFFECTIVE_MODE -ne 'null-security') { $connection.properties.enableInternetSecurity = $env:MOCK_EFFECTIVE_MODE -ne 'false-security' }
    }
}
if ($path -like '*/providers/Microsoft.Network/virtualHubs' -and $uri -notlike '*skipToken=*') {
    if ($env:MOCK_METADATA_MODE -and $env:MOCK_METADATA_MODE -notin @('failure', 'missing-fields')) { $data = @{ value = @() } }
    if ($env:MOCK_EFFECTIVE_MODE -eq 'total-bound') {
        $first = $data.value[0]
        $data.value += @(
            @{ id = "$($first.id)2"; name = 'Second hub'; properties = $first.properties },
            @{ id = "$($first.id)3"; name = 'Third hub'; properties = $first.properties }
        )
    }
    if ($env:MOCK_EFFECTIVE_MODE -eq 'argument-safety') {
        $data.value[0].id = $data.value[0].id.Replace('/network/', '/net & ops!%PATH% (x)/').Replace('/west', '/west & app!%PATH% (x)')
    }
    if ($env:MOCK_EFFECTIVE_MODE -eq 'oversize-v1') { $data.value[0].location = 'x' * 2100000 }
}
$data | ConvertTo-Json -Depth 20 -Compress
'@
$collector = Join-Path $repo 'src' 'collect-azure-vwan.ps1'
$wanId = '/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/network/providers/Microsoft.Network/virtualWans/wan'
if ($IsWindows) {
    $wrapper = Join-Path $output 'az.cmd'
    Set-Content -LiteralPath $wrapper -Value "@echo off`r`n`"$pwshPath`" -NoLogo -NoProfile -File `"$driver`" %*"
} else {
    $wrapper = Join-Path $output 'az'
    Set-Content -LiteralPath $wrapper -Value "#!/bin/sh`nexec '$pwshPath' -NoLogo -NoProfile -File '$driver' `"`$@`""
    & chmod +x $wrapper
}
function Assert($Condition, [string]$Message) { if (!$Condition) { throw $Message } }
$originalPath = $env:PATH
try {
    $env:PATH = "$output$([IO.Path]::PathSeparator)$originalPath"
    $env:MOCK_AZ_LOG = Join-Path $output 'requests.log'
    $env:MOCK_BASE_FIXTURE = $fixture
    $env:MOCK_EFFECTIVE_LOG = Join-Path $output 'effective-requests.log'
    $env:MOCK_METADATA_LOG = Join-Path $output 'metadata-requests.log'
    $env:MOCK_METADATA_MODE = ''
    $env:MOCK_EFFECTIVE_MODE = ''
    Set-Content -LiteralPath $env:MOCK_METADATA_LOG -Value ''
    Set-Content -LiteralPath $env:MOCK_EFFECTIVE_LOG -Value ''
    Set-Content -LiteralPath $env:MOCK_AZ_LOG -Value ''
    $configModes = if ($Suite -eq 'Metadata') { @('normal') } else { @('normal', 'static-routes', 'partial', 'cross', 'basic', 'bad-next') }
    foreach ($mode in $configModes) {
        $env:MOCK_AZ_MODE = if ($mode -eq 'cross') { 'partial' } else { $mode }
        $file = Join-Path $output "$mode.json"
        [string[]]$extra = if ($mode -eq 'cross') { @('-AllowCrossSubscriptionVnets') } else { @() }
        $result = & $pwshPath -NoLogo -NoProfile -NonInteractive -File $collector -VirtualWanId $wanId -OutputFile $file -Force @extra 2>&1 | Out-String
        $code = $LASTEXITCODE
        if ($mode -in @('basic', 'bad-next')) {
            Assert ($code -ne 0) "$mode should fail closed."
            Assert (!(Test-Path -LiteralPath $file)) "$mode must not write a misleading capture."
            Write-Host "Rejected $mode capture as expected."
            continue
        }
        Assert ($code -eq 0) "$mode collector failed: $result"
        Write-Host $result.Trim()
        $json = Get-Content -LiteralPath $file -Raw
        $capture = $json | ConvertFrom-Json
        Assert ($capture.version -eq 1 -and $capture.collectorVersion -eq '1' -and $null -eq $capture.observations) 'Default capture must remain version 1 without diagnostics.'
        Assert ($null -eq $capture.context) 'Default v1 capture must not add metadata context.'
        Assert ($capture.hubs.Count -eq 1) 'WAN filtering/pagination must ignore hubs belonging to other WANs.'
        Assert ($json -notlike '*must-not-be-exported*') 'Unexpected Azure properties must not leak into captures.'
        Assert ($capture.hubs[0].gatewayTypes[0] -eq 'VPN') 'Gateway presence must be captured.'
        Assert ($capture.hubs[0].connections[0].defaultRouting -eq ($mode -ne 'static-routes')) 'Azure-materialized defaults should be recognized without accepting real static routes.'
        Assert ($capture.hubs[0].connections[0].name -eq 'app') 'Use the actual VNet name, not the connection name.'
        if ($mode -in @('normal', 'static-routes')) {
            Assert $capture.complete 'Successful reads should yield a complete capture.'
            Assert ($capture.hubs[0].connections[0].addressPrefixes[0] -eq '10.20.0.0/16') 'VNet address space should be captured.'
        } else {
            Assert (!$capture.complete) 'Denied route-map reads must be disclosed, never silently accepted.'
            Assert ($capture.hubs[0].unsupportedFeatures -like '*could not be read*') 'Denied read must have a limitation.'
            if ($mode -eq 'partial') {
                Assert ($null -eq $capture.hubs[0].connections[1].addressPrefixes) 'Cross-subscription reads need explicit opt-in.'
                Assert ((Get-Content -LiteralPath $env:MOCK_AZ_LOG -Raw) -notlike '*/subscriptions/22222222-*') 'No cross-subscription read without opt-in.'
            } else {
                Assert ($capture.hubs[0].connections[1].addressPrefixes[0] -eq '10.20.0.0/16') 'Opt-in should read only the referenced cross-subscription VNet.'
            }
            Assert ((Get-Content -LiteralPath $env:MOCK_AZ_LOG -Raw) -notlike '*example.invalid*') 'Never follow an external pagination endpoint.'
        }
    }
    Assert ([string]::IsNullOrWhiteSpace((Get-Content -LiteralPath $env:MOCK_EFFECTIVE_LOG -Raw))) 'Default collection must never call effective routes.'
    Assert ([string]::IsNullOrWhiteSpace((Get-Content -LiteralPath $env:MOCK_METADATA_LOG -Raw))) 'Default v1 collection must never query account/version metadata.'
    $env:MOCK_AZ_MODE = 'normal'
    $effectiveModes = if ($Suite -eq 'Metadata') { @('normal', '429', 'missing-extension') } else {
        @('normal', 'denied', 'failed', 'unsupported', 'bad-json', 'bad-envelope', 'bad-row', 'bad-member', 'bad-path', 'unknown-field', 'empty', 'null-arrays', 'missing-default', 'pagination', 'table-bound', 'total-bound', 'argument-safety', 'false-security', 'null-security', '429', 'missing-extension')
    }
    foreach ($mode in $effectiveModes) {
        $env:MOCK_EFFECTIVE_MODE = $mode
        Set-Content -LiteralPath $env:MOCK_EFFECTIVE_LOG -Value ''
        $file = Join-Path $output "effective-$mode.json"
        $result = & $pwshPath -NoLogo -NoProfile -NonInteractive -File $collector -VirtualWanId $wanId -OutputFile $file -Force -IncludeEffectiveRoutes 2>&1 | Out-String
        Assert ($LASTEXITCODE -eq 0) "$mode effective collector failed: $result"
        $json = Get-Content -LiteralPath $file -Raw
        $capture = $json | ConvertFrom-Json
        $table = $capture.observations.tables[0]
        $expectedStatus = switch ($mode) {
            'denied' { 'denied' }
            { $_ -in @('failed', 'bad-json', '429') } { 'failed' }
            { $_ -in @('unsupported', 'bad-envelope', 'bad-row', 'bad-member', 'bad-path', 'unknown-field', 'missing-default', 'missing-extension') } { 'unsupported' }
            'empty' { 'empty' }
            { $_ -in @('table-bound', 'pagination') } { 'truncated' }
            default { 'complete' }
        }
        Assert ($capture.version -eq 2 -and $capture.collectorVersion -eq '2') "$mode must produce version 2."
        Assert ($capture.context.cloud -ceq 'AzureCloud' -and $capture.context.subscriptionId -ceq '11111111-1111-1111-1111-111111111111' -and $capture.context.tenantId -ceq '33333333-3333-3333-3333-333333333333' -and $capture.context.azureCliVersion -ceq '2.80.0') 'Capture only the known selected context and actual CLI version.'
        Assert ($capture.complete) "$mode observation status must not affect configuration completeness."
        Assert ($capture.observations.version -eq 1 -and $capture.observations.tables.Count -eq $capture.hubs.Count) "$mode observation contract mismatch."
        Assert ($table.status -eq $expectedStatus) "$mode status was $($table.status), expected $expectedStatus."
        Assert ($table.resourceType -eq 'RouteTable' -and $table.resourceId -ceq "$($table.hubResourceId)/hubRouteTables/defaultRouteTable") "$mode context must retain exact ARM IDs."
        Assert ($table.apiVersion -eq 'az network vhub get-effective-routes') 'Record the chosen CLI operation, not a fictional pinned REST API.'
        Assert ([DateTime]::Parse($capture.observations.startedAt) -le [DateTime]::Parse($capture.observations.completedAt)) 'Observation timestamps must be ordered.'
        Assert ([DateTime]::Parse($table.capturedAt) -le [DateTime]::Parse($capture.observations.completedAt)) 'Per-table timestamp must be present.'
        Assert ($json -notlike '*must-not-be-exported*') "$mode must sanitize CLI errors."
        $connection = $capture.hubs[0].connections[0]
        Assert ($connection.id -like '*/hubVirtualNetworkConnections/connection-to-app') 'Connection identity must be captured.'
        if ($mode -eq 'null-security') { Assert ($null -eq $connection.enableInternetSecurity) 'Absent enableInternetSecurity must stay null.' }
        else { Assert ($connection.enableInternetSecurity -eq ($mode -ne 'false-security')) 'Capture the actual internet-security flag.' }
        if ($mode -eq 'normal') {
            Assert ($table.routes.Count -eq 2) 'Preserve row association.'
            Assert ($table.routes[0].addressPrefixes.Count -eq 2 -and $table.routes[0].addressPrefixes[1] -eq '2001:db8::/32') 'Preserve multiprefix and IPv6 values.'
            Assert ($table.routes[0].nextHops.Count -eq 2 -and $table.routes[0].nextHops[1] -eq '/arbitrary/second') 'Preserve ECMP next hops.'
            Assert ($table.routes[0].nextHopType -eq 'Unknown future type' -and $table.routes[0].asPath -ceq '') 'Preserve unknown next-hop types and normalize null AS path.'
            Assert ($table.routes[1].asPath -ceq '65000 65000 65520') 'Preserve raw AS paths including repetitions.'
        }
        if ($mode -eq 'null-arrays') {
            Assert ($table.routes[0].addressPrefixes -is [array] -and $table.routes[0].addressPrefixes.Count -eq 0 -and $table.routes[0].nextHops -is [array] -and $table.routes[0].nextHops.Count -eq 0) 'Null arrays must normalize to empty arrays, not null.'
        }
        if ($expectedStatus -in @('denied', 'failed', 'unsupported', 'empty')) { Assert ($table.routes -is [array] -and $table.routes.Count -eq 0) "$mode must not invent routes." }
        if ($expectedStatus -in @('denied', 'failed', 'unsupported', 'truncated')) { Assert ($table.warnings.Count -gt 0) "$mode requires a safe warning." }
        if ($mode -eq 'denied') { Assert ($table.warnings[0] -like '*Microsoft.Network/virtualHubs/effectiveRoutes/action*Reader alone*') 'Explain diagnostic-action RBAC, not Reader alone.' }
        if ($mode -eq 'table-bound') { Assert ($table.routes.Count -eq 10000) 'Enforce per-table row bound with explicit truncation.' }
        if ($mode -eq 'total-bound') {
            Assert (@($capture.observations.tables | ForEach-Object { $_.routes }).Count -eq 20000) 'Enforce total row bound.'
            Assert ($capture.observations.tables[2].status -eq 'truncated' -and $capture.observations.tables[2].routes.Count -eq 0) 'Exhausted total budget must never look empty/complete.'
        }
        $calls = @(Get-Content -LiteralPath $env:MOCK_EFFECTIVE_LOG | Where-Object { $_ } | ForEach-Object { ,($_ | ConvertFrom-Json) })
        Assert ($calls.Count -eq $(if ($mode -eq 'missing-default') { 0 } else { $capture.hubs.Count })) "$mode must query only discovered selected-WAN Default tables, once each."
        foreach ($call in $calls) {
            Assert (($call[0..2] -join ' ') -eq 'network vhub get-effective-routes' -and $call -notcontains '--no-wait') 'Use only the supported async-waiting CLI command.'
            Assert ($call[[Array]::IndexOf($call, '--resource-type') + 1] -ceq 'RouteTable') 'Explicit resource type is mandatory.'
            $id = $call[[Array]::IndexOf($call, '--resource-id') + 1]
            Assert ($id -like '*/hubRouteTables/defaultRouteTable') 'Only Default tables may be queried.'
            Assert ($call[[Array]::IndexOf($call, '--subscription') + 1] -eq '11111111-1111-1111-1111-111111111111') 'Explicit subscription scope is mandatory.'
            Assert ($call[[Array]::IndexOf($call, '--output') + 1] -eq 'json' -and $call -contains '--only-show-errors') 'Use ordinary JSON output, not debug headers.'
            Assert ($call[[Array]::IndexOf($call, '--name') + 1] -ceq ($id -split '/')[-3]) 'Hub scope must come from ARM ID, not display name.'
            Assert ($call[[Array]::IndexOf($call, '--resource-group') + 1] -ceq ($id -split '/')[4]) 'Explicit resource group scope is mandatory.'
            if ($mode -eq 'argument-safety') {
                Assert ($call[[Array]::IndexOf($call, '--name') + 1] -ceq 'west & app!%PATH% (x)') 'Shell metacharacters must survive as a single literal argument.'
            }
        }
        Write-Host "Verified effective routes: $mode."
    }
    $sizeModes = if ($Suite -eq 'Metadata') { @() } else { @('oversize-v1', 'oversize-v2') }
    foreach ($mode in $sizeModes) {
        $env:MOCK_EFFECTIVE_MODE = $mode
        $file = Join-Path $output "$mode.json"
        Set-Content -LiteralPath $file -Value 'preserve existing file' -NoNewline
        $extra = if ($mode -eq 'oversize-v2') { @('-IncludeEffectiveRoutes') } else { @() }
        $result = & $pwshPath -NoLogo -NoProfile -NonInteractive -File $collector -VirtualWanId $wanId -OutputFile $file -Force @extra 2>&1 | Out-String
        Assert ($LASTEXITCODE -ne 0 -and $result -like '*Capture exceeds the app limit*') "$mode must fail before writing: $result"
        Assert ((Get-Content -LiteralPath $file -Raw) -ceq 'preserve existing file') "$mode must not partially overwrite the existing file."
    }
    $env:MOCK_EFFECTIVE_MODE = 'normal'
    foreach ($mode in @('known', 'failure', 'version-failure', 'invalid', 'missing-fields', 'wrong-shape', 'null-tenant', 'wrong-subscription', 'wrong-cloud')) {
        $env:MOCK_METADATA_MODE = $mode
        Set-Content -LiteralPath $env:MOCK_METADATA_LOG -Value ''
        Set-Content -LiteralPath $env:MOCK_AZ_LOG -Value ''
        Set-Content -LiteralPath $env:MOCK_EFFECTIVE_LOG -Value ''
        $file = Join-Path $output "metadata-$mode.json"
        Set-Content -LiteralPath $file -Value 'preserve existing file' -NoNewline
        $result = & $pwshPath -NoLogo -NoProfile -NonInteractive -File $collector -VirtualWanId $wanId -OutputFile $file -Force -IncludeEffectiveRoutes 2>&1 | Out-String
        $code = $LASTEXITCODE
        Assert ($result -notlike '*must-not-be-exported*') "$mode must not display raw metadata or CLI errors."
        $calls = @(Get-Content -LiteralPath $env:MOCK_METADATA_LOG | Where-Object { $_ } | ForEach-Object { ,($_ | ConvertFrom-Json) })
        Assert ($calls.Count -eq 2) 'Metadata collection must be bounded to one version and one account call, without retries.'
        Assert (($calls[0] -join ' ') -ceq 'version --output json --only-show-errors') 'Only obtain the version JSON, not debug logs.'
        Assert (($calls[1] -join ' ') -ceq "account show --subscription 11111111-1111-1111-1111-111111111111 --query {subscriptionId:id,tenantId:tenantId,cloud:environmentName} --output json --only-show-errors") 'Select only non-personal account fields and the selected subscription.'
        if ($mode -in @('wrong-subscription', 'wrong-cloud')) {
            Assert ($code -ne 0 -and $result -like '*does not match*') "$mode must reject a known scope mismatch."
            Assert ((Get-Content -LiteralPath $file -Raw) -ceq 'preserve existing file') "$mode must preserve an existing file."
            Assert ([string]::IsNullOrWhiteSpace((Get-Content -LiteralPath $env:MOCK_AZ_LOG -Raw))) "$mode must stop before any resource reads."
            Assert ([string]::IsNullOrWhiteSpace((Get-Content -LiteralPath $env:MOCK_EFFECTIVE_LOG -Raw))) "$mode must stop before diagnostics."
        } else {
            Assert ($code -eq 0) "$mode metadata collector failed: $result"
            $json = Get-Content -LiteralPath $file -Raw
            $capture = $json | ConvertFrom-Json
            Assert ((($capture.context.PSObject.Properties.Name | Sort-Object) -join ',') -ceq 'azureCliVersion,cloud,subscriptionId,tenantId') 'Metadata context must have exactly the agreed four fields.'
            Assert ($capture.context.cloud -ceq 'AzureCloud' -and $capture.context.subscriptionId -ceq '11111111-1111-1111-1111-111111111111') 'Retain the requested public-Azure scope.'
            Assert ($capture.complete) 'Missing optional metadata must not change structural completeness.'
            Assert ($json -notlike '*must-not-be-exported*') "$mode must project only validated metadata."
            $knownTenant = $mode -in @('known', 'version-failure')
            $knownVersion = $mode -notin @('failure', 'version-failure', 'invalid')
            if ($knownTenant) {
                Assert ($capture.context.tenantId -ceq '33333333-3333-3333-3333-333333333333' -and $result -like '*Tenant: 33333333-3333-3333-3333-333333333333*') 'Display only the verified selected tenant ID.'
            } else {
                Assert ($null -eq $capture.context.tenantId -and @($capture.warnings | Where-Object { $_ -like '*tenantId is null*' }).Count -eq 1) 'Unknown tenant/scope must be nullable with one explicit warning.'
                Assert ($result -like '*Tenant: unknown*') 'Display unknown metadata explicitly.'
            }
            if ($knownVersion) { Assert ($capture.context.azureCliVersion -ceq '2.80.0') 'Capture the actual azure-cli version only.' }
            else { Assert ($null -eq $capture.context.azureCliVersion -and @($capture.warnings | Where-Object { $_ -like '*azureCliVersion is null*' }).Count -eq 1) 'Unknown/invalid CLI version must be nullable with one explicit warning.' }
            Assert ($result -like '*subscription: 11111111-1111-1111-1111-111111111111*') 'Show selected subscription locally without account PII.'
            if ($mode -eq 'known') { Assert ($capture.warnings.Count -eq 0) 'Verified known metadata needs no warning.' }
            if ($mode -in @('failure', 'missing-fields')) {
                Assert ($capture.hubs.Count -eq 1 -and $capture.observations.tables[0].status -eq 'unsupported' -and $capture.observations.tables[0].routes.Count -eq 0) 'Unverified account cloud/scope must preserve configuration but make route sections unavailable.'
                Assert ($capture.observations.tables[0].warnings[0] -like '*did not confirm AzureCloud*') 'Unverified route scope needs an explicit safe warning.'
                Assert ([string]::IsNullOrWhiteSpace((Get-Content -LiteralPath $env:MOCK_EFFECTIVE_LOG -Raw))) 'Never execute effective-route actions when account cloud/subscription cannot be confirmed.'
            }
        }
        Write-Host "Verified metadata: $mode."
    }
    $env:MOCK_EFFECTIVE_MODE = 'timeout'
    $env:MOCK_METADATA_MODE = ''
    $tokens = $null
    $parseErrors = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile($collector, [ref]$tokens, [ref]$parseErrors)
    $invokeFunction = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Invoke-CaptureAz' }, $true)
    . ([scriptblock]::Create($invokeFunction.Extent.Text))
    $azPath = $wrapper
    $script:requests = 0
    $script:clock = [Diagnostics.Stopwatch]::StartNew()
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $timeoutMessage = ''
    try { $null = Invoke-CaptureAz @('network', 'vhub', 'get-effective-routes') 3 }
    catch { $timeoutMessage = $_.Exception.Message }
    Assert ($timeoutMessage -ceq 'CLI operation timed out.' -and $watch.Elapsed.TotalSeconds -lt 15) 'The real subprocess helper must terminate a hanging CLI at the configured deadline without exporting errors.'
    Write-Host "Collector $Suite integration checks passed, including metadata scope/privacy, 429, missing extension and bounded subprocess timeout."
} finally {
    $env:PATH = $originalPath
    Remove-Item Env:MOCK_AZ_MODE, Env:MOCK_AZ_LOG, Env:MOCK_BASE_FIXTURE, Env:MOCK_EFFECTIVE_MODE, Env:MOCK_EFFECTIVE_LOG, Env:MOCK_METADATA_MODE, Env:MOCK_METADATA_LOG -ErrorAction SilentlyContinue
}
