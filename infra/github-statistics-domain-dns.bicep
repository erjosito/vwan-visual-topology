@description('Existing App Service domain DNS zone. Deploy in its resource group.')
param zoneName string = 'aznet-simulator.com'

@description('New dashboard subdomain. Existing application records are not modified.')
param subdomain string = 'telemetry'

@description('Default hostname of the existing Function app.')
param functionDefaultHostname string

@description('Function customDomainVerificationId, published as the ownership-verification TXT record.')
param verificationId string

resource zone 'Microsoft.Network/dnsZones@2018-05-01' existing = {
  name: zoneName
}

resource cname 'Microsoft.Network/dnsZones/CNAME@2018-05-01' = {
  parent: zone
  name: subdomain
  properties: {
    TTL: 300
    CNAMERecord: {
      cname: functionDefaultHostname
    }
  }
}

resource verification 'Microsoft.Network/dnsZones/TXT@2018-05-01' = {
  parent: zone
  name: 'asuid.${subdomain}'
  properties: {
    TTL: 300
    TXTRecords: [{ value: [verificationId] }]
  }
}
