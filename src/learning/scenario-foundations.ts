import type { CourseBundle, CourseCheck, CourseTask } from './course-contract'
import type { Localized } from './content'

const l = (en: string, ja: string): Localized => ({ en, ja })
const task = (id: string, points: number, title: Localized, instruction: Localized, checkId: string, guidanceIds: string[] = []): CourseTask =>
  ({ id, assessmentVersion: 1, awardId: id, points, title, instruction, checkId, guidanceIds, hints: [] })

export function addScenarioFoundations(bundle: CourseBundle) {
  const privateLesson = bundle.lessons.find((lesson) => lesson.id === 'private-link')!
  const localScope = { vnetId: 'a', subnetId: 'a-work', prefix: '10.21.0.0/16' }
  const openingCheck = bundle.checks.find((check) => check.id === 'private-link.load-check')!
  if (openingCheck.kind !== 'scenario.loaded') throw new Error('Missing first-scenario loading check')
  openingCheck.params.inspection = localScope
  const opening = privateLesson.tasks[0]
  privateLesson.contentVersion = 2
  opening.assessmentVersion = 2
  opening.title = l('Explore Application’s virtual network', 'Application の仮想ネットワークを調べる')
  opening.instruction = l('A VNet groups subnets within an address space. Application uses 10.21.0.0/16, with Workload and Operations subnets. Open Effective routes for Application / Workload, find 10.21.0.0/16, and read its Source and Next hop.',
    'VNet は、アドレス空間内のサブネットをまとめます。Application は 10.21.0.0/16 を使い、Workload と Operations サブネットを含みます。Application / Workload の「有効なルート」を開き、10.21.0.0/16 の Source（生成元）と Next hop（ネクストホップ）を確認してください。')
  opening.guidanceIds = ['private-link.local-guide']
  bundle.guidance.push({ id: 'private-link.local-guide', action: 'routes.open', params: localScope,
    instruction: l('Open Application / Workload’s local 10.21.0.0/16 route.', 'Application / Workload のローカルな 10.21.0.0/16 ルートを開く。') })
  const scope = { vnetId: 'a', subnetId: 'a-work', prefix: '10.0.0.0/8' }
  bundle.guidance.push({ id: 'private-link.default-guide', action: 'routes.open', params: scope,
    instruction: l('Open Application / Workload effective routes at the private 10.0.0.0/8 range.', 'Application / Workload の有効なルートで、プライベート範囲 10.0.0.0/8 を開く。') })
  bundle.checks.push(
    { id: 'private-link.address-check', kind: 'quiz.answered', params: {
      question: l('Partner owns 10.22.0.0/16. Which service address belongs to that VNet?', 'Partner は 10.22.0.0/16 を所有します。この VNet に含まれるサービス アドレスはどれですか。'),
      correctChoiceId: 'partner', choices: [
        { id: 'application', text: l('10.21.1.4', '10.21.1.4'),
          feedback: l('This address belongs to Application, 10.21.0.0/16. For these /16 ranges, compare the first two octets.', 'このアドレスは Application の 10.21.0.0/16 に含まれます。これらの /16 の範囲では、最初の 2 オクテットを比較します。') },
        { id: 'restricted', text: l('10.23.1.4', '10.23.1.4'),
          feedback: l('This address belongs to Restricted, 10.23.0.0/16, not Partner. Private addresses do not all belong to one network.', 'このアドレスは Partner ではなく、Restricted の 10.23.0.0/16 に含まれます。プライベート アドレスがすべて同じネットワークに属するわけではありません。') },
        { id: 'partner', text: l('10.22.1.4', '10.22.1.4'),
          feedback: l('Correct. 10.22.1.4 is inside Partner’s 10.22.0.0/16 and its Workload subnet, 10.22.1.0/24. The /24 selects a smaller range within the /16.', '正解です。10.22.1.4 は Partner の 10.22.0.0/16 と、その Workload サブネット 10.22.1.0/24 に含まれます。/24 は /16 の中の、より小さな範囲を指定します。') },
      ],
    } },
    { id: 'private-link.default-check', kind: 'routes.inspected', params: scope },
    { id: 'private-link.predict-default-check', kind: 'quiz.answered', params: {
      question: l('Before peering, 10.22.1.4 matches 10.0.0.0/8 → None and 0.0.0.0/0 → Internet. Which route handles it?', 'ピアリング前、10.22.1.4 は 10.0.0.0/8 → None と 0.0.0.0/0 → Internet に一致します。どちらが使用されますか。'),
      correctChoiceId: 'private-discard', choices: [
        { id: 'private-discard', text: l('The /8 route: discard this private destination.', '/8 のルート: このプライベート宛先を破棄する。'),
          feedback: l('Correct. /8 matches more specifically than /0. A missing Partner /16 row does not make the Internet default the winner; broader matching routes still matter.', '正解です。/8 は /0 より具体的に一致します。Partner の /16 の行がなくても、Internet の既定ルートが選ばれるとは限りません。より広い一致ルートも確認します。') },
        { id: 'internet-fallback', text: l('The /0 route: retry through the Internet default.', '/0 のルート: Internet の既定ルートで再試行する。'),
          feedback: l('None is a selected discard, not a failed next hop that triggers another lookup. Azure does not retry the less-specific Internet route after selecting this /8.', 'None は選択された破棄先であり、失敗時に別の検索を始めるネクストホップではありません。この /8 の選択後に、より広い Internet ルートで再試行はしません。') },
        { id: 'local-private', text: l('The local route: keep private traffic in Application.', 'ローカル ルート: プライベート通信を Application 内に留める。'),
          feedback: l('Application owns 10.21.0.0/16, not every 10.x address. Its VnetLocal route does not match Partner’s 10.22.1.4.', 'Application が所有するのは 10.21.0.0/16 であり、10.x 全体ではありません。その VnetLocal ルートは Partner の 10.22.1.4 に一致しません。') },
      ],
    } },
  )
  privateLesson.tasks.splice(2, 0,
    task('private-link.address-range', 10, l('Find the service’s address owner', 'サービスのアドレスの所有先を探す'),
      l('Use the VNet and subnet ranges to place the supplier address before creating a connection.', '接続を作る前に、VNet とサブネットの範囲から仕入先アドレスの所属を判断します。'), 'private-link.address-check'),
    task('private-link.default-route', 5, l('Find what covers the missing route', '欠けたルートを含む広い範囲を探す'),
      l('Compare the broader private route with the Internet default.', 'より広いプライベート ルートと Internet の既定ルートを比較します。'), 'private-link.default-check', ['private-link.default-guide']),
    task('private-link.predict-default', 10, l('Predict the starting decision', '開始時のルート選択を予測する'),
      l('Choose the matching route before adding peering.', 'ピアリングを追加する前に、一致するルートを選びます。'), 'private-link.predict-default-check'))

  const hubLesson = bundle.lessons.find((lesson) => lesson.id === 'inspection-bypass')!
  const quizzes: Array<{ suffix: string; assessmentVersion?: number; title: Localized; instruction: Localized; question: Localized; correct: string; choices: Array<[string, Localized, Localized]> }> = [
    { suffix: 'predict', title: l('Predict Partner and Operations paths', 'Partner と Operations への経路を予測する'),
      instruction: l('Choose a path for each destination before comparing your prediction with Effective routes.',
        '有効なルートと照合する前に、両方の宛先の転送先を予測します。'),
      question: l('Application has a 10.0.0.0/8 UDR to the firewall, a 10.22.0.0/16 peering route and its local 10.21.0.0/16 route. How do 10.22.1.4 and 10.21.2.4 leave Workload?',
      'Application にはファイアウォールへの 10.0.0.0/8 UDR、10.22.0.0/16 のピアリング ルート、ローカルの 10.21.0.0/16 ルートがあります。Workload から 10.22.1.4 と 10.21.2.4 へはどう転送されますか。'),
      correct: 'separate-prefixes', choices: [
        ['summary-first', l('Partner via firewall; Operations via firewall.', 'Partner はファイアウォール経由、Operations もファイアウォール経由。'),
          l('The /8 matches both addresses, but each also has a longer /16 match. A User source does not defeat a more-specific System route.', '/8 は両アドレスに一致しますが、それぞれにより長い /16 の一致があります。User の生成元でも、より具体的な System ルートには優先しません。')],
        ['separate-prefixes', l('Partner via peering; Operations stays VNet-local.', 'Partner はピアリング経由、Operations は VNet 内。'),
          l('Correct. Partner matches the peering /16; Operations matches Application’s local /16. Both beat the broad /8. Now inspect Partner’s route to compare your prediction with the table.', '正解です。Partner はピアリングの /16、Operations は Application のローカル /16 に一致し、どちらも広い /8 に優先します。次に Partner のルートを調べ、予測を表と比較します。')],
        ['remote-private', l('Partner via firewall; Operations stays VNet-local.', 'Partner はファイアウォール経由、Operations は VNet 内。'),
          l('The remote address also has a more-specific /16 peering route. “Remote” is not a selection rule that makes the /8 UDR win.', 'リモート アドレスにも、より具体的な /16 のピアリング ルートがあります。「リモート」であることを理由に /8 UDR が優先されるわけではありません。')],
      ] },
    { suffix: 'predict-subnet', assessmentVersion: 2, title: l('Separate routing from permission', 'ルーティングと許可を区別する'),
      instruction: l('Distinguish choosing a next hop from allowing an application connection. This question does not change your canvas.',
        'ネクストホップの選択と、アプリの接続の許可を区別します。この質問でキャンバスは変更されません。'),
      question: l('Once a route sends Application’s HTTPS traffic to Inspection firewall, does that selected next hop prove the connection is allowed?',
        'ルートによって Application の HTTPS 通信を Inspection firewall へ送る場合、そのネクストホップの選択だけで接続が許可されると判断できますか。'),
      correct: 'policy-separate', choices: [
        ['automatic-allow', l('Yes. A VirtualAppliance next hop automatically creates an allow rule.', 'はい。VirtualAppliance のネクストホップが許可ルールを自動作成します。'),
          l('A UDR chooses where traffic is sent; it does not create Azure Firewall or NSG rules.', 'UDR は通信の転送先を選びますが、Azure Firewall や NSG のルールは作成しません。')],
        ['private-trusted', l('Yes. Peering makes private HTTPS traffic trusted.', 'はい。ピアリングによってプライベート HTTPS 通信が信頼されます。'),
          l('Private connectivity is not a security-policy exemption. Firewall and NSG rules can still deny the connection.', 'プライベート接続でもセキュリティ ポリシーが免除されるわけではありません。ファイアウォールや NSG のルールによって接続が拒否される場合があります。')],
        ['policy-separate', l('No. Firewall and NSG permissions must be checked separately.', 'いいえ。ファイアウォールと NSG の許可は別に確認する必要があります。'),
          l('Correct. Routing chooses the next hop; traffic permission is a separate requirement.', '正解です。ルーティングはネクストホップを選び、通信の許可は別の要件です。')],
      ] },
  ]
  for (const quiz of quizzes) {
    bundle.checks.push({ id: `inspection-bypass.${quiz.suffix}-check`, kind: 'quiz.answered', params: {
      question: quiz.question, correctChoiceId: quiz.correct,
      choices: quiz.choices.map(([id, text, feedback]) => ({ id, text, feedback })),
    } })
    hubLesson.tasks.splice(hubLesson.tasks.findIndex((entry) => entry.id === 'inspection-bypass.inspect'), 0,
      { ...task(`inspection-bypass.${quiz.suffix}`, 10, quiz.title, quiz.instruction, `inspection-bypass.${quiz.suffix}-check`),
        assessmentVersion: quiz.assessmentVersion ?? 1 })
  }
  const summary = bundle.checks.find((check) => check.id === 'inspection-bypass.summary-check')!
  if (summary.kind !== 'udrs.configured') throw new Error('Summary configuration required')
  const forwardCheck: CourseCheck = { id: 'inspection-bypass.forward-check', kind: 'udrs.configured', params: {
    routes: [{ vnetId: 'a', subnetId: 'a-work', prefix: '10.22.0.0/16', nextHopIp: '10.20.1.4' }],
    requirements: summary.params.requirements,
  } }
  bundle.checks.push(forwardCheck)
  hubLesson.tasks.splice(hubLesson.tasks.findIndex((entry) => entry.id === 'inspection-bypass.repair'), 0,
    task('inspection-bypass.forward', 15, l('Steer the request through inspection', '要求を検査経由にする'),
      l('In Application / Workload’s policy, add an enabled 10.22.0.0/16 UDR with next hop VirtualAppliance, IP 10.20.1.4. This first change steers the request; leave Partner’s policy for the following step.',
        'Application / Workload のポリシーに、有効な 10.22.0.0/16 UDR を追加します。ネクストホップは VirtualAppliance、IP は 10.20.1.4 です。まず要求を転送し、Partner のポリシーは次のステップで扱います。'),
      forwardCheck.id, ['inspection-bypass.table-a-work']))

  const incident = bundle.lessons.find((lesson) => lesson.id === 'tiered-incident')!
  const existing = bundle.checks.find((check) => check.id === 'tiered-incident.repair-check')!
  if (existing.kind !== 'requirements.satisfied') throw new Error('Incident outcomes required')
  bundle.checks.push({ id: 'tiered-incident.entry-check', kind: 'udrs.configured', params: {
    routes: [{ vnetId: 'leaf', subnetId: 'leaf-work', prefix: '10.22.0.0/16', nextHopIp: '10.21.3.4' }],
    requirements: existing.params.requirements.filter((requirement) => requirement.id !== 'indirect-chain'),
  } })
  incident.tasks.splice(incident.tasks.findIndex((entry) => entry.id === 'tiered-incident.repair'), 0,
    task('tiered-incident.entry', 15, l('Connect the new tier’s first stage', '新しい階層の最初の段階を接続する'),
      l('In Indirect workload / Workload, enable the existing Partner service UDR: 10.22.0.0/16 through Tier router 10.21.3.4. This prepares the new tier’s departure; next diagnose the remaining conversation without breaking the existing one.',
        'Indirect workload / Workload で、Tier router 10.21.3.4 を通る既存の Partner service UDR (10.22.0.0/16) を有効にします。新しい階層の送信を準備し、次に既存の通信を壊さず、残る問題を診断します。'),
      'tiered-incident.entry-check', ['tiered-incident.table-leaf-work']))
  for (const lesson of [privateLesson, hubLesson, incident]) lesson.taskOrder = lesson.tasks.map((entry) => entry.id)
}
