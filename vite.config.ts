import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const isAzureNetMode = process.env.VITE_APP_MODE === 'azure-net'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [
    react(),
    ...(isAzureNetMode
      ? [
          {
            name: 'aznet-html-metadata',
            transformIndexHtml(html: string) {
              return html
                .replace('<title>Virtual WAN Topology Lab</title>', '<title>AzNet Simulator</title>')
                .replace(
                  'content="Design and visualize Azure Virtual WAN topologies, inspect effective routes, and trace Azure-to-on-premises flows."',
                  'content="Simulate Azure VNet, Hub-and-Spoke, Route Server (ASN 65515), Azure Firewall, UDR, Private Endpoint, ExpressRoute, VPN, and Virtual WAN routing and forwarding paths."',
                )
                .replace('content="#2568d7"', 'content="#0f766e"')
                .replace(
                  'href="https://vwan-simulator.com/"',
                  'href="https://gray-wave-0e5ecfd03.3.azurestaticapps.net/"',
                )
                .replace('content="Virtual WAN Topology Lab"', 'content="AzNet Simulator"')
                .replace(
                  /content="Virtual WAN Topology Lab — Azure Virtual WAN Routing Simulator"/g,
                  'content="AzNet Simulator — Azure VNet & Hybrid Routing Lab"',
                )
                .replace(
                  /content="Design and visualize Azure Virtual WAN topologies, inspect effective BGP routes and route maps, validate Secured vHub Routing Intent, and trace Azure-to-on-premises flows\."/g,
                  'content="Simulate Hub-and-Spoke VNets, UDRs, Azure Route Server (ASN 65515), NVA/Firewall symmetry, Private Endpoint /32 overrides, ExpressRoute MSEE, and hybrid routing."',
                )
                .replace(
                  'content="https://vwan-simulator.com/"',
                  'content="https://gray-wave-0e5ecfd03.3.azurestaticapps.net/"',
                )
                .replace(
                  /content="https:\/\/vwan-simulator\.com\/og-image\.png"/g,
                  'content="https://gray-wave-0e5ecfd03.3.azurestaticapps.net/og-image-aznet.png"',
                )
                .replace(
                  /content="Virtual WAN Topology Lab preview[^"]*"/g,
                  'content="AzNet Simulator preview showing Hub-and-Spoke Azure VNets, Route Server, Firewall, UDRs, Private Endpoints, and effective routes."',
                )
                .replace(/href="(\.?\/)favicon\.svg"/, 'href="$1favicon-aznet.svg"')
            },
          },
        ]
      : []),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalized = id.replace(/\\/g, '/')
          if (normalized.includes('node_modules')) return 'vendor'
          if (normalized.includes('/src/i18n.ts')) return 'i18n'
          if (
            normalized.includes('/src/AzureFilesPanel.tsx') ||
            normalized.includes('/src/AzureComparisonPanel.tsx') ||
            normalized.includes('/src/azure-bicep.ts') ||
            normalized.includes('/src/azure-import.ts') ||
            normalized.includes('/src/azure-comparison.ts') ||
            normalized.includes('/src/collector-script.ts')
          ) {
            return 'azure-tools'
          }
          if (
            normalized.includes('/src/DiagnosticsPanel.tsx') ||
            normalized.includes('/src/RoutingIssuesPanel.tsx') ||
            normalized.includes('/src/RouteInspector.tsx') ||
            normalized.includes('/src/RouteMapsPanel.tsx') ||
            normalized.includes('/src/RouteMapInspector.tsx') ||
            normalized.includes('/src/StaticRoutingPanel.tsx') ||
            normalized.includes('/src/VpnRoutingWizard.tsx')
          ) {
            return 'inspector-panels'
          }
        },
      },
    },
  },
})
