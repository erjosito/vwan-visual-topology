@description('Existing statistics Function app with siteScopedCertificatesEnabled.')
param functionAppName string = 'func-netstats-${uniqueString(resourceGroup().id)}'

@description('Verified custom hostname, already CNAME-bound to this Function.')
param hostname string = 'telemetry.aznet-simulator.com'

@description('Site-scoped free App Service managed certificate name.')
param certificateName string = 'telemetry-managed'

@description('Region of the existing Function app.')
param location string = resourceGroup().location

resource functionApp 'Microsoft.Web/sites@2024-11-01' existing = {
  name: functionAppName
}

resource certificate 'Microsoft.Web/sites/certificates@2024-11-01' = {
  parent: functionApp
  name: certificateName
  location: location
  properties: {
    canonicalName: hostname
    hostNames: [hostname]
    serverFarmId: functionApp.properties.serverFarmId
  }
}
