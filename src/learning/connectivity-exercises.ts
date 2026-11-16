import { createEmptyAzNetTopology } from '../azure-net/model'
import type { PacketRequirement } from '../platform/contract'
import type { Exercise } from './exercises'

const owner = { kind: 'vnet' as const, id: 'network' }
const server = { workloadId: 'server', nicId: 'server-nic', ipConfigurationId: 'server-ip' }
function network(name: string) {
  const topology = createEmptyAzNetTopology()
  topology.name = name
  topology.vnets = [{ id: owner.id, name: 'Application network', role: 'standalone', region: 'westeurope', prefixes: ['10.1.0.0/16'],
    subnets: [{ id: 'app', name: 'Application', prefix: '10.1.1.0/24', defaultOutboundAccess: false },
      { id: 'frontend', name: 'Frontend', prefix: '10.1.2.0/24', defaultOutboundAccess: false }], gateways: [], appliances: [] }]
  topology.inventory = { publicIps: [], workloads: [{ id: 'server', name: 'Application server', nicIds: ['server-nic'] },
    { id: 'client', name: 'Private client', nicIds: ['client-nic'] }],
    nics: [{ id: 'server-nic', name: 'Server NIC', owner, ipConfigurations: [{ id: 'server-ip', name: 'Primary', subnetId: 'app', privateIp: '10.1.1.4', primary: true }] },
      { id: 'client-nic', name: 'Client NIC', owner, ipConfigurations: [{ id: 'client-ip', name: 'Primary', subnetId: 'frontend', privateIp: '10.1.2.5', primary: true }] }],
    networkSecurityGroups: [{ id: 'backend-nsg', name: 'Backend NSG', rules: [] }],
    nsgAssociations: [{ owner, target: { kind: 'nic', id: 'server-nic' }, nsgId: 'backend-nsg' }] }
  return { mode: 'full' as const, topology }
}
function publicIp(document: ReturnType<typeof network>) {
  document.topology.inventory!.publicIps.push({ id: 'public', name: 'Service public IP', sku: 'Standard', allocation: 'Static', address: '20.40.50.60' })
}
function nat(document: ReturnType<typeof network>) {
  publicIp(document)
  document.topology.inventory!.natGateways = [{ id: 'nat', name: 'Standard NAT Gateway', sku: 'Standard', owner, subnetIds: ['app'], publicIpIds: ['public'] }]
}
function webRule(port: number) {
  return { id: 'allow-web', name: 'AllowDeclaredClient', priority: 110, direction: 'inbound' as const, action: 'allow' as const,
    protocol: 'tcp' as const, sources: ['8.8.8.8/32'], destinations: ['10.1.1.4'], sourcePorts: ['*'], destinationPorts: [String(port)] }
}
function lb(internal: boolean) {
  const document = network(internal ? 'Internal LB backend practice' : 'Probe and client data practice')
  if (!internal) { publicIp(document); document.topology.inventory!.networkSecurityGroups![0].rules.push(webRule(8443)) }
  document.topology.inventory!.loadBalancers = [{ id: 'lb', name: 'Application LB', sku: 'Standard', owner,
    frontends: [internal ? { id: 'lb-front', name: 'Internal', kind: 'private', subnetId: 'frontend', privateIp: '10.1.2.10' }
      : { id: 'lb-front', name: 'Public', kind: 'public', publicIpId: 'public' }],
    pools: [{ id: 'pool', name: 'Original servers', members: [server] }],
    probes: [{ id: 'probe', name: 'TCP health', protocol: 'tcp', port: 8080, health: [{ target: server, status: internal ? 'unknown' : 'healthy' }] }],
    rules: [{ id: 'web', name: 'Web', frontendId: 'lb-front', poolId: 'pool', probeId: 'probe', protocol: 'tcp',
      frontendPort: 443, backendPort: 8443, disableOutboundSnat: true }], inboundNatRules: [], outboundRules: [] }]
  return document
}
function ingressGoal(id = 'configured-ingress', client = '8.8.8.8', expectation: PacketRequirement['expectation'] = 'configured'): PacketRequirement {
  return { id, kind: 'packet', sourceAddress: client, destinationAddress: '20.40.50.60', expectation,
    requiredBackend: { ...server, address: '10.1.1.4' }, packet: { source: { kind: 'external', address: client },
      target: { kind: 'public-ip', publicIpId: 'public' }, protocol: 'tcp', sourcePort: 49152, destinationPort: 443 } }
}
const egressGoal: PacketRequirement = { id: 'explicit-egress', kind: 'packet', sourceAddress: '10.1.1.4', destinationAddress: '8.8.8.8', expectation: 'configured',
  packet: { source: { kind: 'workload', ...server }, target: { kind: 'external', address: '8.8.8.8' }, protocol: 'tcp', sourcePort: 49152, destinationPort: 443 } }
const noEgress = network('Private subnet without an outbound method')
const routedNat = network('A UDR wins over NAT Gateway')
nat(routedNat)
routedNat.topology.vnets[0].subnets[0].routeTableId = 'drop'
routedNat.topology.udrTables.push({ id: 'drop', name: 'Selected default route', disableBgpRoutePropagation: false,
  routes: [{ id: 'default', name: 'Drop Internet', prefix: '0.0.0.0/0', nextHopType: 'None', enabled: true }] })
const probeData = lb(false)
probeData.topology.inventory!.networkSecurityGroups![0].rules.push({ id: 'deny-probe', name: 'ProbeDenied', priority: 100,
  direction: 'inbound', action: 'deny', protocol: 'tcp', sources: ['AzureLoadBalancer'], destinations: ['*'], sourcePorts: ['*'], destinationPorts: ['8080'] })
const directIngress = network('Public IP without an ingress allow')
publicIp(directIngress)
directIngress.topology.inventory!.nics[0].ipConfigurations[0].publicIpId = 'public'
const asymmetric = network('Original NVA DNAT response')
publicIp(asymmetric)
asymmetric.topology.vnets[0].appliances.push({ id: 'router', name: 'Original NVA', kind: 'nva-vm', subnetId: 'frontend',
  privateIp: '10.1.2.4', enableIpForwarding: true, staticRoutes: [] })
asymmetric.topology.inventory!.workloads.push({ id: 'router-vm', name: 'NVA VM', nicIds: ['router-nic'], backingDeviceId: 'router' })
asymmetric.topology.inventory!.nics.push({ id: 'router-nic', name: 'NVA NIC', owner,
  ipConfigurations: [{ id: 'router-ip', name: 'Primary', subnetId: 'frontend', privateIp: '10.1.2.4', primary: true }] })
asymmetric.topology.inventory!.networkSecurityGroups![0].rules.push(webRule(8443))
asymmetric.topology.inventory!.networkSecurityGroups!.push({ id: 'router-nsg', name: 'NVA interface NSG', rules: [{
  ...webRule(443), id: 'allow-router', destinations: ['10.1.2.4'],
}, { ...webRule(8443), id: 'allow-forwarded-client', name: 'AllowForwardedClient', direction: 'outbound' }] })
asymmetric.topology.inventory!.nsgAssociations!.push({ owner, target: { kind: 'nic', id: 'router-nic' }, nsgId: 'router-nsg' })
asymmetric.topology.inventory!.routerDnatPolicies = [{ owner: { kind: 'appliance', id: 'router' }, kind: 'nva-dnat', sourceTranslation: 'preserve',
  publicIpIds: ['public'], rules: [{ id: 'dnat-web', name: 'Original web mapping', priority: 100, protocol: 'tcp', sourcePrefixes: ['8.8.8.8/32'],
    publicIpId: 'public', frontendPort: 443, target: server, translatedPort: 8443 }] }]
const internal = lb(true)

export const connectivityExercises: Exercise[] = [
  {
    id: 'private-explicit-egress', version: 1, title: { en: 'Give a private subnet explicit egress', ja: 'プライベート サブネットに明示的な送信経路を追加' },
    objective: { en: 'Model an explicit supported outbound method for server/server-nic/server-ip (10.1.1.4) to 8.8.8.8:443. Preserve original IDs and addresses. The starter subnet has defaultOutboundAccess=false. A NAT Gateway, supported instance public IP or public LB outbound declaration may satisfy this configuration goal; no live session or application readiness is certified.', ja: 'server/server-nic/server-ip（10.1.1.4）から 8.8.8.8:443 への明示的でサポートされる送信方法をモデル化してください。元の ID とアドレスを維持します。開始時のサブネットは defaultOutboundAccess=false です。NAT Gateway、インスタンスのパブリック IP、パブリック LB の送信宣言などで構成要件を満たせます。実際のセッションやアプリの準備状態は認証しません。' },
    requirements: [egressGoal], concepts: ['selection', 'coverage'], prerequisites: [],
    hints: [{ en: 'An Internet route and outbound NSG allow do not allocate a translated public address.', ja: 'Internet ルートと送信 NSG の許可だけでは変換後のパブリック アドレスは割り当てられません。' },
      { en: 'Associate a Standard NAT Gateway with app and a declared Standard static public allocation, or use another supported explicit method.', ja: 'app に Standard NAT Gateway と宣言済みの Standard 静的パブリック割り当てを関連付けるか、別のサポートされる明示的な方法を使います。' }],
    starter: noEgress,
  },
  {
    id: 'udr-before-nat', version: 1, title: { en: 'Repair a route before changing NAT', ja: 'NAT を変える前にルートを修復' },
    objective: { en: 'The original NAT Gateway/public allocation is present, but a selected default UDR drops the same server flow. Restore supported explicit egress without changing bound IDs or addresses. NAT must not override a route.', ja: '元の NAT Gateway とパブリック割り当ては存在しますが、選択された既定 UDR がサーバーのフローを破棄します。固定された ID とアドレスを変えずに明示的な送信を復元してください。NAT はルートを上書きできません。' },
    requirements: [egressGoal], concepts: ['selection', 'coverage'], prerequisites: ['private-explicit-egress'],
    hints: [{ en: 'Inspect the application subnet route table before changing the public address.', ja: 'パブリック アドレスを変える前に、アプリ サブネットのルート テーブルを確認してください。' },
      { en: 'Remove/disable the drop or explicitly select a supported Internet route; the source-subnet NAT method applies only after route selection.', ja: '破棄ルートを削除または無効化するか、サポートされる Internet ルートを選択します。送信元サブネットの NAT はルート選択後にのみ適用されます。' }],
    starter: routedNat,
  },
  {
    id: 'lb-probe-data-nsg', version: 1, title: { en: 'Separate LB probe and client permission', ja: 'LB プローブとクライアントの許可を分離' },
    objective: { en: 'Allow the declared 8.8.8.8 client through public LB 20.40.50.60:443 to the original server on port 8443, while 1.1.1.1 remains blocked. Health is an unverified declaration; probe NSGs and data NSGs must be assessed separately.', ja: '宣言された 8.8.8.8 クライアントをパブリック LB 20.40.50.60:443 経由で元のサーバーのポート 8443 に許可し、1.1.1.1 はブロックしたままにします。正常性は未検証の宣言で、プローブ NSG とデータ NSG は個別に評価します。' },
    requirements: [ingressGoal(), ingressGoal('other-client-blocked', '1.1.1.1', 'blocked')], concepts: ['coverage', 'inspection'], prerequisites: [],
    hints: [{ en: 'The TCP probe uses AzureLoadBalancer/168.63.129.16 and port 8080, not the client web tuple.', ja: 'TCP プローブは AzureLoadBalancer/168.63.129.16 とポート 8080 を使い、クライアントの Web タプルとは異なります。' },
      { en: 'Repair the probe denial without broadening the original data-client allow to all Internet clients.', ja: '元のデータ クライアントの許可をすべての Internet クライアントに拡大せずに、プローブの拒否を修復してください。' }],
    starter: probeData,
  },
  {
    id: 'public-ingress-nsg', version: 1, title: { en: 'A public IP is not an ingress allow', ja: 'パブリック IP は受信許可ではない' },
    objective: { en: 'Permit only 8.8.8.8 to the original VM frontend 20.40.50.60:443; keep 1.1.1.1 blocked. Preserve the original VM/NIC/private/public identities. Assess the private backend tuple and conditional response, not listener readiness.', ja: '元の VM フロントエンド 20.40.50.60:443 に 8.8.8.8 のみを許可し、1.1.1.1 はブロックします。VM、NIC、プライベートおよびパブリックの ID を維持し、リスナーの準備状態ではなくプライベート バックエンドのタプルと条件付き応答を評価します。' },
    requirements: [ingressGoal(), ingressGoal('other-client-blocked', '1.1.1.1', 'blocked')], concepts: ['inspection', 'coverage'], prerequisites: [],
    hints: [{ en: 'Standard public ingress needs an associated subnet/NIC NSG permission; default Internet inbound is denied.', ja: 'Standard のパブリック受信にはサブネットまたは NIC の NSG 許可が必要です。既定の Internet 受信は拒否されます。' },
      { en: 'Allow the original client to 10.1.1.4:443, not just the public destination address.', ja: 'パブリック宛先アドレスだけではなく、元のクライアントから 10.1.1.4:443 を許可します。' }],
    starter: directIngress,
  },
  {
    id: 'dnat-response-owner', version: 1, title: { en: 'Restore the original DNAT response owner', ja: '元の DNAT 応答の所有者を復元' },
    objective: { en: 'The NVA maps the declared public client to the original server, but the backend return does not traverse that translation owner. Restore a supported symmetric configuration while preserving bound IDs/addresses. Guest rules and live state remain unverified.', ja: 'NVA は宣言されたパブリック クライアントを元のサーバーに変換しますが、バックエンドの戻り経路は変換の所有者を通りません。固定された ID とアドレスを維持して、サポートされる対称構成を復元してください。ゲストのルールと実際の状態は未検証のままです。' },
    requirements: [ingressGoal()], concepts: ['selection', 'inspection', 'coverage'], prerequisites: ['public-ingress-nsg'],
    hints: [{ en: 'Inspect the backend reply route independently from the configured forward DNAT tuple.', ja: '構成済みの往路 DNAT タプルとは別に、バックエンドの応答ルートを確認してください。' },
      { en: 'A supported UDR from app through original router 10.1.2.4 can restore a source-preserving return; an explicit interface-SNAT design also requires compatible backend NSGs.', ja: 'app から元のルーター 10.1.2.4 へのサポートされる UDR で送信元を保持した戻り経路を復元できます。インターフェイス SNAT を明示する設計では、対応するバックエンド NSG も必要です。' }],
    starter: asymmetric,
  },
  {
    id: 'internal-lb-health', version: 1, title: { en: 'Resolve unknown internal LB backend health', ja: '内部 LB バックエンドの不明な正常性を解決' },
    objective: { en: 'Model private client 10.1.2.5 reaching original internal frontend 10.1.2.10:443 and server 10.1.1.4:8443 with a symmetric response. Unknown health cannot pass or certify isolation; explicitly declare modeled health without claiming live observation.', ja: 'プライベート クライアント 10.1.2.5 から元の内部フロントエンド 10.1.2.10:443 とサーバー 10.1.1.4:8443 への対称応答をモデル化します。不明な正常性は達成や分離の証明になりません。実際に観測したと主張せず、モデルの正常性を明示的に宣言してください。' },
    requirements: [{ id: 'private-lb-configured', kind: 'packet', sourceAddress: '10.1.2.5', destinationAddress: '10.1.2.10', expectation: 'configured',
      requiredBackend: { ...server, address: '10.1.1.4' }, packet: { source: { kind: 'workload', workloadId: 'client', nicId: 'client-nic', ipConfigurationId: 'client-ip' },
        target: { kind: 'load-balancer', loadBalancerId: 'lb', frontendId: 'lb-front' }, protocol: 'tcp', sourcePort: 49152, destinationPort: 443 } }],
    concepts: ['selection', 'coverage'], prerequisites: ['lb-probe-data-nsg'],
    hints: [{ en: 'A valid private route alone does not make a backend healthy or a listener ready.', ja: '有効なプライベート ルートだけではバックエンドは正常にならず、リスナーの準備も整いません。' },
      { en: 'Inspect the original pool/probe and declare healthy only as a simulation assumption; keep probe and client NSGs independent.', ja: '元のプールとプローブを確認し、正常はシミュレーションの仮定としてのみ宣言します。プローブとクライアントの NSG は個別に維持します。' }],
    starter: internal,
  },
]
