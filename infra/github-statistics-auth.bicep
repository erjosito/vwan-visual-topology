@description('Existing statistics Function app. No hosting resources are created.')
param functionAppName string = 'func-netstats-${uniqueString(resourceGroup().id)}'

@description('Dedicated single-tenant dashboard application client ID.')
param dashboardClientId string

@description('Tenant containing the dashboard registration and approved users.')
param tenantId string = subscription().tenantId

@description('Approved user object IDs in this tenant. Keep these out of public parameter files.')
@minLength(1)
@maxLength(13)
param allowedUserObjectIds array

@description('Client ID of the existing Function user-assigned runtime identity.')
param runtimeClientId string

resource functionApp 'Microsoft.Web/sites@2024-11-01' existing = {
  name: functionAppName
}

// Reading settings outside the child deployment avoids a list/update dependency cycle.
module settings './github-statistics-auth-settings.bicep' = {
  name: 'statistics-dashboard-settings'
  params: {
    functionAppName: functionApp.name
    currentSettings: list('${functionApp.id}/config/appsettings', '2024-11-01').properties
    tenantId: tenantId
    allowedUserObjectIds: allowedUserObjectIds
    runtimeClientId: runtimeClientId
  }
}

resource authentication 'Microsoft.Web/sites/config@2024-11-01' = {
  parent: functionApp
  name: 'authsettingsV2'
  properties: {
    platform: {
      enabled: true
    }
    globalValidation: {
      requireAuthentication: true
      unauthenticatedClientAction: 'RedirectToLoginPage'
      redirectToProvider: 'azureactivedirectory'
      excludedPaths: ['/api/statistics/collect']
    }
    identityProviders: {
      azureActiveDirectory: {
        enabled: true
        registration: {
          clientId: dashboardClientId
          openIdIssuer: '${environment().authentication.loginEndpoint}${tenantId}/v2.0'
          clientSecretSettingName: 'OVERRIDE_USE_MI_FIC_ASSERTION_CLIENTID'
        }
        login: {
          loginParameters: ['scope=openid profile']
        }
        validation: {
          allowedAudiences: [dashboardClientId, 'api://${dashboardClientId}']
          defaultAuthorizationPolicy: {
            allowedPrincipals: {
              identities: allowedUserObjectIds
            }
          }
        }
      }
    }
    login: {
      tokenStore: {
        enabled: false
      }
    }
    httpSettings: {
      requireHttps: true
    }
  }
  dependsOn: [settings]
}

output dashboardUrl string = 'https://${functionApp.properties.defaultHostName}/api/statistics'
