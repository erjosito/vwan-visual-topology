#requires -Version 7.0
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot
$output = Join-Path $repo 'test-artifacts' 'azure-files' 'collector'
$null = New-Item -ItemType Directory -Force -Path $output
$pwshPath = (Get-Process -Id $PID).Path
$fixture = Join-Path $PSScriptRoot 'fixtures' 'az.ps1'
$collector = Join-Path $repo 'src' 'collect-azure-vwan.ps1'
$wanId = '/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/network/providers/Microsoft.Network/virtualWans/wan'
if ($IsWindows) {
    $wrapper = Join-Path $output 'az.cmd'
    Set-Content -LiteralPath $wrapper -Value "@echo off`r`n`"$pwshPath`" -NoLogo -NoProfile -File `"$fixture`" %*"
} else {
    $wrapper = Join-Path $output 'az'
    Set-Content -LiteralPath $wrapper -Value "#!/bin/sh`nexec '$pwshPath' -NoLogo -NoProfile -File '$fixture' `"`$@`""
    & chmod +x $wrapper
}
function Assert($Condition, [string]$Message) { if (!$Condition) { throw $Message } }
$originalPath = $env:PATH
try {
    $env:PATH = "$output$([IO.Path]::PathSeparator)$originalPath"
    $env:MOCK_AZ_LOG = Join-Path $output 'requests.log'
    Set-Content -LiteralPath $env:MOCK_AZ_LOG -Value ''
    foreach ($mode in @('normal', 'static-routes', 'partial', 'cross', 'basic', 'bad-next')) {
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
    Write-Host 'Collector integration checks passed: pagination, WAN filtering, allowlisting, default routing, denied reads, cross-subscription opt-in and fail-closed errors.'
} finally {
    $env:PATH = $originalPath
    Remove-Item Env:MOCK_AZ_MODE, Env:MOCK_AZ_LOG -ErrorAction SilentlyContinue
}
