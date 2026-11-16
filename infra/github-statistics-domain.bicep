@description('Existing statistics Function app.')
param functionAppName string = 'func-netstats-${uniqueString(resourceGroup().id)}'

@description('Dashboard hostname.')
param hostname string = 'telemetry.aznet-simulator.com'

@description('Use bootstrap only for the initial unbound hostname, before requesting its managed certificate.')
@allowed(['bootstrap', 'tls'])
param mode string = 'tls'

@description('Site-scoped managed certificate created after the initial hostname binding.')
param certificateName string = 'telemetry-managed'

resource functionApp 'Microsoft.Web/sites@2024-11-01' existing = {
  name: functionAppName
}

resource certificate 'Microsoft.Web/sites/certificates@2024-11-01' existing = {
  parent: functionApp
  name: certificateName
}

resource binding 'Microsoft.Web/sites/hostNameBindings@2024-11-01' = {
  parent: functionApp
  name: hostname
  properties: union({
    hostNameType: 'Verified'
  }, mode == 'tls' ? {
    sslState: 'SniEnabled'
    thumbprint: certificate.properties.thumbprint
  } : {
    sslState: 'Disabled'
  })
}

output dashboardUrl string = 'https://${hostname}'
