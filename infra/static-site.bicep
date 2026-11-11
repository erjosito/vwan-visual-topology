@description('Static Web App resource name from the deployment plan.')
param name string

@description('Supported Azure Static Web Apps region.')
param location string

@description('Resource tracking tags.')
param tags object

resource staticSite 'Microsoft.Web/staticSites@2025-05-01' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: 'Standard'
    tier: 'Standard'
  }
  properties: {}
}

output resourceId string = staticSite.id
output url string = 'https://${staticSite.properties.defaultHostname}'
