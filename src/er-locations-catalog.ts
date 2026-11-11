// Auto-generated from official Microsoft Learn ExpressRoute Locations & Providers documentation:
// https://learn.microsoft.com/en-us/azure/expressroute/expressroute-locations-providers

export type ErCloudEnvironment = 'Commercial' | 'US Government' | 'China'
export type ErCircuitSku = 'Local' | 'Standard' | 'Premium'

export interface ErPeeringLocationEntry {
  id: string
  name: string
  peeringLocation: string
  environment: ErCloudEnvironment
  geopoliticalRegion: string
  facility: string
  facilityUrl: string | null
  zone: string
  localAzureRegions: string[]
  erDirectSupported: boolean
  providers: string[]
  exchangeProviders: string[]
  additionalProviders: string[]
  isMetro: boolean
  metroEdgeSites: [string, string] | null
}

export const ER_GEOPOLITICAL_AZURE_REGIONS: Record<string, string[]> = {
  "North America": [
    "East US",
    "West US",
    "East US 2",
    "West US 2",
    "West US 3",
    "Central US",
    "South Central US",
    "North Central US",
    "West Central US",
    "Canada Central",
    "Canada East",
    "Mexico Central"
  ],
  "South America": [
    "Brazil South"
  ],
  "Europe": [
    "Austria East",
    "Belgium Central",
    "Denmark East",
    "France Central",
    "France South",
    "Germany North",
    "Germany West Central",
    "Italy North",
    "North Europe",
    "Norway East",
    "Norway West",
    "Poland Central",
    "Spain Central",
    "Sweden Central",
    "Switzerland North",
    "Switzerland West",
    "UK West",
    "UK South",
    "West Europe"
  ],
  "South Africa": [
    "South Africa West",
    "South Africa North"
  ],
  "Asia": [
    "East Asia",
    "Malaysia West",
    "Southeast Asia",
    "Taiwan North"
  ],
  "India": [
    "India West",
    "India Central",
    "India South"
  ],
  "Israel": [
    "Israel Central"
  ],
  "Japan": [
    "Japan West",
    "Japan East"
  ],
  "South Korea": [
    "Korea Central",
    "Korea South"
  ],
  "Qatar": [
    "Qatar Central"
  ],
  "UAE": [
    "UAE Central",
    "UAE North"
  ],
  "Australia Government": [
    "Australia Central",
    "Australia Central 2"
  ],
  "Oceania": [
    "Australia East",
    "Australia Southeast",
    "New Zealand North"
  ],
  "US Government cloud": [
    "US Gov Arizona",
    "US Gov Texas",
    "US Gov Virginia",
    "US DoD Central",
    "US DoD East"
  ],
  "China East": [
    "China East",
    "China East 2"
  ],
  "China North": [
    "China North",
    "China North 2",
    "China North 3"
  ],
  "Middle East & Africa": [
    "Saudi Arabia East",
    "UAE Central",
    "UAE North",
    "Qatar Central",
    "Israel Central",
    "South Africa North",
    "South Africa West"
  ]
}

export const ER_PEERING_LOCATIONS_CATALOG: ErPeeringLocationEntry[] = [
  {
    "id": "abu-dhabi",
    "name": "Abu Dhabi",
    "peeringLocation": "Abu Dhabi",
    "environment": "Commercial",
    "geopoliticalRegion": "UAE",
    "facility": "Etisalat KDC",
    "facilityUrl": null,
    "zone": "3",
    "localAzureRegions": [
      "UAE Central"
    ],
    "erDirectSupported": true,
    "providers": [
      "Etisalat UAE"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "amsterdam",
    "name": "Amsterdam",
    "peeringLocation": "Amsterdam",
    "environment": "Commercial",
    "geopoliticalRegion": "Europe",
    "facility": "Equinix AM5",
    "facilityUrl": "https://www.equinix.com/locations/europe-colocation/netherlands-colocation/amsterdam-data-centers/am5/",
    "zone": "1",
    "localAzureRegions": [
      "West Europe"
    ],
    "erDirectSupported": true,
    "providers": [
      "1-IX.EU",
      "Aryaka Networks",
      "AT&T NetBond",
      "British Telecom",
      "Cogent",
      "Colt",
      "China Unicom Global",
      "DE-CIX",
      "Deutsche Telekom AG",
      "Equinix",
      "euNetworks",
      "GÉANT",
      "GlobalConnect",
      "InterCloud",
      "Interxion (Digital Realty)",
      "KPN",
      "IX Reach",
      "Lumen (Level 3 Communications)",
      "Megaport",
      "NTT DOCOMO BUSINESS",
      "Orange",
      "Tata Communications",
      "Telecom Italia Sparkle",
      "Telefonica",
      "Telenor",
      "Arelion (Telia Carrier)",
      "Verizon",
      "Zayo"
    ],
    "exchangeProviders": [
      "Equinix",
      "Interxion (Digital Realty)",
      "Lumen (Level 3 Communications)"
    ],
    "additionalProviders": [
      "BICS",
      "CloudXpress",
      "Eurofiber",
      "Fastweb S.p.A",
      "Gulf Bridge International",
      "Kalaam Telecom Bahrain B.S.C",
      "MainOne",
      "Nianet",
      "POST Telecom Luxembourg",
      "Proximus",
      "RETN",
      "TDC Erhverv",
      "Telecom Italia Sparkle",
      "Telekom Deutschland GmbH",
      "Telia"
    ],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "amsterdam2",
    "name": "Amsterdam2",
    "peeringLocation": "Amsterdam2",
    "environment": "Commercial",
    "geopoliticalRegion": "Europe",
    "facility": "Digital Realty(Interxion) AMS8",
    "facilityUrl": "https://www.digitalrealty.com/data-centers/emea/amsterdam/ams8",
    "zone": "1",
    "localAzureRegions": [
      "West Europe"
    ],
    "erDirectSupported": true,
    "providers": [
      "BICS",
      "British Telecom",
      "Lumen (CenturyLink Cloud Connect)",
      "Cinia",
      "Colt",
      "DE-CIX",
      "Digital Realty",
      "Equinix",
      "euNetworks",
      "GÉANT",
      "Interxion (Digital Realty)",
      "Megaport",
      "NL-IX",
      "NOS",
      "NTT Global DataCenters EMEA",
      "Orange",
      "Vodafone",
      "Vorboss"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "atlanta",
    "name": "Atlanta",
    "peeringLocation": "Atlanta",
    "environment": "Commercial",
    "geopoliticalRegion": "North America",
    "facility": "Equinix AT1",
    "facilityUrl": "https://www.equinix.com/data-centers/americas-colocation/united-states-colocation/atlanta-data-centers/at1",
    "zone": "1",
    "localAzureRegions": [],
    "erDirectSupported": true,
    "providers": [
      "AT&T Dynamic Exchange",
      "AT&T NetBond",
      "Lumen (CenturyLink Cloud Connect)",
      "Equinix",
      "Megaport",
      "MODMC",
      "Momentum Telecom",
      "PacketFabric"
    ],
    "exchangeProviders": [
      "Equinix"
    ],
    "additionalProviders": [
      "Crown Castle",
      "Momentum Telecom"
    ],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "atlanta2",
    "name": "Atlanta2",
    "peeringLocation": "Atlanta2",
    "environment": "Commercial",
    "geopoliticalRegion": "North America",
    "facility": "Digital Realty ATL14",
    "facilityUrl": "https://www.digitalrealty.com/data-centers/americas/atlanta/atl14",
    "zone": "1",
    "localAzureRegions": [],
    "erDirectSupported": true,
    "providers": [
      "Digital Realty",
      "Momentum Telecom"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "auckland",
    "name": "Auckland",
    "peeringLocation": "Auckland",
    "environment": "Commercial",
    "geopoliticalRegion": "Oceania",
    "facility": "Vocus Group NZ Albany",
    "facilityUrl": "https://www.2degrees.nz/business/business-services/data-centres",
    "zone": "2",
    "localAzureRegions": [
      "New Zealand North"
    ],
    "erDirectSupported": true,
    "providers": [
      "Devoli",
      "Kordia",
      "Megaport",
      "REANNZ",
      "Spark NZ",
      "Vocus Group NZ"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "auckland2",
    "name": "Auckland2",
    "peeringLocation": "Auckland2",
    "environment": "Commercial",
    "geopoliticalRegion": "Oceania",
    "facility": "Spark MDR",
    "facilityUrl": "https://www.spark.co.nz/online/large-business-govt/products/manage/data-centre-services",
    "zone": "2",
    "localAzureRegions": [
      "New Zealand North"
    ],
    "erDirectSupported": true,
    "providers": [],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "bangkok",
    "name": "Bangkok",
    "peeringLocation": "Bangkok",
    "environment": "Commercial",
    "geopoliticalRegion": "Asia",
    "facility": "AIS",
    "facilityUrl": "https://business.ais.co.th/solution/en/azure-expressroute.html",
    "zone": "2",
    "localAzureRegions": [],
    "erDirectSupported": true,
    "providers": [
      "AIS",
      "National Telecom",
      "UIH"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "berlin",
    "name": "Berlin",
    "peeringLocation": "Berlin",
    "environment": "Commercial",
    "geopoliticalRegion": "Europe",
    "facility": "NTT GDC",
    "facilityUrl": "https://www.nttdata.com/en-us/services/global-data-centers/global-locations/emea/berlin-data-centers",
    "zone": "1",
    "localAzureRegions": [
      "Germany North"
    ],
    "erDirectSupported": true,
    "providers": [
      "Colt",
      "Equinix",
      "NTT Global DataCenters EMEA"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "brussels",
    "name": "Brussels",
    "peeringLocation": "Brussels",
    "environment": "Commercial",
    "geopoliticalRegion": "Europe",
    "facility": "Digital Realty BRU4",
    "facilityUrl": "https://www.digitalrealty.com/data-centers/emea/brussels/bru4",
    "zone": "1",
    "localAzureRegions": [],
    "erDirectSupported": true,
    "providers": [
      "BICS",
      "Digital Realty",
      "Eurofiber"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "brussels2",
    "name": "Brussels2",
    "peeringLocation": "Brussels2",
    "environment": "Commercial",
    "geopoliticalRegion": "Europe",
    "facility": "LCL Brussels-North",
    "facilityUrl": "https://www.lcl.be/",
    "zone": "1",
    "localAzureRegions": [],
    "erDirectSupported": true,
    "providers": [
      "BICS",
      "Eurofiber"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "busan",
    "name": "Busan",
    "peeringLocation": "Busan",
    "environment": "Commercial",
    "geopoliticalRegion": "South Korea",
    "facility": "LG CNS",
    "facilityUrl": "https://www.lgcns.com/business/cloud/datacenter/",
    "zone": "2",
    "localAzureRegions": [
      "Korea South"
    ],
    "erDirectSupported": false,
    "providers": [
      "LG CNS"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "campinas",
    "name": "Campinas",
    "peeringLocation": "Campinas",
    "environment": "Commercial",
    "geopoliticalRegion": "South America",
    "facility": "Ascenty",
    "facilityUrl": "https://ascenty.com/en/data-centers-en/location/brazil/sao-paulo-interior-campus/campinas-1/",
    "zone": "3",
    "localAzureRegions": [
      "Brazil South"
    ],
    "erDirectSupported": true,
    "providers": [
      "Ascenty"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "canberra",
    "name": "Canberra",
    "peeringLocation": "Canberra",
    "environment": "Commercial",
    "geopoliticalRegion": "Australia Government",
    "facility": "CDC",
    "facilityUrl": "https://cdcdatacentres.com.au/about-us/",
    "zone": "1",
    "localAzureRegions": [
      "Australia Central"
    ],
    "erDirectSupported": true,
    "providers": [
      "CDC",
      "Telstra Corporation"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "canberra2",
    "name": "Canberra2",
    "peeringLocation": "Canberra2",
    "environment": "Commercial",
    "geopoliticalRegion": "Australia Government",
    "facility": "CDC",
    "facilityUrl": "https://cdcdatacentres.com.au/about-us/",
    "zone": "1",
    "localAzureRegions": [
      "Australia Central 2"
    ],
    "erDirectSupported": true,
    "providers": [
      "CDC",
      "Equinix"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "cape-town",
    "name": "Cape Town",
    "peeringLocation": "Cape Town",
    "environment": "Commercial",
    "geopoliticalRegion": "South Africa",
    "facility": "Teraco CT1",
    "facilityUrl": "https://www.teraco.co.za/data-centre-locations/cape-town/",
    "zone": "3",
    "localAzureRegions": [
      "South Africa West"
    ],
    "erDirectSupported": true,
    "providers": [
      "BCX",
      "Internet Solutions - Cloud Connect",
      "Liquid Telecom",
      "MTN Global Connect",
      "Teraco",
      "Vodacom"
    ],
    "exchangeProviders": [
      "Teraco"
    ],
    "additionalProviders": [
      "MTN"
    ],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "chennai",
    "name": "Chennai",
    "peeringLocation": "Chennai",
    "environment": "Commercial",
    "geopoliticalRegion": "India",
    "facility": "Tata Communications",
    "facilityUrl": null,
    "zone": "2",
    "localAzureRegions": [
      "South India"
    ],
    "erDirectSupported": true,
    "providers": [
      "BSNL",
      "DE-CIX",
      "Equinix",
      "Global CloudXchange (GCX)",
      "Lightstorm",
      "Megaport",
      "NTT Communications India Network Services Pvt Ltd",
      "Reliance JIO",
      "SIFY",
      "Tata Communications",
      "VodafoneIdea"
    ],
    "exchangeProviders": [
      "Tata Communications"
    ],
    "additionalProviders": [
      "Tata Teleservices"
    ],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "chennai2",
    "name": "Chennai2",
    "peeringLocation": "Chennai2",
    "environment": "Commercial",
    "geopoliticalRegion": "India",
    "facility": "Airtel",
    "facilityUrl": null,
    "zone": "2",
    "localAzureRegions": [
      "South India"
    ],
    "erDirectSupported": true,
    "providers": [
      "Airtel",
      "Megaport"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "chicago",
    "name": "Chicago",
    "peeringLocation": "Chicago",
    "environment": "Commercial",
    "geopoliticalRegion": "North America",
    "facility": "Equinix CH1",
    "facilityUrl": "https://www.equinix.com/locations/americas-colocation/united-states-colocation/chicago-data-centers/ch1/",
    "zone": "1",
    "localAzureRegions": [
      "North Central US"
    ],
    "erDirectSupported": true,
    "providers": [
      "Aryaka Networks",
      "AT&T Dynamic Exchange",
      "AT&T NetBond",
      "British Telecom",
      "Lumen (CenturyLink Cloud Connect)",
      "Cogent",
      "Cologix",
      "Colt",
      "Console Connect (PCCW Global Limited)",
      "Comcast",
      "Coresite",
      "Equinix",
      "InterCloud",
      "Internet2",
      "Lumen (Level 3 Communications)",
      "Lightpath",
      "IPC",
      "Megaport",
      "Momentum Telecom",
      "PacketFabric",
      "Tata Communications",
      "Arelion (Telia Carrier)",
      "Verizon",
      "Vodafone",
      "Zayo"
    ],
    "exchangeProviders": [
      "Equinix"
    ],
    "additionalProviders": [
      "Crown Castle",
      "Spectrum Enterprise",
      "Windstream"
    ],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "chicago2",
    "name": "Chicago2",
    "peeringLocation": "Chicago2",
    "environment": "Commercial",
    "geopoliticalRegion": "North America",
    "facility": "CoreSite CH1",
    "facilityUrl": "https://www.coresite.com/data-center/ch1-chicago-il",
    "zone": "1",
    "localAzureRegions": [
      "North Central US"
    ],
    "erDirectSupported": true,
    "providers": [
      "Lumen (CenturyLink Cloud Connect)",
      "CoreSite",
      "DE-CIX",
      "Megaport",
      "Momentum Telecom"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "copenhagen",
    "name": "Copenhagen",
    "peeringLocation": "Copenhagen",
    "environment": "Commercial",
    "geopoliticalRegion": "Europe",
    "facility": "Digital Realty(Interxion) CPH1",
    "facilityUrl": "https://www.digitalrealty.com/data-centers/emea/copenhagen/cph1",
    "zone": "1",
    "localAzureRegions": [
      "Denmark East"
    ],
    "erDirectSupported": true,
    "providers": [
      "DE-CIX",
      "GlobalConnect",
      "Interxion (Digital Realty)"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "copenhagen2",
    "name": "Copenhagen2",
    "peeringLocation": "Copenhagen2",
    "environment": "Commercial",
    "geopoliticalRegion": "Europe",
    "facility": "GlobalConnect Taastrup",
    "facilityUrl": "https://globalconnectgroup.com/#/)",
    "zone": "1",
    "localAzureRegions": [
      "Denmark East"
    ],
    "erDirectSupported": true,
    "providers": [],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "dallas",
    "name": "Dallas",
    "peeringLocation": "Dallas",
    "environment": "Commercial",
    "geopoliticalRegion": "North America",
    "facility": "Equinix DA3",
    "facilityUrl": "https://www.equinix.com/locations/americas-colocation/united-states-colocation/dallas-data-centers/da3/)[Equinix DA6](https://www.equinix.com/data-centers/americas-colocation/united-states-colocation/dallas-data-centers/da6",
    "zone": "1",
    "localAzureRegions": [],
    "erDirectSupported": true,
    "providers": [
      "Aryaka Networks",
      "AT&T Connectivity Plus",
      "AT&T Dynamic Exchange",
      "AT&T NetBond",
      "BICS",
      "Cologix",
      "Cox Business Cloud Port",
      "Equinix",
      "Flo Networks",
      "GTT",
      "Intercloud",
      "Internet2",
      "Lumen (Level 3 Communications)",
      "MCM Telecom",
      "Megaport",
      "Momentum Telecom",
      "Orange",
      "PacketFabric",
      "Telmex Uninet",
      "Arelion (Telia Carrier)",
      "Telefonica",
      "Verizon",
      "Vodafone",
      "Zayo"
    ],
    "exchangeProviders": [
      "Equinix",
      "Megaport"
    ],
    "additionalProviders": [
      "Axtel",
      "C3ntro Telecom",
      "Cox Business",
      "Crown Castle",
      "Data Foundry",
      "Momentum Telecom",
      "Spectrum Enterprise",
      "Transtelco"
    ],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "dallas2",
    "name": "Dallas2",
    "peeringLocation": "Dallas2",
    "environment": "Commercial",
    "geopoliticalRegion": "North America",
    "facility": "Digital Realty DFW10",
    "facilityUrl": "https://www.digitalrealty.com/data-centers/americas/dallas/dfw10",
    "zone": "1",
    "localAzureRegions": [],
    "erDirectSupported": true,
    "providers": [
      "Digital Realty",
      "Momentum Telecom"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "dammam",
    "name": "Dammam",
    "peeringLocation": "Dammam",
    "environment": "Commercial",
    "geopoliticalRegion": "Middle East & Africa",
    "facility": "center3 DDC352",
    "facilityUrl": "https://center3.com/services",
    "zone": "3",
    "localAzureRegions": [
      "Saudi Arabia East"
    ],
    "erDirectSupported": true,
    "providers": [
      "Orange"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "dammam2",
    "name": "Dammam2",
    "peeringLocation": "Dammam2",
    "environment": "Commercial",
    "geopoliticalRegion": "Middle East & Africa",
    "facility": "MIS Al Anwar",
    "facilityUrl": "https://www.mis.com.sa/services/data-center/",
    "zone": "3",
    "localAzureRegions": [
      "Saudi Arabia East"
    ],
    "erDirectSupported": true,
    "providers": [],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "denver",
    "name": "Denver",
    "peeringLocation": "Denver",
    "environment": "Commercial",
    "geopoliticalRegion": "North America",
    "facility": "CoreSite DE1",
    "facilityUrl": "https://www.coresite.com/data-centers/locations/denver/de1",
    "zone": "1",
    "localAzureRegions": [
      "West Central US"
    ],
    "erDirectSupported": true,
    "providers": [
      "Lumen (CenturyLink Cloud Connect)",
      "CoreSite",
      "Megaport",
      "Momentum Telecom",
      "PacketFabric",
      "Zayo"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "doha",
    "name": "Doha",
    "peeringLocation": "Doha",
    "environment": "Commercial",
    "geopoliticalRegion": "Qatar",
    "facility": "MEEZA MV2",
    "facilityUrl": "https://www.meeza.net/services/data-centre-services/",
    "zone": "3",
    "localAzureRegions": [
      "Qatar Central"
    ],
    "erDirectSupported": true,
    "providers": [
      "Ooredoo Cloud Connect",
      "Vodafone"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "doha2",
    "name": "Doha2",
    "peeringLocation": "Doha2",
    "environment": "Commercial",
    "geopoliticalRegion": "Qatar",
    "facility": "Ooredoo",
    "facilityUrl": "https://www.ooredoo.qa/",
    "zone": "3",
    "localAzureRegions": [
      "Qatar Central"
    ],
    "erDirectSupported": true,
    "providers": [
      "DE-CIX",
      "Ooredoo Cloud Connect"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "dubai",
    "name": "Dubai",
    "peeringLocation": "Dubai",
    "environment": "Commercial",
    "geopoliticalRegion": "UAE",
    "facility": "PCCS",
    "facilityUrl": "http://www.pacificcontrols.net/cloudservices/",
    "zone": "3",
    "localAzureRegions": [
      "UAE North"
    ],
    "erDirectSupported": true,
    "providers": [
      "Etisalat UAE"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "dubai2",
    "name": "Dubai2",
    "peeringLocation": "Dubai2",
    "environment": "Commercial",
    "geopoliticalRegion": "UAE",
    "facility": "du datamena",
    "facilityUrl": "https://www.du.ae/business",
    "zone": "3",
    "localAzureRegions": [
      "UAE North"
    ],
    "erDirectSupported": false,
    "providers": [
      "DE-CIX",
      "du datamena",
      "Equinix",
      "GBI",
      "Lightstorm",
      "Megaport",
      "Orange",
      "Orixcom"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "dublin",
    "name": "Dublin",
    "peeringLocation": "Dublin",
    "environment": "Commercial",
    "geopoliticalRegion": "Europe",
    "facility": "Equinix DB3",
    "facilityUrl": "https://www.equinix.com/locations/europe-colocation/ireland-colocation/dublin-data-centers/db3/",
    "zone": "1",
    "localAzureRegions": [
      "North Europe"
    ],
    "erDirectSupported": true,
    "providers": [
      "Lumen (CenturyLink Cloud Connect)",
      "Colt",
      "Console Connect (PCCW Global Limited)",
      "Deutsche Telekom AG",
      "eir",
      "Equinix",
      "GEANT",
      "euNetworks",
      "Interxion (Digital Realty)",
      "Megaport",
      "Zayo"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "dublin2",
    "name": "Dublin2",
    "peeringLocation": "Dublin2",
    "environment": "Commercial",
    "geopoliticalRegion": "Europe",
    "facility": "Digital Realty(Interxion) DUB2",
    "facilityUrl": "https://www.digitalrealty.com/data-centers/emea/dublin/dub2",
    "zone": "1",
    "localAzureRegions": [
      "North Europe"
    ],
    "erDirectSupported": true,
    "providers": [
      "InterCloud",
      "Interxion (Digital Realty)",
      "KPN",
      "Megaport",
      "NL-IX",
      "Orange"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "frankfurt",
    "name": "Frankfurt",
    "peeringLocation": "Frankfurt",
    "environment": "Commercial",
    "geopoliticalRegion": "Europe",
    "facility": "Digital Realty(Interxion) FRA11",
    "facilityUrl": "https://www.digitalrealty.com/data-centers/emea/frankfurt/fra11",
    "zone": "1",
    "localAzureRegions": [
      "Germany West Central"
    ],
    "erDirectSupported": true,
    "providers": [
      "AT&T NetBond",
      "British Telecom",
      "Lumen (CenturyLink Cloud Connect)",
      "China Unicom Global",
      "Colt",
      "Console Connect (PCCW Global Limited)",
      "DE-CIX",
      "Deutsche Telekom AG",
      "Equinix",
      "euNetworks",
      "GBI",
      "GEANT",
      "InterCloud",
      "Interxion (Digital Realty)",
      "Megaport",
      "next layer GmbH",
      "NTT Global DataCenters EMEA",
      "Orange",
      "Arelion (Telia Carrier)",
      "T-Systems",
      "Verizon",
      "Zayo",
      "Zenlayer"
    ],
    "exchangeProviders": [
      "Interxion (Digital Realty)"
    ],
    "additionalProviders": [
      "BICS",
      "Cinia",
      "Equinix",
      "Nianet",
      "QSC AG",
      "Telekom Deutschland GmbH"
    ],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "frankfurt2",
    "name": "Frankfurt2",
    "peeringLocation": "Frankfurt2",
    "environment": "Commercial",
    "geopoliticalRegion": "Europe",
    "facility": "Equinix FR7",
    "facilityUrl": "https://www.equinix.com/locations/europe-colocation/germany-colocation/frankfurt-data-centers/fr7/",
    "zone": "1",
    "localAzureRegions": [
      "Germany West Central"
    ],
    "erDirectSupported": true,
    "providers": [
      "1-IX.EU",
      "Colt",
      "Console Connect (PCCW Global Limited)",
      "DE-CIX",
      "Deutsche Telekom AG",
      "Equinix",
      "InterCloud",
      "next layer GmbH",
      "Tata Communications",
      "Telefonica",
      "Zenlayer"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "geneva",
    "name": "Geneva",
    "peeringLocation": "Geneva",
    "environment": "Commercial",
    "geopoliticalRegion": "Europe",
    "facility": "Equinix GV2",
    "facilityUrl": "https://www.equinix.com/locations/europe-colocation/switzerland-colocation/geneva-data-centers/gv2/",
    "zone": "1",
    "localAzureRegions": [
      "Switzerland West"
    ],
    "erDirectSupported": true,
    "providers": [
      "Colt",
      "Equinix",
      "InterCloud",
      "Megaport",
      "Swisscom"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "hong-kong-sar",
    "name": "Hong Kong SAR",
    "peeringLocation": "Hong Kong SAR",
    "environment": "Commercial",
    "geopoliticalRegion": "Asia",
    "facility": "Equinix HK1",
    "facilityUrl": "https://www.equinix.com/data-centers/asia-pacific-colocation/china-colocation/hong-kong-data-centers/hk1",
    "zone": "2",
    "localAzureRegions": [
      "East Asia"
    ],
    "erDirectSupported": true,
    "providers": [
      "Aryaka Networks",
      "British Telecom",
      "Lumen (CenturyLink Cloud Connect)",
      "Chief Telecom",
      "China Telecom Global",
      "China Unicom Global",
      "Colt",
      "Console Connect (PCCW Global Limited)",
      "Equinix",
      "InterCloud",
      "Megaport",
      "NTT DOCOMO BUSINESS",
      "Orange",
      "Tata Communications",
      "Arelion (Telia Carrier)",
      "Telefonica",
      "Verizon",
      "Zayo",
      "Zenlayer"
    ],
    "exchangeProviders": [
      "Equinix"
    ],
    "additionalProviders": [
      "Chief",
      "Macroview Telecom"
    ],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "hong-kong-sar2",
    "name": "Hong Kong SAR2",
    "peeringLocation": "Hong Kong SAR2",
    "environment": "Commercial",
    "geopoliticalRegion": "Asia",
    "facility": "iAdvantage MEGA-i",
    "facilityUrl": "https://www.iadvantage.net/index.php/locations/mega-i",
    "zone": "2",
    "localAzureRegions": [
      "East Asia"
    ],
    "erDirectSupported": true,
    "providers": [
      "China Mobile International",
      "China Telecom Global",
      "Console Connect (PCCW Global Limited)",
      "Deutsche Telekom AG",
      "Digital Realty",
      "Epsilon Global Communications",
      "Equinix",
      "iAdvantage",
      "Megaport",
      "SingTel",
      "Vodafone",
      "Zenlayer"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "hyderabad",
    "name": "Hyderabad",
    "peeringLocation": "Hyderabad",
    "environment": "Commercial",
    "geopoliticalRegion": "India",
    "facility": "STTGlobal HYD1",
    "facilityUrl": "https://www.sttgdc.com/in-en/locations/hyderabad",
    "zone": "3",
    "localAzureRegions": [
      "India South",
      "Central"
    ],
    "erDirectSupported": true,
    "providers": [
      "Megaport"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "hyderabad2",
    "name": "Hyderabad2",
    "peeringLocation": "Hyderabad2",
    "environment": "Commercial",
    "geopoliticalRegion": "India",
    "facility": "Sify",
    "facilityUrl": "https://www.sifytechnologies.com/data-center/hyderabad-data-center/",
    "zone": "3",
    "localAzureRegions": [
      "India South",
      "Central"
    ],
    "erDirectSupported": true,
    "providers": [
      "Megaport"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "jakarta",
    "name": "Jakarta",
    "peeringLocation": "Jakarta",
    "environment": "Commercial",
    "geopoliticalRegion": "Asia",
    "facility": "NeutraDC HDC",
    "facilityUrl": null,
    "zone": "2",
    "localAzureRegions": [
      "Indonesia Central"
    ],
    "erDirectSupported": true,
    "providers": [
      "DCI Indonesia",
      "DE-CIX",
      "NTT DOCOMO BUSINESS - Flexible Interconnect (NTT Communications - Flexible Interconnect)",
      "NTT Indonesia",
      "Telin",
      "XL Axiata",
      "Zenlayer"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "jakarta2",
    "name": "Jakarta2",
    "peeringLocation": "Jakarta2",
    "environment": "Commercial",
    "geopoliticalRegion": "Asia",
    "facility": "NTT Global Data Center Indonesia",
    "facilityUrl": null,
    "zone": "2",
    "localAzureRegions": [
      "Indonesia Central"
    ],
    "erDirectSupported": true,
    "providers": [
      "DCI Indonesia",
      "DE-CIX",
      "Equinix",
      "NTT Indonesia",
      "Telin",
      "XL Axiata",
      "Zenlayer"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "johannesburg",
    "name": "Johannesburg",
    "peeringLocation": "Johannesburg",
    "environment": "Commercial",
    "geopoliticalRegion": "South Africa",
    "facility": "Teraco JB1",
    "facilityUrl": "https://www.teraco.co.za/data-centre-locations/johannesburg/#jb1",
    "zone": "3",
    "localAzureRegions": [
      "South Africa North"
    ],
    "erDirectSupported": true,
    "providers": [
      "BCX",
      "British Telecom",
      "Console Connect (PCCW Global Limited)",
      "Digital Realty",
      "Internet Solutions - Cloud Connect",
      "Liquid Telecom",
      "MTN Business",
      "MTN Global Connect",
      "Orange",
      "Teraco",
      "Vodacom"
    ],
    "exchangeProviders": [
      "Teraco"
    ],
    "additionalProviders": [
      "MTN"
    ],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "johannesburg2",
    "name": "Johannesburg2",
    "peeringLocation": "Johannesburg2",
    "environment": "Commercial",
    "geopoliticalRegion": "South Africa",
    "facility": "Africa Data Centres JHB1",
    "facilityUrl": "https://www.africadatacentres.com/midrand/",
    "zone": "3",
    "localAzureRegions": [
      "South Africa North"
    ],
    "erDirectSupported": true,
    "providers": [
      "Liquid Telecom"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "kuala-lumpur",
    "name": "Kuala Lumpur",
    "peeringLocation": "Kuala Lumpur",
    "environment": "Commercial",
    "geopoliticalRegion": "Asia",
    "facility": "TIME dotCom Menara AIMS",
    "facilityUrl": "https://www.time.com.my/for-enterprise/cloud",
    "zone": "2",
    "localAzureRegions": [
      "Malaysia West"
    ],
    "erDirectSupported": true,
    "providers": [
      "DE-CIX",
      "Equinix",
      "TIME dotCom",
      "Zenlayer"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "kuala-lumpur2",
    "name": "Kuala Lumpur2",
    "peeringLocation": "Kuala Lumpur2",
    "environment": "Commercial",
    "geopoliticalRegion": "Asia",
    "facility": "Telekom Malaysia Bhd",
    "facilityUrl": null,
    "zone": "2",
    "localAzureRegions": [
      "Malaysia West"
    ],
    "erDirectSupported": true,
    "providers": [
      "TIME dotCom",
      "Zenlayer"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "lagos",
    "name": "Lagos",
    "peeringLocation": "Lagos",
    "environment": "Commercial",
    "geopoliticalRegion": "South Africa",
    "facility": "RackCentre LGS2",
    "facilityUrl": "https://rack-centre.com/lagos-data-centre-campus-expansion/",
    "zone": "3",
    "localAzureRegions": [],
    "erDirectSupported": true,
    "providers": [
      "Liquid Telecom"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "las-vegas",
    "name": "Las Vegas",
    "peeringLocation": "Las Vegas",
    "environment": "Commercial",
    "geopoliticalRegion": "North America",
    "facility": "Switch LV",
    "facilityUrl": "https://www.switch.com/las-vegas",
    "zone": "1",
    "localAzureRegions": [],
    "erDirectSupported": true,
    "providers": [
      "Lumen (CenturyLink Cloud Connect)",
      "Megaport",
      "PacketFabric",
      "Zayo"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "london",
    "name": "London",
    "peeringLocation": "London",
    "environment": "Commercial",
    "geopoliticalRegion": "Europe",
    "facility": "Equinix LD5",
    "facilityUrl": "https://www.equinix.com/locations/europe-colocation/united-kingdom-colocation/london-data-centers/ld5/",
    "zone": "1",
    "localAzureRegions": [
      "UK South"
    ],
    "erDirectSupported": true,
    "providers": [
      "AT&T NetBond",
      "Bezeq International",
      "British Telecom",
      "CenturyLink",
      "Colt",
      "Console Connect (PCCW Global Limited)",
      "Digital Realty<br/Equinix",
      "euNetworks",
      "Intelsat",
      "InterCloud",
      "Internet Solutions - Cloud Connect",
      "Interxion (Digital Realty)",
      "Jisc",
      "Lumen (Level 3 Communications)",
      "Megaport",
      "Momentum Telecom",
      "MTN",
      "NTT DOCOMO BUSINESS",
      "Orange",
      "PacketFabric",
      "Tata Communications",
      "Telefonica",
      "Telehouse - KDDI",
      "Telenor",
      "Arelion (Telia Carrier)",
      "Verizon",
      "Vodafone",
      "Vorboss",
      "Zayo"
    ],
    "exchangeProviders": [
      "BICS",
      "Equinix",
      "euNetworks"
    ],
    "additionalProviders": [
      "Bezeq International Ltd.",
      "CoreAzure",
      "Epsilon Telecommunications Limited",
      "Exponential E",
      "HSO",
      "NexGen Networks",
      "Proximus",
      "Tamares Telecom",
      "Zain"
    ],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "london2",
    "name": "London2",
    "peeringLocation": "London2",
    "environment": "Commercial",
    "geopoliticalRegion": "Europe",
    "facility": "Telehouse North Two",
    "facilityUrl": "https://www.telehouse.net/data-centres/emea/uk-data-centres/london-data-centres/north-two",
    "zone": "1",
    "localAzureRegions": [
      "UK South"
    ],
    "erDirectSupported": true,
    "providers": [
      "BICS",
      "British Telecom",
      "Lumen (CenturyLink Cloud Connect)",
      "Colt",
      "Equinix",
      "Epsilon Global Communications",
      "GTT",
      "Interxion (Digital Realty)",
      "IX Reach",
      "JISC",
      "Marlink",
      "Megaport",
      "NTT Global DataCenters EMEA",
      "Ooredoo Cloud Connect",
      "Orange",
      "SES",
      "Sohonet",
      "Tata Communications",
      "Telehouse - KDDI",
      "Vodafone",
      "Vorboss Limited",
      "Zayo"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "los-angeles",
    "name": "Los Angeles",
    "peeringLocation": "Los Angeles",
    "environment": "Commercial",
    "geopoliticalRegion": "North America",
    "facility": "CoreSite LA1",
    "facilityUrl": "https://www.coresite.com/data-centers/locations/los-angeles/one-wilshire",
    "zone": "1",
    "localAzureRegions": [],
    "erDirectSupported": true,
    "providers": [
      "AT&T Dynamic Exchange",
      "BICS",
      "CoreSite",
      "China Unicom Global",
      "Cloudflare",
      "Equinix",
      "Flo Networks",
      "Internet2",
      "Megaport",
      "Momentum Telecom",
      "NTT Communications",
      "Sohonet",
      "Zayo</br>"
    ],
    "exchangeProviders": [
      "Equinix"
    ],
    "additionalProviders": [
      "Crown Castle",
      "Momentum Telecom",
      "Spectrum Enterprise",
      "Transtelco"
    ],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "los-angeles2",
    "name": "Los Angeles2",
    "peeringLocation": "Los Angeles2",
    "environment": "Commercial",
    "geopoliticalRegion": "North America",
    "facility": "Equinix LA1",
    "facilityUrl": "https://www.equinix.com/locations/americas-colocation/united-states-colocation/los-angeles-data-centers/la1/",
    "zone": "1",
    "localAzureRegions": [],
    "erDirectSupported": true,
    "providers": [
      "Crown Castle",
      "Equinix",
      "GTT",
      "PacketFabric"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "luxembourg",
    "name": "Luxembourg",
    "peeringLocation": "Luxembourg",
    "environment": "Commercial",
    "geopoliticalRegion": "Europe",
    "facility": "EBRC Kayl",
    "facilityUrl": "https://www.deep.eu/fr/accueil/services/datacenter/datacenter-colocation-services",
    "zone": "1",
    "localAzureRegions": [],
    "erDirectSupported": true,
    "providers": [
      "Deep",
      "Proximus NXT Luxembourg"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "madrid",
    "name": "Madrid",
    "peeringLocation": "Madrid",
    "environment": "Commercial",
    "geopoliticalRegion": "Europe",
    "facility": "Digital Realty(Interxion) MAD1",
    "facilityUrl": "https://www.digitalrealty.com/data-centers/emea/madrid/mad1",
    "zone": "1",
    "localAzureRegions": [
      "Spain Central"
    ],
    "erDirectSupported": true,
    "providers": [
      "DE-CIX",
      "GTT",
      "InterCloud",
      "Interxion (Digital Realty)",
      "Marlink",
      "Megaport",
      "Momentum Telecom",
      "NOS",
      "Telefonica"
    ],
    "exchangeProviders": [
      "Level3"
    ],
    "additionalProviders": [
      "Zertia"
    ],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "madrid2",
    "name": "Madrid2",
    "peeringLocation": "Madrid2",
    "environment": "Commercial",
    "geopoliticalRegion": "Europe",
    "facility": "Equinix MD2",
    "facilityUrl": "https://www.equinix.com/data-centers/europe-colocation/spain-colocation/madrid-data-centers/md2",
    "zone": "1",
    "localAzureRegions": [
      "Spain Central"
    ],
    "erDirectSupported": true,
    "providers": [
      "1-IX.EU",
      "DE-CIX",
      "Equinix",
      "GÉANT",
      "Intercloud"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "marseille",
    "name": "Marseille",
    "peeringLocation": "Marseille",
    "environment": "Commercial",
    "geopoliticalRegion": "Europe",
    "facility": "Digital Realty(Interxion) MRS3",
    "facilityUrl": "https://www.digitalrealty.com/data-centers/emea/marseille/mrs1",
    "zone": "1",
    "localAzureRegions": [
      "France South"
    ],
    "erDirectSupported": true,
    "providers": [
      "Colt",
      "DE-CIX",
      "GEANT",
      "Interxion (Digital Realty)",
      "Jaguar Network",
      "Ooredoo Cloud Connect"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "melbourne",
    "name": "Melbourne",
    "peeringLocation": "Melbourne",
    "environment": "Commercial",
    "geopoliticalRegion": "Oceania",
    "facility": "NextDC M1",
    "facilityUrl": "https://www.nextdc.com/data-centres/m1-melbourne-data-centre",
    "zone": "2",
    "localAzureRegions": [
      "Australia Southeast"
    ],
    "erDirectSupported": true,
    "providers": [
      "AARNet",
      "Devoli",
      "Equinix",
      "Internet Association of Australia (IX Australia)",
      "Megaport",
      "NETSG",
      "NEXTDC",
      "Optus",
      "Orange",
      "Telstra Corporation",
      "TPG Telecom",
      "Vocus"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "melbourne2",
    "name": "Melbourne2",
    "peeringLocation": "Melbourne2",
    "environment": "Commercial",
    "geopoliticalRegion": "Oceania",
    "facility": "Equinix ME1",
    "facilityUrl": "https://www.equinix.com/data-centers/asia-pacific-colocation/australia-colocation/melbourne-data-centers/me1",
    "zone": "2",
    "localAzureRegions": [
      "Australia Southeast"
    ],
    "erDirectSupported": true,
    "providers": [
      "Equinix"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "miami",
    "name": "Miami",
    "peeringLocation": "Miami",
    "environment": "Commercial",
    "geopoliticalRegion": "North America",
    "facility": "Equinix MI1",
    "facilityUrl": "https://www.equinix.com/locations/americas-colocation/united-states-colocation/miami-data-centers/mi1/",
    "zone": "1",
    "localAzureRegions": [],
    "erDirectSupported": true,
    "providers": [
      "AT&T Dynamic Exchange",
      "C3ntro",
      "Claro",
      "Equinix",
      "Flo Networks",
      "Lightpath",
      "Megaport",
      "Momentum Telecom",
      "PacketFabric",
      "PitChile"
    ],
    "exchangeProviders": [
      "Equinix",
      "Megaport"
    ],
    "additionalProviders": [
      "Momentum Telecom",
      "Zertia"
    ],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "milan",
    "name": "Milan",
    "peeringLocation": "Milan",
    "environment": "Commercial",
    "geopoliticalRegion": "Europe",
    "facility": "IRIDEOS",
    "facilityUrl": "https://www.retelit.it/it/infrastrutture/data-center-italia",
    "zone": "1",
    "localAzureRegions": [
      "Italy North"
    ],
    "erDirectSupported": true,
    "providers": [
      "Colt",
      "Equinix",
      "Fastweb",
      "GARR",
      "IRIDEOS",
      "Megaport",
      "Noovle",
      "Orange",
      "Retelit",
      "Telecom Italia Sparkle",
      "Vodafone"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "milan2",
    "name": "Milan2",
    "peeringLocation": "Milan2",
    "environment": "Commercial",
    "geopoliticalRegion": "Europe",
    "facility": "DATA4",
    "facilityUrl": "https://www.data4group.com/it/data-center-a-milano-italia/",
    "zone": "1",
    "localAzureRegions": [
      "Italy North"
    ],
    "erDirectSupported": true,
    "providers": [
      "Retelit"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "minneapolis",
    "name": "Minneapolis",
    "peeringLocation": "Minneapolis",
    "environment": "Commercial",
    "geopoliticalRegion": "North America",
    "facility": "Cologix MIN1",
    "facilityUrl": "https://www.cologix.com/data-centers/minneapolis/min1/) and [Cologix MIN3](https://www.cologix.com/data-centers/minneapolis/min3/",
    "zone": "1",
    "localAzureRegions": [],
    "erDirectSupported": true,
    "providers": [
      "Lumen (CenturyLink Cloud Connect)",
      "Cologix",
      "Megaport",
      "Zayo"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "montreal",
    "name": "Montreal",
    "peeringLocation": "Montreal",
    "environment": "Commercial",
    "geopoliticalRegion": "North America",
    "facility": "Cologix MTL3",
    "facilityUrl": "https://www.cologix.com/data-centers/montreal/mtl3/)[Cologix MTL7](https://cologix.com/data-centers/montreal/mtl7/",
    "zone": "1",
    "localAzureRegions": [],
    "erDirectSupported": true,
    "providers": [
      "Bell Canada",
      "Lumen (CenturyLink Cloud Connect)",
      "Cologix",
      "Equinix",
      "Fibrenoire",
      "Megaport",
      "RISQ",
      "Telus",
      "Zayo"
    ],
    "exchangeProviders": [
      "Cologix"
    ],
    "additionalProviders": [
      "Airgate Technologies",
      "Inc. Aptum Technologies",
      "Oncore Cloud Services Inc.",
      "Rogers",
      "Zirro"
    ],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "mumbai",
    "name": "Mumbai",
    "peeringLocation": "Mumbai",
    "environment": "Commercial",
    "geopoliticalRegion": "India",
    "facility": "Tata Communications",
    "facilityUrl": null,
    "zone": "2",
    "localAzureRegions": [
      "West India"
    ],
    "erDirectSupported": true,
    "providers": [
      "BSNL",
      "British Telecom",
      "DE-CIX",
      "Global CloudXchange (GCX)",
      "InterCloud",
      "Lightstorm",
      "Megaport",
      "NTT Communications India Network Services Pvt Ltd",
      "Reliance Jio",
      "Tata Communications",
      "Verizon",
      "Zenlayer"
    ],
    "exchangeProviders": [
      "Tata Communications"
    ],
    "additionalProviders": [
      "Tata Teleservices"
    ],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "mumbai2",
    "name": "Mumbai2",
    "peeringLocation": "Mumbai2",
    "environment": "Commercial",
    "geopoliticalRegion": "India",
    "facility": "Airtel",
    "facilityUrl": null,
    "zone": "2",
    "localAzureRegions": [
      "West India"
    ],
    "erDirectSupported": true,
    "providers": [
      "Airtel",
      "Equinix",
      "Sify",
      "Orange",
      "Vodafone Idea"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "munich",
    "name": "Munich",
    "peeringLocation": "Munich",
    "environment": "Commercial",
    "geopoliticalRegion": "Europe",
    "facility": "EdgeConneX",
    "facilityUrl": "https://www.edgeconnex.com/locations/europe/munich/",
    "zone": "1",
    "localAzureRegions": [],
    "erDirectSupported": true,
    "providers": [
      "Colt",
      "DE-CIX",
      "Megaport"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "new-york",
    "name": "New York",
    "peeringLocation": "New York",
    "environment": "Commercial",
    "geopoliticalRegion": "North America",
    "facility": "Equinix NY5",
    "facilityUrl": "https://www.equinix.com/locations/americas-colocation/united-states-colocation/new-york-data-centers/ny5/",
    "zone": "1",
    "localAzureRegions": [],
    "erDirectSupported": true,
    "providers": [
      "AT&T Dynamic Exchange",
      "Lumen (CenturyLink Cloud Connect)",
      "Coresite",
      "Crown Castle",
      "DE-CIX",
      "Equinix",
      "InterCloud",
      "Lightpath",
      "Megaport",
      "Momentum Telecom",
      "NTT DOCOMO BUSINESS",
      "Packet",
      "PacketFabric",
      "Zayo"
    ],
    "exchangeProviders": [
      "Equinix",
      "Megaport"
    ],
    "additionalProviders": [
      "Altice Business",
      "Crown Castle",
      "Spectrum Enterprise",
      "Webair"
    ],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "newport-wales",
    "name": "Newport(Wales)",
    "peeringLocation": "Newport(Wales)",
    "environment": "Commercial",
    "geopoliticalRegion": "Europe",
    "facility": "Next Generation Data",
    "facilityUrl": "https://www.nextgenerationdata.co.uk",
    "zone": "1",
    "localAzureRegions": [
      "UK West"
    ],
    "erDirectSupported": true,
    "providers": [
      "British Telecom",
      "Colt",
      "Jisc",
      "Lumen (Level 3 Communications)",
      "Next Generation Data",
      "Vorboss Limited"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "omaha",
    "name": "Omaha",
    "peeringLocation": "Omaha",
    "environment": "Commercial",
    "geopoliticalRegion": "North America",
    "facility": "1623 Farnham",
    "facilityUrl": "https://www.1623farnam.com/",
    "zone": "1",
    "localAzureRegions": [],
    "erDirectSupported": true,
    "providers": [
      "Megaport"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "osaka",
    "name": "Osaka",
    "peeringLocation": "Osaka",
    "environment": "Commercial",
    "geopoliticalRegion": "Japan",
    "facility": "Equinix OS1",
    "facilityUrl": "https://www.equinix.com/locations/asia-colocation/japan-colocation/osaka-data-centers/os1/",
    "zone": "2",
    "localAzureRegions": [
      "Japan West"
    ],
    "erDirectSupported": true,
    "providers": [
      "AT TOKYO",
      "BBIX",
      "Colt",
      "DE-CIX",
      "Equinix",
      "Internet Initiative Japan Inc. - IIJ",
      "KDDI",
      "Megaport",
      "NTT DOCOMO BUSINESS",
      "NTT DOCOMO BUSINESS - Flexible Interconnect (NTT Communications - Flexible Interconnect)",
      "NTT SmartConnect",
      "Orange",
      "Softbank",
      "Tokai Communications"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "oslo",
    "name": "Oslo",
    "peeringLocation": "Oslo",
    "environment": "Commercial",
    "geopoliticalRegion": "Europe",
    "facility": "DigiPlex Ulven",
    "facilityUrl": null,
    "zone": "1",
    "localAzureRegions": [
      "Norway East"
    ],
    "erDirectSupported": true,
    "providers": [
      "DE-CIX",
      "GlobalConnect",
      "Megaport",
      "Telenor",
      "Arelion (Telia Carrier)"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "paris",
    "name": "Paris",
    "peeringLocation": "Paris",
    "environment": "Commercial",
    "geopoliticalRegion": "Europe",
    "facility": "Digital Realty(Interxion) PAR5",
    "facilityUrl": "https://www.digitalrealty.com/data-centers/emea/paris/par5",
    "zone": "1",
    "localAzureRegions": [
      "France Central"
    ],
    "erDirectSupported": true,
    "providers": [
      "British Telecom",
      "Lumen (CenturyLink Cloud Connect)",
      "Colt",
      "Console Connect (PCCW Global Limited)",
      "Equinix",
      "euNetworks",
      "Intercloud",
      "Digital Realty (Interxion)",
      "Jaguar Network",
      "Megaport",
      "Orange",
      "Arelion (Telia Carrier)",
      "Verizon",
      "Zayo"
    ],
    "exchangeProviders": [
      "Equinix"
    ],
    "additionalProviders": [
      "Proximus"
    ],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "paris2",
    "name": "Paris2",
    "peeringLocation": "Paris2",
    "environment": "Commercial",
    "geopoliticalRegion": "Europe",
    "facility": "Equinix",
    "facilityUrl": "https://www.equinix.com/data-centers/europe-colocation/france-colocation/paris-data-centers/pa4",
    "zone": "1",
    "localAzureRegions": [
      "France Central"
    ],
    "erDirectSupported": true,
    "providers": [
      "1-IX.EU",
      "Colt",
      "Equinix",
      "InterCloud",
      "Megaport",
      "Orange",
      "Tata Communications"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "perth",
    "name": "Perth",
    "peeringLocation": "Perth",
    "environment": "Commercial",
    "geopoliticalRegion": "Oceania",
    "facility": "NextDC P1",
    "facilityUrl": "https://www.nextdc.com/data-centres/p1-perth-data-centre",
    "zone": "2",
    "localAzureRegions": [],
    "erDirectSupported": true,
    "providers": [
      "Equinix",
      "Internet Association of Australia (IX Australia)",
      "Megaport",
      "NextDC"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "phoenix",
    "name": "Phoenix",
    "peeringLocation": "Phoenix",
    "environment": "Commercial",
    "geopoliticalRegion": "North America",
    "facility": "EdgeConneX PHX01",
    "facilityUrl": "https://www.edgeconnex.com/locations/americas/phoenix-az/",
    "zone": "1",
    "localAzureRegions": [
      "West US 3"
    ],
    "erDirectSupported": true,
    "providers": [
      "AT&T NetBond",
      "Cox Business Cloud Port",
      "Lumen (CenturyLink Cloud Connect)",
      "DE-CIX",
      "Megaport",
      "Zayo"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "phoenix2",
    "name": "Phoenix2",
    "peeringLocation": "Phoenix2",
    "environment": "Commercial",
    "geopoliticalRegion": "North America",
    "facility": "PhoenixNAP",
    "facilityUrl": "https://phoenixnap.com/",
    "zone": "1",
    "localAzureRegions": [
      "West US 3"
    ],
    "erDirectSupported": true,
    "providers": [
      "Lumen (CenturyLink Cloud Connect)",
      "Digital Realty",
      "GTT",
      "Iron Mountain"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "portland",
    "name": "Portland",
    "peeringLocation": "Portland",
    "environment": "Commercial",
    "geopoliticalRegion": "North America",
    "facility": "EdgeConnex POR01",
    "facilityUrl": "https://www.edgeconnex.com/locations/north-america/portland-or/",
    "zone": "1",
    "localAzureRegions": [
      "West US 2"
    ],
    "erDirectSupported": true,
    "providers": [
      "Ziply Fiber"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "pune",
    "name": "Pune",
    "peeringLocation": "Pune",
    "environment": "Commercial",
    "geopoliticalRegion": "India",
    "facility": "STT GDC Pune DC1",
    "facilityUrl": "https://www.sttgdc.com/in-en/locations/pune",
    "zone": "2",
    "localAzureRegions": [
      "Central India"
    ],
    "erDirectSupported": true,
    "providers": [
      "Airtel",
      "Lightstorm",
      "SIFY",
      "Tata Communications"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "quebec-city",
    "name": "Quebec City",
    "peeringLocation": "Quebec City",
    "environment": "Commercial",
    "geopoliticalRegion": "North America",
    "facility": "Vantage",
    "facilityUrl": "https://vantage-dc.com/data_centers/quebec-city-data-center-campus/",
    "zone": "1",
    "localAzureRegions": [
      "Canada East"
    ],
    "erDirectSupported": true,
    "providers": [
      "Bell Canada",
      "Fibrenoire",
      "Megaport",
      "RISQ",
      "Telus"
    ],
    "exchangeProviders": [
      "Megaport"
    ],
    "additionalProviders": [
      "Fibrenoire"
    ],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "queretaro-mexico",
    "name": "Queretaro (Mexico)",
    "peeringLocation": "Queretaro (Mexico)",
    "environment": "Commercial",
    "geopoliticalRegion": "North America",
    "facility": "KIO Networks QR01",
    "facilityUrl": "https://www.kio.tech/",
    "zone": "4",
    "localAzureRegions": [
      "Mexico Central"
    ],
    "erDirectSupported": true,
    "providers": [
      "Axtel",
      "Cirion Technologies",
      "C3ntro",
      "Console Connect (PCCW Global Limited)",
      "DE-CIX",
      "Equinix",
      "Flo Networks",
      "KIO",
      "MCM Telecom",
      "Megaport",
      "Neutrona Networks",
      "Transtelco"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "quincy",
    "name": "Quincy",
    "peeringLocation": "Quincy",
    "environment": "Commercial",
    "geopoliticalRegion": "North America",
    "facility": "Sabey Datacenter - Building A",
    "facilityUrl": null,
    "zone": "1",
    "localAzureRegions": [
      "West US 2"
    ],
    "erDirectSupported": true,
    "providers": [
      "Ziply Fiber"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "rio-de-janeiro",
    "name": "Rio de Janeiro",
    "peeringLocation": "Rio de Janeiro",
    "environment": "Commercial",
    "geopoliticalRegion": "South America",
    "facility": "Equinix-RJ2",
    "facilityUrl": "https://www.equinix.com/locations/americas-colocation/brazil-colocation/rio-de-janeiro-data-centers/rj2/",
    "zone": "3",
    "localAzureRegions": [
      "Brazil South",
      "east"
    ],
    "erDirectSupported": true,
    "providers": [
      "Cirion Technologies",
      "DE-CIX",
      "Equinix"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "san-antonio",
    "name": "San Antonio",
    "peeringLocation": "San Antonio",
    "environment": "Commercial",
    "geopoliticalRegion": "North America",
    "facility": "CyrusOne SA1",
    "facilityUrl": "https://www.cyrusone.com/data-centers/north-america/san-antonio-texas-sat1",
    "zone": "1",
    "localAzureRegions": [
      "South Central US"
    ],
    "erDirectSupported": true,
    "providers": [
      "AT&T Netbond",
      "Lumen (CenturyLink Cloud Connect)",
      "Megaport",
      "Zayo"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "santiago",
    "name": "Santiago",
    "peeringLocation": "Santiago",
    "environment": "Commercial",
    "geopoliticalRegion": "South America",
    "facility": "EdgeConnex SCL",
    "facilityUrl": "https://www.edgeconnex.com/locations/south-america/santiago/",
    "zone": "3",
    "localAzureRegions": [
      "Chile Central"
    ],
    "erDirectSupported": true,
    "providers": [
      "Cirion Technologies",
      "Equinix",
      "PitChile"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "santiago2",
    "name": "Santiago2",
    "peeringLocation": "Santiago2",
    "environment": "Commercial",
    "geopoliticalRegion": "South America",
    "facility": "Cirion SAN1",
    "facilityUrl": "https://www.ciriontechnologies.com/en/data-center/our-data-centers/santiago-1/",
    "zone": "3",
    "localAzureRegions": [
      "Chile Central"
    ],
    "erDirectSupported": true,
    "providers": [],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "sao-paulo",
    "name": "Sao Paulo",
    "peeringLocation": "Sao Paulo",
    "environment": "Commercial",
    "geopoliticalRegion": "South America",
    "facility": "Equinix SP2",
    "facilityUrl": "https://www.equinix.com/locations/americas-colocation/brazil-colocation/sao-paulo-data-centers/sp2/",
    "zone": "3",
    "localAzureRegions": [
      "Brazil South"
    ],
    "erDirectSupported": true,
    "providers": [
      "Aryaka Networks",
      "Ascenty Data Centers",
      "British Telecom",
      "DE-CIX",
      "Embratel",
      "Equinix",
      "InterCloud",
      "Lumen (Level 3 Communications)",
      "Megaport",
      "Neutrona Networks",
      "Orange",
      "RedCLARA",
      "Tata Communications",
      "Telefonica",
      "UOLDIVEO",
      "Zayo"
    ],
    "exchangeProviders": [
      "Equinix"
    ],
    "additionalProviders": [
      "Venha Pra Nuvem"
    ],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "sao-paulo2",
    "name": "Sao Paulo2",
    "peeringLocation": "Sao Paulo2",
    "environment": "Commercial",
    "geopoliticalRegion": "South America",
    "facility": "TIVIT TSM",
    "facilityUrl": "https://www.tivit.com/en/tivit/",
    "zone": "3",
    "localAzureRegions": [
      "Brazil South"
    ],
    "erDirectSupported": true,
    "providers": [
      "Ascenty Data Centers",
      "Megaport",
      "Tivit"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "seattle",
    "name": "Seattle",
    "peeringLocation": "Seattle",
    "environment": "Commercial",
    "geopoliticalRegion": "North America",
    "facility": "Equinix SE2",
    "facilityUrl": "https://www.equinix.com/locations/americas-colocation/united-states-colocation/seattle-data-centers/se2/",
    "zone": "1",
    "localAzureRegions": [
      "West US 2"
    ],
    "erDirectSupported": true,
    "providers": [
      "Aryaka Networks",
      "Lumen (CenturyLink Cloud Connect)",
      "Cogent",
      "DE-CIX",
      "Digital Realty",
      "Equinix",
      "Lumen (Level 3 Communications)",
      "Megaport",
      "Momentum Telecom",
      "Pacific Northwest Gigapop",
      "PacketFabric",
      "Arelion (Telia Carrier)",
      "Telus",
      "Zayo"
    ],
    "exchangeProviders": [
      "Equinix"
    ],
    "additionalProviders": [
      "Alaska Communications",
      "Momentum Telecom"
    ],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "seoul",
    "name": "Seoul",
    "peeringLocation": "Seoul",
    "environment": "Commercial",
    "geopoliticalRegion": "South Korea",
    "facility": "KINX Gasan IDC",
    "facilityUrl": "https://www.kinx.net/?lang=en",
    "zone": "2",
    "localAzureRegions": [
      "Korea Central"
    ],
    "erDirectSupported": true,
    "providers": [
      "Colt",
      "Digital Realty",
      "Equinix",
      "KINX",
      "KT",
      "LG CNS",
      "LGUplus",
      "SamsungSDS",
      "Sejong Telecom",
      "SK Telecom",
      "SKT"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "seoul2",
    "name": "Seoul2",
    "peeringLocation": "Seoul2",
    "environment": "Commercial",
    "geopoliticalRegion": "South Korea",
    "facility": "KT IDC",
    "facilityUrl": "https://www.kt-idc.com/eng/introduce/sub1_4_10.jsp#tab",
    "zone": "2",
    "localAzureRegions": [
      "Korea Central"
    ],
    "erDirectSupported": false,
    "providers": [
      "KINX",
      "KT",
      "LGUplus"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "silicon-valley",
    "name": "Silicon Valley",
    "peeringLocation": "Silicon Valley",
    "environment": "Commercial",
    "geopoliticalRegion": "North America",
    "facility": "Equinix SV1",
    "facilityUrl": "https://www.equinix.com/locations/americas-colocation/united-states-colocation/silicon-valley-data-centers/sv1/",
    "zone": "1",
    "localAzureRegions": [
      "West US"
    ],
    "erDirectSupported": true,
    "providers": [
      "Aryaka Networks",
      "AT&T Dynamic Exchange",
      "AT&T NetBond",
      "British Telecom",
      "Lumen (CenturyLink Cloud Connect)",
      "China Unicom Global",
      "Cogent",
      "Colt",
      "Comcast",
      "Coresite",
      "Cox Business Cloud Port",
      "Digital Realty",
      "Equinix",
      "InterCloud",
      "Internet2",
      "IX Reach",
      "Lumen (Level 3 Communications)",
      "Megaport",
      "MODMC",
      "Momentum Telecom",
      "Orange",
      "Packet",
      "PacketFabric",
      "Tata Communications",
      "Arelion (Telia Carrier)",
      "Verizon",
      "Vodafone",
      "Zayo"
    ],
    "exchangeProviders": [
      "CoreSite",
      "Equinix",
      "Megaport"
    ],
    "additionalProviders": [
      "Cox Business",
      "Momentum Telecom",
      "Spectrum Enterprise",
      "Windstream",
      "X2nsat Inc."
    ],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "silicon-valley2",
    "name": "Silicon Valley2",
    "peeringLocation": "Silicon Valley2",
    "environment": "Commercial",
    "geopoliticalRegion": "North America",
    "facility": "Coresite SV7",
    "facilityUrl": "https://www.coresite.com/data-centers/locations/silicon-valley/sv7",
    "zone": "1",
    "localAzureRegions": [
      "West US"
    ],
    "erDirectSupported": true,
    "providers": [
      "Coresite",
      "Momentum Telecom"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "singapore",
    "name": "Singapore",
    "peeringLocation": "Singapore",
    "environment": "Commercial",
    "geopoliticalRegion": "Asia",
    "facility": "Equinix SG1",
    "facilityUrl": "https://www.equinix.com/data-centers/asia-pacific-colocation/singapore-colocation/singapore-data-center/sg1",
    "zone": "2",
    "localAzureRegions": [
      "Southeast Asia"
    ],
    "erDirectSupported": true,
    "providers": [
      "Aryaka Networks",
      "AT&T NetBond",
      "British Telecom",
      "China Mobile International",
      "China Telecom Global",
      "Console Connect (PCCW Global Limited)",
      "Epsilon Global Communications",
      "Equinix",
      "GTT",
      "IPC",
      "InterCloud",
      "Lumen (Level 3 Communications)",
      "Megaport",
      "NTT DOCOMO BUSINESS",
      "Orange",
      "SingTel",
      "Tata Communications",
      "Telstra Corporation",
      "Telefonica",
      "TIME dotCom",
      "Verizon",
      "Vodafone",
      "Zenlayer"
    ],
    "exchangeProviders": [
      "Equinix"
    ],
    "additionalProviders": [
      "1CLOUDSTAR",
      "BICS",
      "CMC Telecom",
      "Epsilon Telecommunications Limited",
      "LGA Telecom",
      "United Information Highway (UIH)"
    ],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "singapore2",
    "name": "Singapore2",
    "peeringLocation": "Singapore2",
    "environment": "Commercial",
    "geopoliticalRegion": "Asia",
    "facility": "Global Switch Tai Seng",
    "facilityUrl": "https://www.globalswitch.com/data-centres/singapore/",
    "zone": "2",
    "localAzureRegions": [
      "Southeast Asia"
    ],
    "erDirectSupported": true,
    "providers": [
      "Lumen (CenturyLink Cloud Connect)",
      "China Mobile International",
      "China Unicom Global",
      "Colt",
      "Console Connect (PCCW Global Limited)",
      "DE-CIX",
      "Digital Realty",
      "Epsilon Global Communications",
      "Equinix",
      "Megaport",
      "NTT DOCOMO BUSINESS - Flexible Interconnect (NTT Communications - Flexible Interconnect)",
      "SingTel",
      "TATA Communications",
      "Telehouse - KDDI",
      "Arelion (Telia Carrier)",
      "Zenlayer"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "stavanger",
    "name": "Stavanger",
    "peeringLocation": "Stavanger",
    "environment": "Commercial",
    "geopoliticalRegion": "Europe",
    "facility": "Green Mountain DC1",
    "facilityUrl": "https://greenmountain.no/dc1-stavanger/",
    "zone": "1",
    "localAzureRegions": [
      "Norway West"
    ],
    "erDirectSupported": true,
    "providers": [
      "GlobalConnect",
      "Megaport",
      "Telenor"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "stockholm",
    "name": "Stockholm",
    "peeringLocation": "Stockholm",
    "environment": "Commercial",
    "geopoliticalRegion": "Europe",
    "facility": "Equinix SK1",
    "facilityUrl": "https://www.equinix.com/locations/europe-colocation/sweden-colocation/stockholm-data-centers/sk1/",
    "zone": "1",
    "localAzureRegions": [
      "Sweden Central"
    ],
    "erDirectSupported": true,
    "providers": [
      "Cinia",
      "Elisa",
      "Equinix",
      "GlobalConnect",
      "Interxion (Digital Realty)",
      "Megaport",
      "Tata Communications",
      "Arelion (Telia Carrier)"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "stockholm2",
    "name": "Stockholm2",
    "peeringLocation": "Stockholm2",
    "environment": "Commercial",
    "geopoliticalRegion": "Europe",
    "facility": "Digital Realty STO6",
    "facilityUrl": "https://www.digitalrealty.com/data-centers/emea/stockholm/sto6",
    "zone": "1",
    "localAzureRegions": [
      "Sweden Central"
    ],
    "erDirectSupported": true,
    "providers": [
      "Digital Realty"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "sydney",
    "name": "Sydney",
    "peeringLocation": "Sydney",
    "environment": "Commercial",
    "geopoliticalRegion": "Oceania",
    "facility": "Equinix SY2",
    "facilityUrl": "https://www.equinix.com/locations/asia-colocation/australia-colocation/sydney-data-centers/sy2/",
    "zone": "2",
    "localAzureRegions": [
      "Australia East"
    ],
    "erDirectSupported": true,
    "providers": [
      "AARNet",
      "AT&T NetBond",
      "British Telecom",
      "Cello",
      "Lumen (CenturyLink Cloud Connect)",
      "Console Connect (PCCW Global Limited)",
      "Devoli",
      "Equinix",
      "GTT",
      "Kordia",
      "Megaport",
      "NEXTDC",
      "NTT DOCOMO BUSINESS",
      "Optus",
      "Orange",
      "Spark NZ",
      "Telstra Corporation",
      "TPG Telecom",
      "Verizon",
      "Vocus",
      "Vocus Group NZ"
    ],
    "exchangeProviders": [
      "Megaport"
    ],
    "additionalProviders": [
      "Macquarie Telecom Group"
    ],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "sydney2",
    "name": "Sydney2",
    "peeringLocation": "Sydney2",
    "environment": "Commercial",
    "geopoliticalRegion": "Oceania",
    "facility": "NextDC S1",
    "facilityUrl": "https://www.nextdc.com/data-centres/s1-sydney-data-centre",
    "zone": "2",
    "localAzureRegions": [
      "Australia East"
    ],
    "erDirectSupported": true,
    "providers": [
      "AARNet",
      "Digital Realty",
      "Internet Association of Australia (IX Australia)",
      "Megaport",
      "NETSG",
      "NextDC"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "taipei",
    "name": "Taipei",
    "peeringLocation": "Taipei",
    "environment": "Commercial",
    "geopoliticalRegion": "Asia",
    "facility": "Chief Telecom",
    "facilityUrl": null,
    "zone": "2",
    "localAzureRegions": [
      "Taiwan North"
    ],
    "erDirectSupported": true,
    "providers": [
      "Chief Telecom",
      "Chunghwa Telecom",
      "FarEasTone"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "taipei2",
    "name": "Taipei2",
    "peeringLocation": "Taipei2",
    "environment": "Commercial",
    "geopoliticalRegion": "Asia",
    "facility": "Chunghwa Telecom",
    "facilityUrl": null,
    "zone": "2",
    "localAzureRegions": [
      "Taiwan North"
    ],
    "erDirectSupported": true,
    "providers": [
      "Chunghwa Telecom",
      "FarEasTone"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "tel-aviv",
    "name": "Tel Aviv",
    "peeringLocation": "Tel Aviv",
    "environment": "Commercial",
    "geopoliticalRegion": "Israel",
    "facility": "Bezeq International",
    "facilityUrl": null,
    "zone": "2",
    "localAzureRegions": [
      "Israel Central"
    ],
    "erDirectSupported": true,
    "providers": [
      "Bezeq International",
      "Cellcom Fixed Line Communication (l.p.)",
      "HOT Telecom"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "tel-aviv2",
    "name": "Tel Aviv2",
    "peeringLocation": "Tel Aviv2",
    "environment": "Commercial",
    "geopoliticalRegion": "Israel",
    "facility": "SDS",
    "facilityUrl": null,
    "zone": "2",
    "localAzureRegions": [
      "Israel Central"
    ],
    "erDirectSupported": true,
    "providers": [
      "Bezeq International",
      "Cellcom Fixed Line Communication (l.p.)"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "tokyo",
    "name": "Tokyo",
    "peeringLocation": "Tokyo",
    "environment": "Commercial",
    "geopoliticalRegion": "Japan",
    "facility": "Equinix TY4",
    "facilityUrl": "https://www.equinix.com/locations/asia-colocation/japan-colocation/tokyo-data-centers/ty4/",
    "zone": "2",
    "localAzureRegions": [
      "Japan East"
    ],
    "erDirectSupported": true,
    "providers": [
      "Aryaka Networks",
      "AT&T NetBond",
      "BBIX",
      "British Telecom",
      "Lumen (CenturyLink Cloud Connect)",
      "Colt",
      "Equinix",
      "Intercloud",
      "Internet Initiative Japan Inc. - IIJ",
      "KDDI",
      "Megaport",
      "NTT DOCOMO BUSINESS",
      "NTT DOCOMO BUSINESS - Flexible Interconnect (NTT Communications - Flexible Interconnect)",
      "NTT EAST",
      "Orange",
      "Softbank",
      "Tata Communications",
      "Verizon </br>"
    ],
    "exchangeProviders": [
      "Equinix"
    ],
    "additionalProviders": [
      "ARTERIA Networks Corporation",
      "BroadBand Tower",
      "Inc."
    ],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "tokyo2",
    "name": "Tokyo2",
    "peeringLocation": "Tokyo2",
    "environment": "Commercial",
    "geopoliticalRegion": "Japan",
    "facility": "AT TOKYO",
    "facilityUrl": "https://www.attokyo.com/",
    "zone": "2",
    "localAzureRegions": [
      "Japan East"
    ],
    "erDirectSupported": true,
    "providers": [
      "AT TOKYO",
      "BBIX",
      "China Telecom Global",
      "China Unicom Global",
      "Colt",
      "Console Connect (PCCW Global Limited)",
      "DE-CIX",
      "Digital Realty",
      "Equinix",
      "Internet Initiative Japan Inc. - IIJ",
      "IPC",
      "IX Reach",
      "KDDI",
      "Megaport",
      "NTT DOCOMO BUSINESS - Flexible Interconnect (NTT Communications - Flexible Interconnect)",
      "Softbank",
      "Tokai Communications"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "tokyo3",
    "name": "Tokyo3",
    "peeringLocation": "Tokyo3",
    "environment": "Commercial",
    "geopoliticalRegion": "Japan",
    "facility": "NEC",
    "facilityUrl": "https://www.nec.com/en/global/solutions/cloud/inzai_datacenter.html",
    "zone": "2",
    "localAzureRegions": [
      "Japan East"
    ],
    "erDirectSupported": true,
    "providers": [
      "BBIX",
      "NEC",
      "SCSK"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "toronto",
    "name": "Toronto",
    "peeringLocation": "Toronto",
    "environment": "Commercial",
    "geopoliticalRegion": "North America",
    "facility": "Cologix TOR1",
    "facilityUrl": "https://www.cologix.com/data-centers/toronto/tor1/",
    "zone": "1",
    "localAzureRegions": [
      "Canada Central"
    ],
    "erDirectSupported": true,
    "providers": [
      "AT&T NetBond",
      "Bell Canada",
      "Lumen (CenturyLink Cloud Connect)",
      "Cologix",
      "Equinix",
      "IX Reach",
      "Megaport",
      "Orange",
      "PacketFabric",
      "Tata Communications",
      "Telus",
      "Verizon",
      "Zayo"
    ],
    "exchangeProviders": [
      "Equinix",
      "Megaport"
    ],
    "additionalProviders": [
      "Airgate Technologies Inc.",
      "Beanfield Metroconnect",
      "Aptum Technologies",
      "IVedha Inc",
      "Oncore Cloud Services Inc.",
      "Rogers",
      "Thinktel",
      "Zirro"
    ],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "toronto2",
    "name": "Toronto2",
    "peeringLocation": "Toronto2",
    "environment": "Commercial",
    "geopoliticalRegion": "North America",
    "facility": "Telehouse (Allied REIT)",
    "facilityUrl": "https://www.telehouse.ca/",
    "zone": "1",
    "localAzureRegions": [
      "Canada Central"
    ],
    "erDirectSupported": true,
    "providers": [
      "Fibrenoire",
      "Megaport",
      "Telus",
      "Zayo"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "vancouver",
    "name": "Vancouver",
    "peeringLocation": "Vancouver",
    "environment": "Commercial",
    "geopoliticalRegion": "North America",
    "facility": "Cologix VAN1",
    "facilityUrl": "https://www.cologix.com/data-centers/vancouver/van1/",
    "zone": "1",
    "localAzureRegions": [],
    "erDirectSupported": true,
    "providers": [
      "Bell Canada",
      "Cologix",
      "Megaport",
      "Telus",
      "Zayo"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "vienna",
    "name": "Vienna",
    "peeringLocation": "Vienna",
    "environment": "Commercial",
    "geopoliticalRegion": "Europe",
    "facility": "Digital Realty VIE1",
    "facilityUrl": "https://www.digitalrealty.com/data-centers/emea/vienna/vie1",
    "zone": "1",
    "localAzureRegions": [],
    "erDirectSupported": true,
    "providers": [
      "A1 Telekom Austria",
      "Conova",
      "Digital Realty",
      "next layer GmbH"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "vienna2",
    "name": "Vienna2",
    "peeringLocation": "Vienna2",
    "environment": "Commercial",
    "geopoliticalRegion": "Europe",
    "facility": "NTT Data VIE1",
    "facilityUrl": "https://services.global.ntt/en-us/services-and-products/global-data-centers/global-locations/emea/vienna-1-data-center",
    "zone": "1",
    "localAzureRegions": [],
    "erDirectSupported": true,
    "providers": [
      "A1 Telekom Austria",
      "Conova",
      "next layer GmbH",
      "NTT Global DataCenters EMEA"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "warsaw",
    "name": "Warsaw",
    "peeringLocation": "Warsaw",
    "environment": "Commercial",
    "geopoliticalRegion": "Europe",
    "facility": "Equinix WA1",
    "facilityUrl": "https://www.equinix.com/data-centers/europe-colocation/poland-colocation/warsaw-data-centers/wa1",
    "zone": "1",
    "localAzureRegions": [
      "Poland Central"
    ],
    "erDirectSupported": true,
    "providers": [
      "1-IX.EU",
      "Equinix",
      "Exatel",
      "Orange",
      "Orange Poland",
      "T-Mobile Poland"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "washington-dc",
    "name": "Washington DC",
    "peeringLocation": "Washington DC",
    "environment": "Commercial",
    "geopoliticalRegion": "North America",
    "facility": "Equinix DC2",
    "facilityUrl": "https://www.equinix.com/locations/americas-colocation/united-states-colocation/washington-dc-data-centers/dc2/)[Equinix DC6](https://www.equinix.com/data-centers/americas-colocation/united-states-colocation/washington-dc-data-centers/dc6",
    "zone": "1",
    "localAzureRegions": [
      "East US",
      "East US 2"
    ],
    "erDirectSupported": true,
    "providers": [
      "Aryaka Networks",
      "AT&T NetBond",
      "AT&T Dynamic Exchange",
      "British Telecom",
      "Lumen (CenturyLink Cloud Connect)",
      "Cogent",
      "Cologix",
      "Colt",
      "Console Connect (PCCW Global Limited)",
      "Comcast",
      "Coresite",
      "Cox Business Cloud Port",
      "Crown Castle",
      "Digital Realty",
      "Equinix",
      "Epsilon Global Communications",
      "Flo Networks",
      "GTT",
      "IPC",
      "Internet2",
      "InterCloud",
      "IPC",
      "Iron Mountain",
      "IX Reach",
      "Lumen (Level 3 Communications)",
      "Lightpath",
      "Megaport",
      "Momentum Telecom",
      "MODMC",
      "NTT DOCOMO BUSINESS",
      "Orange",
      "PacketFabric",
      "PitChile",
      "SES",
      "Sprint",
      "Tata Communications",
      "Arelion (Telia Carrier)",
      "Telefonica",
      "Verizon",
      "Zayo",
      "Zenlayer"
    ],
    "exchangeProviders": [
      "Equinix"
    ],
    "additionalProviders": [
      "Altice Business",
      "BICS",
      "Cox Business",
      "Crown Castle",
      "Gtt Communications Inc",
      "Epsilon Telecommunications Limited",
      "Masergy",
      "Momentum Telecom",
      "Windstream"
    ],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "washington-dc2",
    "name": "Washington DC2",
    "peeringLocation": "Washington DC2",
    "environment": "Commercial",
    "geopoliticalRegion": "North America",
    "facility": "Coresite VA2",
    "facilityUrl": "https://www.coresite.com/data-center/va2-reston-va",
    "zone": "1",
    "localAzureRegions": [
      "East US",
      "East US 2"
    ],
    "erDirectSupported": false,
    "providers": [
      "Lumen (CenturyLink Cloud Connect)",
      "Coresite",
      "Intelsat",
      "Megaport",
      "Momentum Telecom",
      "Viasat",
      "Zayo"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "zurich",
    "name": "Zurich",
    "peeringLocation": "Zurich",
    "environment": "Commercial",
    "geopoliticalRegion": "Europe",
    "facility": "Digital Realty(Interxion) ZUR2",
    "facilityUrl": "https://www.digitalrealty.com/data-centers/emea/zurich/zur2",
    "zone": "1",
    "localAzureRegions": [
      "Switzerland North"
    ],
    "erDirectSupported": true,
    "providers": [
      "Colt",
      "Equinix",
      "Green Datacenter",
      "Intercloud",
      "Interxion (Digital Realty)",
      "Megaport",
      "Swisscom",
      "Zayo"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "zurich2",
    "name": "Zurich2",
    "peeringLocation": "Zurich2",
    "environment": "Commercial",
    "geopoliticalRegion": "Europe",
    "facility": "Equinix ZH5",
    "facilityUrl": "https://www.equinix.com/data-centers/europe-colocation/switzerland-colocation/zurich-data-centers/zh5",
    "zone": "1",
    "localAzureRegions": [
      "Switzerland North"
    ],
    "erDirectSupported": true,
    "providers": [
      "Equinix",
      "Green Datacenter",
      "Swisscom"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "atlanta-metro",
    "name": "Atlanta Metro",
    "peeringLocation": "Atlanta Metro",
    "environment": "Commercial",
    "geopoliticalRegion": "North America",
    "facility": "Equinix AT1 + Digital Realty ATL14 (Metro dual-edge)",
    "facilityUrl": "https://www.equinix.com/data-centers/americas-colocation/united-states-colocation/atlanta-data-centers/at1",
    "zone": "1",
    "localAzureRegions": [],
    "erDirectSupported": true,
    "providers": [
      "AT&T Dynamic Exchange",
      "AT&T NetBond",
      "Digital Realty",
      "Equinix",
      "Lumen (CenturyLink Cloud Connect)",
      "MODMC",
      "Megaport",
      "Momentum Telecom",
      "PacketFabric"
    ],
    "exchangeProviders": [
      "Equinix"
    ],
    "additionalProviders": [
      "Crown Castle",
      "Momentum Telecom"
    ],
    "isMetro": true,
    "metroEdgeSites": [
      "Equinix AT1",
      "Digital Realty ATL14"
    ]
  },
  {
    "id": "chicago-metro",
    "name": "Chicago Metro",
    "peeringLocation": "Chicago Metro",
    "environment": "Commercial",
    "geopoliticalRegion": "North America",
    "facility": "Equinix CH1 + CoreSite CH1 (Metro dual-edge)",
    "facilityUrl": "https://www.equinix.com/locations/americas-colocation/united-states-colocation/chicago-data-centers/ch1/",
    "zone": "1",
    "localAzureRegions": [
      "North Central US"
    ],
    "erDirectSupported": true,
    "providers": [
      "AT&T Dynamic Exchange",
      "AT&T NetBond",
      "Arelion (Telia Carrier)",
      "Aryaka Networks",
      "British Telecom",
      "Cogent",
      "Cologix",
      "Colt",
      "Comcast",
      "Console Connect (PCCW Global Limited)",
      "CoreSite",
      "Coresite",
      "DE-CIX",
      "Equinix",
      "IPC",
      "InterCloud",
      "Internet2",
      "Lightpath",
      "Lumen (CenturyLink Cloud Connect)",
      "Lumen (Level 3 Communications)",
      "Megaport",
      "Momentum Telecom",
      "PacketFabric",
      "Tata Communications",
      "Verizon",
      "Vodafone",
      "Zayo"
    ],
    "exchangeProviders": [
      "Equinix"
    ],
    "additionalProviders": [
      "Crown Castle",
      "Spectrum Enterprise",
      "Windstream"
    ],
    "isMetro": true,
    "metroEdgeSites": [
      "Equinix CH1",
      "CoreSite CH1"
    ]
  },
  {
    "id": "dallas-metro",
    "name": "Dallas Metro",
    "peeringLocation": "Dallas Metro",
    "environment": "Commercial",
    "geopoliticalRegion": "North America",
    "facility": "Equinix DA3 + Digital Realty DFW10 (Metro dual-edge)",
    "facilityUrl": "https://www.equinix.com/locations/americas-colocation/united-states-colocation/dallas-data-centers/da3/)[Equinix DA6](https://www.equinix.com/data-centers/americas-colocation/united-states-colocation/dallas-data-centers/da6",
    "zone": "1",
    "localAzureRegions": [],
    "erDirectSupported": true,
    "providers": [
      "AT&T Connectivity Plus",
      "AT&T Dynamic Exchange",
      "AT&T NetBond",
      "Arelion (Telia Carrier)",
      "Aryaka Networks",
      "BICS",
      "Cologix",
      "Cox Business Cloud Port",
      "Digital Realty",
      "Equinix",
      "Flo Networks",
      "GTT",
      "Intercloud",
      "Internet2",
      "Lumen (Level 3 Communications)",
      "MCM Telecom",
      "Megaport",
      "Momentum Telecom",
      "Orange",
      "PacketFabric",
      "Telefonica",
      "Telmex Uninet",
      "Verizon",
      "Vodafone",
      "Zayo"
    ],
    "exchangeProviders": [
      "Equinix",
      "Megaport"
    ],
    "additionalProviders": [
      "Axtel",
      "C3ntro Telecom",
      "Cox Business",
      "Crown Castle",
      "Data Foundry",
      "Momentum Telecom",
      "Spectrum Enterprise",
      "Transtelco"
    ],
    "isMetro": true,
    "metroEdgeSites": [
      "Equinix DA3",
      "Digital Realty DFW10"
    ]
  },
  {
    "id": "silicon-valley-metro",
    "name": "Silicon Valley Metro",
    "peeringLocation": "Silicon Valley Metro",
    "environment": "Commercial",
    "geopoliticalRegion": "North America",
    "facility": "Equinix SV1 + Coresite SV7 (Metro dual-edge)",
    "facilityUrl": "https://www.equinix.com/locations/americas-colocation/united-states-colocation/silicon-valley-data-centers/sv1/",
    "zone": "1",
    "localAzureRegions": [
      "West US"
    ],
    "erDirectSupported": true,
    "providers": [
      "AT&T Dynamic Exchange",
      "AT&T NetBond",
      "Arelion (Telia Carrier)",
      "Aryaka Networks",
      "British Telecom",
      "China Unicom Global",
      "Cogent",
      "Colt",
      "Comcast",
      "Coresite",
      "Cox Business Cloud Port",
      "Digital Realty",
      "Equinix",
      "IX Reach",
      "InterCloud",
      "Internet2",
      "Lumen (CenturyLink Cloud Connect)",
      "Lumen (Level 3 Communications)",
      "MODMC",
      "Megaport",
      "Momentum Telecom",
      "Orange",
      "Packet",
      "PacketFabric",
      "Tata Communications",
      "Verizon",
      "Vodafone",
      "Zayo"
    ],
    "exchangeProviders": [
      "CoreSite",
      "Equinix",
      "Megaport"
    ],
    "additionalProviders": [
      "Cox Business",
      "Momentum Telecom",
      "Spectrum Enterprise",
      "Windstream",
      "X2nsat Inc."
    ],
    "isMetro": true,
    "metroEdgeSites": [
      "Equinix SV1",
      "Coresite SV7"
    ]
  },
  {
    "id": "toronto-metro",
    "name": "Toronto Metro",
    "peeringLocation": "Toronto Metro",
    "environment": "Commercial",
    "geopoliticalRegion": "North America",
    "facility": "Cologix TOR1 + Telehouse (Allied REIT) (Metro dual-edge)",
    "facilityUrl": "https://www.cologix.com/data-centers/toronto/tor1/",
    "zone": "1",
    "localAzureRegions": [
      "Canada Central"
    ],
    "erDirectSupported": true,
    "providers": [
      "AT&T NetBond",
      "Bell Canada",
      "Cologix",
      "Equinix",
      "Fibrenoire",
      "IX Reach",
      "Lumen (CenturyLink Cloud Connect)",
      "Megaport",
      "Orange",
      "PacketFabric",
      "Tata Communications",
      "Telus",
      "Verizon",
      "Zayo"
    ],
    "exchangeProviders": [
      "Equinix",
      "Megaport"
    ],
    "additionalProviders": [
      "Airgate Technologies Inc.",
      "Beanfield Metroconnect",
      "Aptum Technologies",
      "IVedha Inc",
      "Oncore Cloud Services Inc.",
      "Rogers",
      "Thinktel",
      "Zirro"
    ],
    "isMetro": true,
    "metroEdgeSites": [
      "Cologix TOR1",
      "Telehouse (Allied REIT)"
    ]
  },
  {
    "id": "washington-dc-metro",
    "name": "Washington DC Metro",
    "peeringLocation": "Washington DC Metro",
    "environment": "Commercial",
    "geopoliticalRegion": "North America",
    "facility": "Equinix DC2 + Coresite VA2 (Metro dual-edge)",
    "facilityUrl": "https://www.equinix.com/locations/americas-colocation/united-states-colocation/washington-dc-data-centers/dc2/)[Equinix DC6](https://www.equinix.com/data-centers/americas-colocation/united-states-colocation/washington-dc-data-centers/dc6",
    "zone": "1",
    "localAzureRegions": [
      "East US",
      "East US 2"
    ],
    "erDirectSupported": true,
    "providers": [
      "AT&T Dynamic Exchange",
      "AT&T NetBond",
      "Arelion (Telia Carrier)",
      "Aryaka Networks",
      "British Telecom",
      "Cogent",
      "Cologix",
      "Colt",
      "Comcast",
      "Console Connect (PCCW Global Limited)",
      "Coresite",
      "Cox Business Cloud Port",
      "Crown Castle",
      "Digital Realty",
      "Epsilon Global Communications",
      "Equinix",
      "Flo Networks",
      "GTT",
      "IPC",
      "IX Reach",
      "Intelsat",
      "InterCloud",
      "Internet2",
      "Iron Mountain",
      "Lightpath",
      "Lumen (CenturyLink Cloud Connect)",
      "Lumen (Level 3 Communications)",
      "MODMC",
      "Megaport",
      "Momentum Telecom",
      "NTT DOCOMO BUSINESS",
      "Orange",
      "PacketFabric",
      "PitChile",
      "SES",
      "Sprint",
      "Tata Communications",
      "Telefonica",
      "Verizon",
      "Viasat",
      "Zayo",
      "Zenlayer"
    ],
    "exchangeProviders": [
      "Equinix"
    ],
    "additionalProviders": [
      "Altice Business",
      "BICS",
      "Cox Business",
      "Crown Castle",
      "Gtt Communications Inc",
      "Epsilon Telecommunications Limited",
      "Masergy",
      "Momentum Telecom",
      "Windstream"
    ],
    "isMetro": true,
    "metroEdgeSites": [
      "Equinix DC2",
      "Coresite VA2"
    ]
  },
  {
    "id": "amsterdam-metro",
    "name": "Amsterdam Metro",
    "peeringLocation": "Amsterdam Metro",
    "environment": "Commercial",
    "geopoliticalRegion": "Europe",
    "facility": "Equinix AM5 + Digital Realty(Interxion) AMS8 (Metro dual-edge)",
    "facilityUrl": "https://www.equinix.com/locations/europe-colocation/netherlands-colocation/amsterdam-data-centers/am5/",
    "zone": "1",
    "localAzureRegions": [
      "West Europe"
    ],
    "erDirectSupported": true,
    "providers": [
      "1-IX.EU",
      "AT&T NetBond",
      "Arelion (Telia Carrier)",
      "Aryaka Networks",
      "BICS",
      "British Telecom",
      "China Unicom Global",
      "Cinia",
      "Cogent",
      "Colt",
      "DE-CIX",
      "Deutsche Telekom AG",
      "Digital Realty",
      "Equinix",
      "GlobalConnect",
      "GÉANT",
      "IX Reach",
      "InterCloud",
      "Interxion (Digital Realty)",
      "KPN",
      "Lumen (CenturyLink Cloud Connect)",
      "Lumen (Level 3 Communications)",
      "Megaport",
      "NL-IX",
      "NOS",
      "NTT DOCOMO BUSINESS",
      "NTT Global DataCenters EMEA",
      "Orange",
      "Tata Communications",
      "Telecom Italia Sparkle",
      "Telefonica",
      "Telenor",
      "Verizon",
      "Vodafone",
      "Vorboss",
      "Zayo",
      "euNetworks"
    ],
    "exchangeProviders": [
      "Equinix",
      "Interxion (Digital Realty)",
      "Lumen (Level 3 Communications)"
    ],
    "additionalProviders": [
      "BICS",
      "CloudXpress",
      "Eurofiber",
      "Fastweb S.p.A",
      "Gulf Bridge International",
      "Kalaam Telecom Bahrain B.S.C",
      "MainOne",
      "Nianet",
      "POST Telecom Luxembourg",
      "Proximus",
      "RETN",
      "TDC Erhverv",
      "Telecom Italia Sparkle",
      "Telekom Deutschland GmbH",
      "Telia"
    ],
    "isMetro": true,
    "metroEdgeSites": [
      "Equinix AM5",
      "Digital Realty(Interxion) AMS8"
    ]
  },
  {
    "id": "brussels-metro",
    "name": "Brussels Metro",
    "peeringLocation": "Brussels Metro",
    "environment": "Commercial",
    "geopoliticalRegion": "Europe",
    "facility": "Digital Realty BRU4 + LCL Brussels-North (Metro dual-edge)",
    "facilityUrl": "https://www.digitalrealty.com/data-centers/emea/brussels/bru4",
    "zone": "1",
    "localAzureRegions": [],
    "erDirectSupported": true,
    "providers": [
      "BICS",
      "Digital Realty",
      "Eurofiber"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": true,
    "metroEdgeSites": [
      "Digital Realty BRU4",
      "LCL Brussels-North"
    ]
  },
  {
    "id": "dublin-metro",
    "name": "Dublin Metro",
    "peeringLocation": "Dublin Metro",
    "environment": "Commercial",
    "geopoliticalRegion": "Europe",
    "facility": "Equinix DB3 + Digital Realty(Interxion) DUB2 (Metro dual-edge)",
    "facilityUrl": "https://www.equinix.com/locations/europe-colocation/ireland-colocation/dublin-data-centers/db3/",
    "zone": "1",
    "localAzureRegions": [
      "North Europe"
    ],
    "erDirectSupported": true,
    "providers": [
      "Colt",
      "Console Connect (PCCW Global Limited)",
      "Deutsche Telekom AG",
      "Equinix",
      "GEANT",
      "InterCloud",
      "Interxion (Digital Realty)",
      "KPN",
      "Lumen (CenturyLink Cloud Connect)",
      "Megaport",
      "NL-IX",
      "Orange",
      "Zayo",
      "eir",
      "euNetworks"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": true,
    "metroEdgeSites": [
      "Equinix DB3",
      "Digital Realty(Interxion) DUB2"
    ]
  },
  {
    "id": "frankfurt-metro",
    "name": "Frankfurt Metro",
    "peeringLocation": "Frankfurt Metro",
    "environment": "Commercial",
    "geopoliticalRegion": "Europe",
    "facility": "Digital Realty(Interxion) FRA11 + Equinix FR7 (Metro dual-edge)",
    "facilityUrl": "https://www.digitalrealty.com/data-centers/emea/frankfurt/fra11",
    "zone": "1",
    "localAzureRegions": [
      "Germany West Central"
    ],
    "erDirectSupported": true,
    "providers": [
      "1-IX.EU",
      "AT&T NetBond",
      "Arelion (Telia Carrier)",
      "British Telecom",
      "China Unicom Global",
      "Colt",
      "Console Connect (PCCW Global Limited)",
      "DE-CIX",
      "Deutsche Telekom AG",
      "Equinix",
      "GBI",
      "GEANT",
      "InterCloud",
      "Interxion (Digital Realty)",
      "Lumen (CenturyLink Cloud Connect)",
      "Megaport",
      "NTT Global DataCenters EMEA",
      "Orange",
      "T-Systems",
      "Tata Communications",
      "Telefonica",
      "Verizon",
      "Zayo",
      "Zenlayer",
      "euNetworks",
      "next layer GmbH"
    ],
    "exchangeProviders": [
      "Interxion (Digital Realty)"
    ],
    "additionalProviders": [
      "BICS",
      "Cinia",
      "Equinix",
      "Nianet",
      "QSC AG",
      "Telekom Deutschland GmbH"
    ],
    "isMetro": true,
    "metroEdgeSites": [
      "Digital Realty(Interxion) FRA11",
      "Equinix FR7"
    ]
  },
  {
    "id": "madrid-metro",
    "name": "Madrid Metro",
    "peeringLocation": "Madrid Metro",
    "environment": "Commercial",
    "geopoliticalRegion": "Europe",
    "facility": "Digital Realty(Interxion) MAD1 + Equinix MD2 (Metro dual-edge)",
    "facilityUrl": "https://www.digitalrealty.com/data-centers/emea/madrid/mad1",
    "zone": "1",
    "localAzureRegions": [
      "Spain Central"
    ],
    "erDirectSupported": true,
    "providers": [
      "1-IX.EU",
      "DE-CIX",
      "Equinix",
      "GTT",
      "GÉANT",
      "InterCloud",
      "Intercloud",
      "Interxion (Digital Realty)",
      "Marlink",
      "Megaport",
      "Momentum Telecom",
      "NOS",
      "Telefonica"
    ],
    "exchangeProviders": [
      "Level3"
    ],
    "additionalProviders": [
      "Zertia"
    ],
    "isMetro": true,
    "metroEdgeSites": [
      "Digital Realty(Interxion) MAD1",
      "Equinix MD2"
    ]
  },
  {
    "id": "milan-metro",
    "name": "Milan Metro",
    "peeringLocation": "Milan Metro",
    "environment": "Commercial",
    "geopoliticalRegion": "Europe",
    "facility": "IRIDEOS + DATA4 (Metro dual-edge)",
    "facilityUrl": "https://www.retelit.it/it/infrastrutture/data-center-italia",
    "zone": "1",
    "localAzureRegions": [
      "Italy North"
    ],
    "erDirectSupported": true,
    "providers": [
      "Colt",
      "Equinix",
      "Fastweb",
      "GARR",
      "IRIDEOS",
      "Megaport",
      "Noovle",
      "Orange",
      "Retelit",
      "Telecom Italia Sparkle",
      "Vodafone"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": true,
    "metroEdgeSites": [
      "IRIDEOS",
      "DATA4"
    ]
  },
  {
    "id": "stockholm-metro",
    "name": "Stockholm Metro",
    "peeringLocation": "Stockholm Metro",
    "environment": "Commercial",
    "geopoliticalRegion": "Europe",
    "facility": "Equinix SK1 + Digital Realty STO6 (Metro dual-edge)",
    "facilityUrl": "https://www.equinix.com/locations/europe-colocation/sweden-colocation/stockholm-data-centers/sk1/",
    "zone": "1",
    "localAzureRegions": [
      "Sweden Central"
    ],
    "erDirectSupported": true,
    "providers": [
      "Arelion (Telia Carrier)",
      "Cinia",
      "Digital Realty",
      "Elisa",
      "Equinix",
      "GlobalConnect",
      "Interxion (Digital Realty)",
      "Megaport",
      "Tata Communications"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": true,
    "metroEdgeSites": [
      "Equinix SK1",
      "Digital Realty STO6"
    ]
  },
  {
    "id": "vienna-metro",
    "name": "Vienna Metro",
    "peeringLocation": "Vienna Metro",
    "environment": "Commercial",
    "geopoliticalRegion": "Europe",
    "facility": "Digital Realty VIE1 + NTT Data VIE1 (Metro dual-edge)",
    "facilityUrl": "https://www.digitalrealty.com/data-centers/emea/vienna/vie1",
    "zone": "1",
    "localAzureRegions": [],
    "erDirectSupported": true,
    "providers": [
      "A1 Telekom Austria",
      "Conova",
      "Digital Realty",
      "NTT Global DataCenters EMEA",
      "next layer GmbH"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": true,
    "metroEdgeSites": [
      "Digital Realty VIE1",
      "NTT Data VIE1"
    ]
  },
  {
    "id": "zurich-metro",
    "name": "Zurich Metro",
    "peeringLocation": "Zurich Metro",
    "environment": "Commercial",
    "geopoliticalRegion": "Europe",
    "facility": "Digital Realty(Interxion) ZUR2 + Equinix ZH5 (Metro dual-edge)",
    "facilityUrl": "https://www.digitalrealty.com/data-centers/emea/zurich/zur2",
    "zone": "1",
    "localAzureRegions": [
      "Switzerland North"
    ],
    "erDirectSupported": true,
    "providers": [
      "Colt",
      "Equinix",
      "Green Datacenter",
      "Intercloud",
      "Interxion (Digital Realty)",
      "Megaport",
      "Swisscom",
      "Zayo"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": true,
    "metroEdgeSites": [
      "Digital Realty(Interxion) ZUR2",
      "Equinix ZH5"
    ]
  },
  {
    "id": "jakarta-metro",
    "name": "Jakarta Metro",
    "peeringLocation": "Jakarta Metro",
    "environment": "Commercial",
    "geopoliticalRegion": "Asia",
    "facility": "NeutraDC HDC + NTT Global Data Center Indonesia (Metro dual-edge)",
    "facilityUrl": null,
    "zone": "2",
    "localAzureRegions": [
      "Indonesia Central"
    ],
    "erDirectSupported": true,
    "providers": [
      "DCI Indonesia",
      "DE-CIX",
      "Equinix",
      "NTT DOCOMO BUSINESS - Flexible Interconnect (NTT Communications - Flexible Interconnect)",
      "NTT Indonesia",
      "Telin",
      "XL Axiata",
      "Zenlayer"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": true,
    "metroEdgeSites": [
      "NeutraDC HDC",
      "NTT Global Data Center Indonesia"
    ]
  },
  {
    "id": "taipei-metro",
    "name": "Taipei Metro",
    "peeringLocation": "Taipei Metro",
    "environment": "Commercial",
    "geopoliticalRegion": "Asia",
    "facility": "Chief Telecom + Chunghwa Telecom (Metro dual-edge)",
    "facilityUrl": null,
    "zone": "2",
    "localAzureRegions": [
      "Taiwan North"
    ],
    "erDirectSupported": true,
    "providers": [
      "Chief Telecom",
      "Chunghwa Telecom",
      "FarEasTone"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": true,
    "metroEdgeSites": [
      "Chief Telecom",
      "Chunghwa Telecom"
    ]
  },
  {
    "id": "mumbai-metro",
    "name": "Mumbai Metro",
    "peeringLocation": "Mumbai Metro",
    "environment": "Commercial",
    "geopoliticalRegion": "India",
    "facility": "Tata Communications + Airtel (Metro dual-edge)",
    "facilityUrl": null,
    "zone": "2",
    "localAzureRegions": [
      "West India"
    ],
    "erDirectSupported": true,
    "providers": [
      "Airtel",
      "BSNL",
      "British Telecom",
      "DE-CIX",
      "Equinix",
      "Global CloudXchange (GCX)",
      "InterCloud",
      "Lightstorm",
      "Megaport",
      "NTT Communications India Network Services Pvt Ltd",
      "Orange",
      "Reliance Jio",
      "Sify",
      "Tata Communications",
      "Verizon",
      "Vodafone Idea",
      "Zenlayer"
    ],
    "exchangeProviders": [
      "Tata Communications"
    ],
    "additionalProviders": [
      "Tata Teleservices"
    ],
    "isMetro": true,
    "metroEdgeSites": [
      "Tata Communications",
      "Airtel"
    ]
  },
  {
    "id": "melbourne-metro",
    "name": "Melbourne Metro",
    "peeringLocation": "Melbourne Metro",
    "environment": "Commercial",
    "geopoliticalRegion": "Oceania",
    "facility": "NextDC M1 + Equinix ME1 (Metro dual-edge)",
    "facilityUrl": "https://www.nextdc.com/data-centres/m1-melbourne-data-centre",
    "zone": "2",
    "localAzureRegions": [
      "Australia Southeast"
    ],
    "erDirectSupported": true,
    "providers": [
      "AARNet",
      "Devoli",
      "Equinix",
      "Internet Association of Australia (IX Australia)",
      "Megaport",
      "NETSG",
      "NEXTDC",
      "Optus",
      "Orange",
      "TPG Telecom",
      "Telstra Corporation",
      "Vocus"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": true,
    "metroEdgeSites": [
      "NextDC M1",
      "Equinix ME1"
    ]
  },
  {
    "id": "sydney-metro",
    "name": "Sydney Metro",
    "peeringLocation": "Sydney Metro",
    "environment": "Commercial",
    "geopoliticalRegion": "Oceania",
    "facility": "Equinix SY2 + NextDC S1 (Metro dual-edge)",
    "facilityUrl": "https://www.equinix.com/locations/asia-colocation/australia-colocation/sydney-data-centers/sy2/",
    "zone": "2",
    "localAzureRegions": [
      "Australia East"
    ],
    "erDirectSupported": true,
    "providers": [
      "AARNet",
      "AT&T NetBond",
      "British Telecom",
      "Cello",
      "Console Connect (PCCW Global Limited)",
      "Devoli",
      "Digital Realty",
      "Equinix",
      "GTT",
      "Internet Association of Australia (IX Australia)",
      "Kordia",
      "Lumen (CenturyLink Cloud Connect)",
      "Megaport",
      "NETSG",
      "NEXTDC",
      "NTT DOCOMO BUSINESS",
      "NextDC",
      "Optus",
      "Orange",
      "Spark NZ",
      "TPG Telecom",
      "Telstra Corporation",
      "Verizon",
      "Vocus",
      "Vocus Group NZ"
    ],
    "exchangeProviders": [
      "Megaport"
    ],
    "additionalProviders": [
      "Macquarie Telecom Group"
    ],
    "isMetro": true,
    "metroEdgeSites": [
      "Equinix SY2",
      "NextDC S1"
    ]
  },
  {
    "id": "atlanta-us-gov",
    "name": "Atlanta (US Gov)",
    "peeringLocation": "Atlanta",
    "environment": "US Government",
    "geopoliticalRegion": "US Government cloud",
    "facility": "Equinix AT1",
    "facilityUrl": "https://www.equinix.com/locations/americas-colocation/united-states-colocation/atlanta-data-centers/at1/",
    "zone": "US Gov",
    "localAzureRegions": [],
    "erDirectSupported": true,
    "providers": [
      "Equinix"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "chicago-us-gov",
    "name": "Chicago (US Gov)",
    "peeringLocation": "Chicago",
    "environment": "US Government",
    "geopoliticalRegion": "US Government cloud",
    "facility": "Equinix CH1",
    "facilityUrl": "https://www.equinix.com/locations/americas-colocation/united-states-colocation/chicago-data-centers/ch1/",
    "zone": "US Gov",
    "localAzureRegions": [],
    "erDirectSupported": true,
    "providers": [
      "AT&T NetBond",
      "British Telecom",
      "Equinix",
      "Lumen (Level 3 Communications)",
      "Verizon"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "dallas-us-gov",
    "name": "Dallas (US Gov)",
    "peeringLocation": "Dallas",
    "environment": "US Government",
    "geopoliticalRegion": "US Government cloud",
    "facility": "Equinix DA3",
    "facilityUrl": "https://www.equinix.com/locations/americas-colocation/united-states-colocation/dallas-data-centers/da3/",
    "zone": "US Gov",
    "localAzureRegions": [],
    "erDirectSupported": true,
    "providers": [
      "Equinix",
      "Internet2",
      "Megaport",
      "Verizon"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "new-york-us-gov",
    "name": "New York (US Gov)",
    "peeringLocation": "New York",
    "environment": "US Government",
    "geopoliticalRegion": "US Government cloud",
    "facility": "Equinix NY5",
    "facilityUrl": "https://www.equinix.com/locations/americas-colocation/united-states-colocation/new-york-data-centers/ny5/",
    "zone": "US Gov",
    "localAzureRegions": [],
    "erDirectSupported": true,
    "providers": [
      "Equinix",
      "Lumen (CenturyLink Cloud Connect)",
      "Verizon"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "phoenix-us-gov",
    "name": "Phoenix (US Gov)",
    "peeringLocation": "Phoenix",
    "environment": "US Government",
    "geopoliticalRegion": "US Government cloud",
    "facility": "CyrusOne Chandler",
    "facilityUrl": "https://www.cyrusone.com/data-centers/north-america/chandler-arizona",
    "zone": "US Gov",
    "localAzureRegions": [
      "US Gov Arizona"
    ],
    "erDirectSupported": true,
    "providers": [
      "AT&T NetBond",
      "Lumen (CenturyLink Cloud Connect)",
      "Megaport"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "san-antonio-us-gov",
    "name": "San Antonio (US Gov)",
    "peeringLocation": "San Antonio",
    "environment": "US Government",
    "geopoliticalRegion": "US Government cloud",
    "facility": "CyrusOne SA2",
    "facilityUrl": "https://www.cyrusone.com/data-centers/north-america/texas/sat2-san-antonio",
    "zone": "US Gov",
    "localAzureRegions": [
      "US Gov Texas"
    ],
    "erDirectSupported": true,
    "providers": [
      "Lumen (CenturyLink Cloud Connect)",
      "Megaport"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "silicon-valley-us-gov",
    "name": "Silicon Valley (US Gov)",
    "peeringLocation": "Silicon Valley",
    "environment": "US Government",
    "geopoliticalRegion": "US Government cloud",
    "facility": "Equinix SV4",
    "facilityUrl": "https://www.equinix.com/locations/americas-colocation/united-states-colocation/silicon-valley-data-centers/sv4/",
    "zone": "US Gov",
    "localAzureRegions": [],
    "erDirectSupported": true,
    "providers": [
      "AT&T",
      "Equinix",
      "Lumen (Level 3 Communications)",
      "Verizon"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "seattle-us-gov",
    "name": "Seattle (US Gov)",
    "peeringLocation": "Seattle",
    "environment": "US Government",
    "geopoliticalRegion": "US Government cloud",
    "facility": "Equinix SE2",
    "facilityUrl": "https://www.equinix.com/locations/americas-colocation/united-states-colocation/seattle-data-centers/se2/",
    "zone": "US Gov",
    "localAzureRegions": [],
    "erDirectSupported": true,
    "providers": [
      "Equinix",
      "Megaport"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "washington-dc-us-gov",
    "name": "Washington DC (US Gov)",
    "peeringLocation": "Washington DC",
    "environment": "US Government",
    "geopoliticalRegion": "US Government cloud",
    "facility": "Equinix DC2",
    "facilityUrl": "https://www.equinix.com/locations/americas-colocation/united-states-colocation/washington-dc-data-centers/dc2/",
    "zone": "US Gov",
    "localAzureRegions": [
      "US DoD East",
      "US Gov Virginia"
    ],
    "erDirectSupported": true,
    "providers": [
      "AT&T NetBond",
      "Lumen (CenturyLink Cloud Connect)",
      "Equinix",
      "Lumen (Level 3 Communications)",
      "Megaport",
      "Verizon"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "beijing",
    "name": "Beijing",
    "peeringLocation": "Beijing",
    "environment": "China",
    "geopoliticalRegion": "China North",
    "facility": "China Telecom",
    "facilityUrl": null,
    "zone": "China",
    "localAzureRegions": [],
    "erDirectSupported": true,
    "providers": [
      "China Telecom"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "beijing2",
    "name": "Beijing2",
    "peeringLocation": "Beijing2",
    "environment": "China",
    "geopoliticalRegion": "China North",
    "facility": "GDS",
    "facilityUrl": null,
    "zone": "China",
    "localAzureRegions": [],
    "erDirectSupported": true,
    "providers": [
      "China Telecom",
      "China Mobile",
      "China Unicom",
      "GDS"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "shanghai",
    "name": "Shanghai",
    "peeringLocation": "Shanghai",
    "environment": "China",
    "geopoliticalRegion": "China East",
    "facility": "China Telecom",
    "facilityUrl": null,
    "zone": "China",
    "localAzureRegions": [],
    "erDirectSupported": true,
    "providers": [
      "China Telecom"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  },
  {
    "id": "shanghai2",
    "name": "Shanghai2",
    "peeringLocation": "Shanghai2",
    "environment": "China",
    "geopoliticalRegion": "China East",
    "facility": "GDS",
    "facilityUrl": null,
    "zone": "China",
    "localAzureRegions": [],
    "erDirectSupported": true,
    "providers": [
      "China Mobile",
      "China Telecom",
      "China Unicom",
      "GDS"
    ],
    "exchangeProviders": [],
    "additionalProviders": [],
    "isMetro": false,
    "metroEdgeSites": null
  }
]

export const ER_SATELLITE_OPERATORS = ['Intelsat', 'SES', 'Viasat', 'Marlink'] as const

const REGION_CANONICAL_ALIASES: Record<string, string> = {
  'eastus': 'East US',
  'eastus2': 'East US 2',
  'westus': 'West US',
  'westus2': 'West US 2',
  'westus3': 'West US 3',
  'centralus': 'Central US',
  'northcentralus': 'North Central US',
  'southcentralus': 'South Central US',
  'westcentralus': 'West Central US',
  'canadacentral': 'Canada Central',
  'canadaeast': 'Canada East',
  'mexicocentral': 'Mexico Central',
  'brazilsouth': 'Brazil South',
  'brazilsoutheast': 'Brazil South',
  'chilecentral': 'Brazil South',
  'westeurope': 'West Europe',
  'northeurope': 'North Europe',
  'uksouth': 'UK South',
  'ukwest': 'UK West',
  'francecentral': 'France Central',
  'francesouth': 'France South',
  'germanywestcentral': 'Germany West Central',
  'germanynorth': 'Germany North',
  'swedencentral': 'Sweden Central',
  'switzerlandnorth': 'Switzerland North',
  'switzerlandwest': 'Switzerland West',
  'norwayeast': 'Norway East',
  'norwaywest': 'Norway West',
  'italynorth': 'Italy North',
  'spaincentral': 'Spain Central',
  'polandcentral': 'Poland Central',
  'austriaeast': 'Austria East',
  'belgiumcentral': 'Belgium Central',
  'denmarkeast': 'Denmark East',
  'eastasia': 'East Asia',
  'southeastasia': 'Southeast Asia',
  'malaysiawest': 'Malaysia West',
  'taiwannorth': 'Taiwan North',
  'indonesiacentral': 'Indonesia Central',
  'japaneast': 'Japan East',
  'japanwest': 'Japan West',
  'koreacentral': 'Korea Central',
  'koreasouth': 'Korea South',
  'centralindia': 'India Central',
  'indiacentral': 'India Central',
  'southindia': 'India South',
  'indiasouth': 'India South',
  'westindia': 'India West',
  'indiawest': 'India West',
  'australiaeast': 'Australia East',
  'australiasoutheast': 'Australia Southeast',
  'australiacentral': 'Australia Central',
  'australiacentral2': 'Australia Central 2',
  'newzealandnorth': 'New Zealand North',
  'uaenorth': 'UAE North',
  'uaecentral': 'UAE Central',
  'qatarcentral': 'Qatar Central',
  'israelcentral': 'Israel Central',
  'southafricanorth': 'South Africa North',
  'southafricawest': 'South Africa West',
  'usgovvirginia': 'US Gov Virginia',
  'usgovarizona': 'US Gov Arizona',
  'usgovtexas': 'US Gov Texas',
  'usdodeast': 'US DoD East',
  'usdodcentral': 'US DoD Central',
  'chinaeast': 'China East',
  'chinaeast2': 'China East 2',
  'chinanorth': 'China North',
  'chinanorth2': 'China North 2',
  'chinanorth3': 'China North 3',
}

export function normalizeAzureRegionName(region: string | undefined | null): string {
  if (typeof region !== 'string') return ''
  const trimmed = region.trim()
  if (!trimmed) return ''
  const compact = trimmed.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (REGION_CANONICAL_ALIASES[compact]) {
    return REGION_CANONICAL_ALIASES[compact]
  }
  return trimmed
}

export function getGeopoliticalRegionForAzureRegion(azureRegion: string | undefined | null): string | null {
  const canonical = normalizeAzureRegionName(azureRegion)
  if (!canonical) return null
  const lower = canonical.toLowerCase()
  for (const [geo, regions] of Object.entries(ER_GEOPOLITICAL_AZURE_REGIONS)) {
    if (regions.some((r) => r.toLowerCase() === lower)) {
      return geo
    }
  }
  return null
}

/**
 * Resolves an ExpressRoute peering location string (e.g. "Frankfurt", "Amsterdam", "London",
 * "Frankfurt (DE-CIX / Equinix FR5)", "Ashburn / Washington DC") to a catalog entry.
 */
export function findErPeeringLocationEntry(locationQuery: string | undefined | null): ErPeeringLocationEntry | null {
  if (!locationQuery) return null
  const raw = locationQuery.trim()
  if (!raw) return null
  const lower = raw.toLowerCase()

  // Exact match on name, peeringLocation, or id
  const exact = ER_PEERING_LOCATIONS_CATALOG.find(
    (entry) =>
      entry.name.toLowerCase() === lower ||
      entry.peeringLocation.toLowerCase() === lower ||
      entry.id.toLowerCase() === lower,
  )
  if (exact) return exact

  // Common city/facility aliases used in existing topology presets
  const aliasMap: Record<string, string> = {
    'ashburn': 'Washington DC',
    'reston': 'Washington DC2',
    'dc': 'Washington DC',
    'washington': 'Washington DC',
    'nyc': 'New York',
    'hong kong': 'Hong Kong SAR',
    'hong kong2': 'Hong Kong SAR2',
    'queretaro': 'Queretaro (Mexico)',
    'newport': 'Newport(Wales)',
    'wales': 'Newport(Wales)',
  }
  for (const [alias, target] of Object.entries(aliasMap)) {
    if (lower === alias || lower.startsWith(alias + ' ') || lower.includes(alias)) {
      const aliased = ER_PEERING_LOCATIONS_CATALOG.find((e) => e.name.toLowerCase() === target.toLowerCase())
      if (aliased) return aliased
    }
  }

  // Strip parenthetical suffixes like "Frankfurt (Equinix FR5)" -> "Frankfurt"
  const baseName = raw.replace(/\s*\(.*?\)\s*/g, '').trim().toLowerCase()
  if (baseName) {
    const byBase = ER_PEERING_LOCATIONS_CATALOG.find(
      (entry) => entry.name.toLowerCase() === baseName || entry.peeringLocation.toLowerCase() === baseName,
    )
    if (byBase) return byBase
  }

  // Substring match against catalog names (longest name first so "Frankfurt2" beats "Frankfurt")
  const sorted = [...ER_PEERING_LOCATIONS_CATALOG].sort((a, b) => b.name.length - a.name.length)
  for (const entry of sorted) {
    const entryLower = entry.name.toLowerCase()
    if (lower.includes(entryLower) || (lower.length >= 4 && entryLower.startsWith(lower))) {
      return entry
    }
  }

  return null
}

export interface ErSkuCompatibilityResult {
  allowed: boolean
  sku: ErCircuitSku
  peeringLocation: string
  peeringEntry: ErPeeringLocationEntry | null
  targetAzureRegion: string
  normalizedAzureRegion: string
  peeringGeopoliticalRegion: string | null
  targetGeopoliticalRegion: string | null
  reason: string
}

/**
 * Evaluates whether an ExpressRoute circuit with the given SKU (`Local`, `Standard`, or `Premium`)
 * at `peeringLocation` is allowed to connect to an Azure Gateway / Virtual Hub in `targetAzureRegion`.
 */
export function evaluateErSkuRegionalCompatibility(
  sku: ErCircuitSku | undefined,
  peeringLocation: string | undefined,
  targetAzureRegion: string | undefined,
): ErSkuCompatibilityResult {
  const effectiveSku: ErCircuitSku = sku ?? 'Standard'
  const entry = findErPeeringLocationEntry(peeringLocation)
  const normalizedTarget = normalizeAzureRegionName(targetAzureRegion)
  const targetGeo = getGeopoliticalRegionForAzureRegion(normalizedTarget)
  const peeringGeo = entry?.geopoliticalRegion ?? null

  if (!normalizedTarget || !entry) {
    return {
      allowed: true,
      sku: effectiveSku,
      peeringLocation: peeringLocation ?? 'Unknown',
      peeringEntry: entry,
      targetAzureRegion: targetAzureRegion ?? 'Unknown',
      normalizedAzureRegion: normalizedTarget,
      peeringGeopoliticalRegion: peeringGeo,
      targetGeopoliticalRegion: targetGeo,
      reason: 'Peering location or target Azure region is custom/unspecified; connectivity permitted.',
    }
  }

  // National cloud boundary check (always isolated even with Premium)
  if (
    (entry.environment === 'US Government' && targetGeo !== 'US Government cloud') ||
    (entry.environment !== 'US Government' && targetGeo === 'US Government cloud') ||
    (entry.environment === 'China' && targetGeo !== 'China East' && targetGeo !== 'China North') ||
    (entry.environment !== 'China' && (targetGeo === 'China East' || targetGeo === 'China North'))
  ) {
    return {
      allowed: false,
      sku: effectiveSku,
      peeringLocation: entry.name,
      peeringEntry: entry,
      targetAzureRegion: targetAzureRegion ?? normalizedTarget,
      normalizedAzureRegion: normalizedTarget,
      peeringGeopoliticalRegion: peeringGeo,
      targetGeopoliticalRegion: targetGeo,
      reason: `National cloud isolation: ExpressRoute location '${entry.name}' (${entry.environment}) cannot connect to '${normalizedTarget}' (${targetGeo ?? 'Commercial'}).`,
    }
  }

  if (effectiveSku === 'Local') {
    if (entry.localAzureRegions.length === 0) {
      return {
        allowed: false,
        sku: 'Local',
        peeringLocation: entry.name,
        peeringEntry: entry,
        targetAzureRegion: targetAzureRegion ?? normalizedTarget,
        normalizedAzureRegion: normalizedTarget,
        peeringGeopoliticalRegion: peeringGeo,
        targetGeopoliticalRegion: targetGeo,
        reason: `ExpressRoute Local is not supported at peering location '${entry.name}' (Local Azure regions: ✗). Use Standard or Premium SKU.`,
      }
    }
    const isLocalMatch = entry.localAzureRegions.some(
      (r) => r.toLowerCase() === normalizedTarget.toLowerCase(),
    )
    if (!isLocalMatch) {
      return {
        allowed: false,
        sku: 'Local',
        peeringLocation: entry.name,
        peeringEntry: entry,
        targetAzureRegion: targetAzureRegion ?? normalizedTarget,
        normalizedAzureRegion: normalizedTarget,
        peeringGeopoliticalRegion: peeringGeo,
        targetGeopoliticalRegion: targetGeo,
        reason: `ExpressRoute Local at '${entry.name}' only reaches local Azure region(s) [${entry.localAzureRegions.join(', ')}], not '${normalizedTarget}'. Upgrade circuit SKU to Standard or Premium.`,
      }
    }
    return {
      allowed: true,
      sku: 'Local',
      peeringLocation: entry.name,
      peeringEntry: entry,
      targetAzureRegion: targetAzureRegion ?? normalizedTarget,
      normalizedAzureRegion: normalizedTarget,
      peeringGeopoliticalRegion: peeringGeo,
      targetGeopoliticalRegion: targetGeo,
      reason: `ExpressRoute Local at '${entry.name}' is co-located with local Azure region '${normalizedTarget}'.`,
    }
  }

  if (effectiveSku === 'Standard') {
    if (!targetGeo || !peeringGeo) {
      return {
        allowed: true,
        sku: 'Standard',
        peeringLocation: entry.name,
        peeringEntry: entry,
        targetAzureRegion: targetAzureRegion ?? normalizedTarget,
        normalizedAzureRegion: normalizedTarget,
        peeringGeopoliticalRegion: peeringGeo,
        targetGeopoliticalRegion: targetGeo,
        reason: `ExpressRoute Standard connectivity permitted.`,
      }
    }
    const sameGeo =
      peeringGeo.toLowerCase() === targetGeo.toLowerCase() ||
      (peeringGeo === 'Middle East & Africa' &&
        ['UAE', 'Qatar', 'Israel', 'South Africa', 'Middle East & Africa'].includes(targetGeo))
    if (!sameGeo) {
      return {
        allowed: false,
        sku: 'Standard',
        peeringLocation: entry.name,
        peeringEntry: entry,
        targetAzureRegion: targetAzureRegion ?? normalizedTarget,
        normalizedAzureRegion: normalizedTarget,
        peeringGeopoliticalRegion: peeringGeo,
        targetGeopoliticalRegion: targetGeo,
        reason: `ExpressRoute Standard at '${entry.name}' (${peeringGeo}) cannot connect across geopolitical regions to '${normalizedTarget}' (${targetGeo}). Enable ExpressRoute Premium SKU for global connectivity.`,
      }
    }
    return {
      allowed: true,
      sku: 'Standard',
      peeringLocation: entry.name,
      peeringEntry: entry,
      targetAzureRegion: targetAzureRegion ?? normalizedTarget,
      normalizedAzureRegion: normalizedTarget,
      peeringGeopoliticalRegion: peeringGeo,
      targetGeopoliticalRegion: targetGeo,
      reason: `ExpressRoute Standard at '${entry.name}' reaches '${normalizedTarget}' within geopolitical region '${peeringGeo}'.`,
    }
  }

  // Premium SKU allows global connectivity across all geopolitical regions within the same cloud environment
  return {
    allowed: true,
    sku: 'Premium',
    peeringLocation: entry.name,
    peeringEntry: entry,
    targetAzureRegion: targetAzureRegion ?? normalizedTarget,
    normalizedAzureRegion: normalizedTarget,
    peeringGeopoliticalRegion: peeringGeo,
    targetGeopoliticalRegion: targetGeo,
    reason: `ExpressRoute Premium at '${entry.name}' provides global connectivity across geopolitical regions to '${normalizedTarget}'.`,
  }
}

export const ALL_KNOWN_AZURE_REGIONS: string[] = Array.from(
  new Set(Object.values(ER_GEOPOLITICAL_AZURE_REGIONS).flat()),
).sort((a, b) => a.localeCompare(b))
