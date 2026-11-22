const knownLocations: Record<string, string> = {
  'West Europe': 'westeurope', 'North Europe': 'northeurope', 'East US': 'eastus', 'East US 2': 'eastus2',
  'West US': 'westus', 'West US 2': 'westus2', 'West US 3': 'westus3', 'Central US': 'centralus',
  'South Central US': 'southcentralus', 'North Central US': 'northcentralus', 'UK South': 'uksouth', 'UK West': 'ukwest',
  'France Central': 'francecentral', 'Germany West Central': 'germanywestcentral', 'Sweden Central': 'swedencentral',
  'Switzerland North': 'switzerlandnorth', 'Canada Central': 'canadacentral', 'Australia East': 'australiaeast',
  'Southeast Asia': 'southeastasia', 'East Asia': 'eastasia', 'Japan East': 'japaneast', 'Central India': 'centralindia',
  'South Africa North': 'southafricanorth', 'Brazil South': 'brazilsouth', 'UAE North': 'uaenorth',
}

export const canonicalLocation = (value: string) => knownLocations[value] ?? (/^[a-z][a-z0-9]{1,39}$/.test(value) ? value : '')
