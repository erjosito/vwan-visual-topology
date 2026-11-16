#requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('accounts','targets','collect')][string]$Operation,
    [string]$SubscriptionId,
    [string]$TenantId,
    [ValidateSet('vwan','hub-spoke','full')][string]$Mode = 'vwan',
    [string]$Target,
    [string]$OutputFile,
    [string]$CollectorRoot
)
$ErrorActionPreference = 'Stop'
$env:AZURE_EXTENSION_USE_DYNAMIC_INSTALL = 'no'
$env:AZURE_CORE_COLLECT_TELEMETRY = 'no'
$env:AZURE_LOGGING_ENABLE_LOG_FILE = 'no'
$null = Get-Command az -ErrorAction Stop
function Read-Az([string[]]$Arguments) {
    $raw = & az @Arguments --only-show-errors --output json 2>$null
    if ($LASTEXITCODE -ne 0 -or !$raw) { throw 'Azure CLI read failed: check your existing session, selected scope and read permissions. No login or resource change was attempted.' }
    $raw | ConvertFrom-Json -Depth 100
}
if ($Operation -eq 'accounts') {
    $cloud = Read-Az @('cloud','show','--query','{name:name,resourceManager:endpoints.resourceManager}')
    $accounts = @(Read-Az @('account','list','--query','[].{id:id,name:name,tenantId:tenantId,state:state}'))
    @{cloud=$cloud; accounts=$accounts} | ConvertTo-Json -Depth 10 -Compress
    exit
}
if ($SubscriptionId -notmatch '^[a-fA-F0-9-]{36}$' -or $TenantId -notmatch '^[a-fA-F0-9-]{36}$') { throw 'Explicit subscription and tenant required.' }
$account = Read-Az @('account','show','--subscription',$SubscriptionId,'--query','{id:id,tenantId:tenantId,environmentName:environmentName}')
if ($account.id -ine $SubscriptionId -or $account.tenantId -ine $TenantId -or $account.environmentName -ne 'AzureCloud') {
    throw 'Scope mismatch or unsupported cloud. The initial desktop collector supports public Azure only.'
}
if ($Operation -eq 'targets') {
    $groups = @(Read-Az @('group','list','--subscription',$SubscriptionId,'--query','[].{name:name,id:id}'))
    $wans = @(Read-Az @('network','vwan','list','--subscription',$SubscriptionId,'--query','[].{name:name,id:id}'))
    @{groups=$groups; wans=$wans} | ConvertTo-Json -Depth 10 -Compress
    exit
}
if (!$OutputFile -or !$CollectorRoot) { throw 'Internal output/collector paths required.' }
if ($Mode -eq 'vwan') {
    if ($Target -notmatch "^/subscriptions/$SubscriptionId/resourceGroups/[^/?#`r`n]+/providers/Microsoft.Network/virtualWans/[^/?#`r`n]+$") { throw 'Selected WAN must belong to the selected subscription.' }
    & (Join-Path $CollectorRoot 'collect-azure-vwan.ps1') -VirtualWanId $Target -OutputFile $OutputFile 6>$null | Out-Null
} else {
    if ($Target -notmatch '^[a-zA-Z0-9_.() -]{1,90}$') { throw 'Invalid resource-group name.' }
    & (Join-Path $CollectorRoot 'collect-azure-network.ps1') -ResourceGroupName $Target -SubscriptionId $SubscriptionId -OutputFile $OutputFile 6>$null | Out-Null
}
if (!(Test-Path -LiteralPath $OutputFile)) { throw 'Collector did not produce a capture.' }
'{"captured":true}'
