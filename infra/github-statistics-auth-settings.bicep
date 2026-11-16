@description('Existing statistics Function app.')
param functionAppName string

@description('Current protected settings, evaluated by the parent before updating this resource.')
@secure()
param currentSettings object

@description('Dashboard tenant.')
param tenantId string

@description('Approved dashboard user object IDs.')
param allowedUserObjectIds array

@description('Existing Function runtime identity client ID.')
param runtimeClientId string

resource functionApp 'Microsoft.Web/sites@2024-11-01' existing = {
  name: functionAppName
}

resource settings 'Microsoft.Web/sites/config@2024-11-01' = {
  parent: functionApp
  name: 'appsettings'
  properties: union(currentSettings, {
    AZURE_STATS_DASHBOARD_TENANT_ID: tenantId
    AZURE_STATS_DASHBOARD_ALLOWED_OBJECT_IDS: join(allowedUserObjectIds, ',')
    OVERRIDE_USE_MI_FIC_ASSERTION_CLIENTID: runtimeClientId
  })
}
