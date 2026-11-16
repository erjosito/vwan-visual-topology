@description('Region shared by the Flex plan, VNet and Storage account.')
param location string

@description('Existing dedicated statistics Storage account.')
param storageAccountName string

@description('Existing GitHub deployment identity principal ID.')
param automationPrincipalId string

@description('Resource tracking tags.')
param tags object

var appName = 'func-netstats-${uniqueString(resourceGroup().id)}'
var deploymentContainerName = 'function-deployments'

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}

resource blobs 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' existing = {
  parent: storage
  name: 'default'
}

resource deployments 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobs
  name: deploymentContainerName
  properties: {
    publicAccess: 'None'
  }
}

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-github-statistics-function'
  location: location
  tags: tags
}

resource hostStorageRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, identity.id, 'function-host-blob-owner')
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b')
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource network 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: 'vnet-github-statistics'
  location: location
  tags: tags
  properties: {
    addressSpace: {
      addressPrefixes: ['10.247.68.0/24']
    }
    subnets: [
      {
        name: 'functions'
        properties: {
          addressPrefix: '10.247.68.0/26'
          delegations: [
            {
              name: 'flex-consumption'
              properties: {
                serviceName: 'Microsoft.App/environments'
              }
            }
          ]
        }
      }
      {
        name: 'private-endpoints'
        properties: {
          addressPrefix: '10.247.68.64/26'
          privateEndpointNetworkPolicies: 'Disabled'
        }
      }
    ]
  }
}

resource dns 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: 'privatelink.blob.${environment().suffixes.storage}'
  location: 'global'
  tags: tags
}

resource dnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  parent: dns
  name: 'statistics-vnet'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: network.id
    }
  }
}

resource endpoint 'Microsoft.Network/privateEndpoints@2024-05-01' = {
  name: 'pe-github-statistics-blob'
  location: location
  tags: tags
  properties: {
    subnet: {
      id: '${network.id}/subnets/private-endpoints'
    }
    privateLinkServiceConnections: [
      {
        name: 'statistics-blob'
        properties: {
          privateLinkServiceId: storage.id
          groupIds: ['blob']
        }
      }
    ]
  }
}

resource endpointDns 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-05-01' = {
  parent: endpoint
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'blob'
        properties: {
          privateDnsZoneId: dns.id
        }
      }
    ]
  }
}

resource plan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: 'asp-github-statistics-flex'
  location: location
  tags: tags
  kind: 'functionapp'
  sku: {
    name: 'FC1'
    tier: 'FlexConsumption'
  }
  properties: {
    reserved: true
  }
}

resource functionApp 'Microsoft.Web/sites@2024-04-01' = {
  name: appName
  location: location
  tags: tags
  kind: 'functionapp,linux'
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identity.id}': {}
    }
  }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    publicNetworkAccess: 'Enabled'
    virtualNetworkSubnetId: '${network.id}/subnets/functions'
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${storage.properties.primaryEndpoints.blob}${deployments.name}'
          authentication: {
            type: 'UserAssignedIdentity'
            userAssignedIdentityResourceId: identity.id
          }
        }
      }
      runtime: {
        name: 'node'
        version: '22'
      }
      scaleAndConcurrency: {
        instanceMemoryMB: 512
        maximumInstanceCount: 40
      }
    }
    siteConfig: {
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      appSettings: [
        { name: 'AzureWebJobsStorage__accountName', value: storage.name }
        { name: 'AzureWebJobsStorage__credential', value: 'managedidentity' }
        { name: 'AzureWebJobsStorage__clientId', value: identity.properties.clientId }
        { name: 'AZURE_STATS_RUNTIME_CLIENT_ID', value: identity.properties.clientId }
        { name: 'AZURE_STATS_STORAGE_ACCOUNT', value: storage.name }
        { name: 'GITHUB_STATS_REPOSITORY', value: 'erjosito/vwan-visual-topology' }
      ]
    }
  }
  dependsOn: [
    hostStorageRole
    endpointDns
    dnsLink
  ]
}

resource deploymentRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(functionApp.id, 'github-statistics-website-contributor')
  scope: functionApp
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'de139f84-1756-47ae-9be6-808fbbe84772')
    principalId: automationPrincipalId
    principalType: 'ServicePrincipal'
  }
}

output functionAppName string = functionApp.name
output functionAppId string = functionApp.id
output runtimeClientId string = identity.properties.clientId
output functionUrl string = 'https://${functionApp.properties.defaultHostName}'
