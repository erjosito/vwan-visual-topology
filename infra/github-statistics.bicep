targetScope = 'subscription'

@description('Region for the dedicated statistics resources.')
param location string = 'westeurope'

@description('Dedicated resource group; independent of the application hosting resources.')
param resourceGroupName string = 'rg-network-simulator-statistics'

@description('Globally unique storage account name, containing only lowercase letters and digits.')
@minLength(3)
@maxLength(24)
param storageAccountName string = 'stnetstats${uniqueString(subscription().id, resourceGroupName)}'

@description('Exact GitHub environment OIDC subject, including immutable owner/repository IDs when enabled.')
param githubOidcSubject string = 'repo:erjosito@9462396/vwan-visual-topology@1437213205:environment:github-statistics'

var tags = {
  project: 'vwan-visual-topology'
  purpose: 'github-statistics'
}

resource resourceGroup 'Microsoft.Resources/resourceGroups@2023-07-01' = {
  name: resourceGroupName
  location: location
  tags: tags
}

module storage './github-statistics-storage.bicep' = {
  name: 'github-statistics-storage'
  scope: resourceGroup
  params: {
    location: location
    storageAccountName: storageAccountName
    githubOidcSubject: githubOidcSubject
    tags: tags
  }
}

module collector './github-statistics-function.bicep' = {
  name: 'github-statistics-function'
  scope: resourceGroup
  params: {
    location: location
    storageAccountName: storage.outputs.storageAccount
    automationPrincipalId: storage.outputs.automationPrincipalId
    tags: tags
  }
}

output resourceGroupId string = resourceGroup.id
output storageAccount string = storage.outputs.storageAccount
output container string = storage.outputs.container
output clientId string = storage.outputs.clientId
output tenantId string = tenant().tenantId
output functionAppName string = collector.outputs.functionAppName
output functionAppId string = collector.outputs.functionAppId
output functionUrl string = collector.outputs.functionUrl
output runtimeClientId string = collector.outputs.runtimeClientId
output subscriptionId string = subscription().subscriptionId
