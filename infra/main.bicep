targetScope = 'subscription'

@description('Azure region for the resource group and Static Web App.')
param location string = 'westeurope'

@description('Resource group name; set explicitly to avoid modifying unrelated resources.')
param resourceGroupName string = 'rg-vwan-visual-topology-dev-426b'

@description('Static Web App resource name.')
param staticWebAppName string = 'swa-vwan-visual-topology-dev-426b'

@description('Environment identifier used for resource tags.')
param environmentName string = 'vwan-visual-topology-dev-426b'

@description('Deployment tracking identifier.')
param sessionId string

@description('Operator or automation identity recorded in resource tags.')
param deployedBy string

@description('Creation timestamp recorded in resource tags.')
param createdAt string = utcNow('o')

var tags = {
  'app-onboard-skill': 'true'
  'app-onboard-session-id': sessionId
  'created-at': createdAt
  environment: environmentName
  'deployed-by': deployedBy
}

resource resourceGroup 'Microsoft.Resources/resourceGroups@2023-07-01' = {
  name: resourceGroupName
  location: location
  tags: tags
}

module staticSite './static-site.bicep' = {
  name: 'static-web-app'
  scope: resourceGroup
  params: {
    name: staticWebAppName
    location: location
    tags: tags
  }
}

output resourceGroupId string = resourceGroup.id
output staticWebAppId string = staticSite.outputs.resourceId
output appUrl string = staticSite.outputs.url
