import type { CourseBundle, CourseCheck, CourseTask } from './course-contract'
import type { Localized } from './content'

const l = (en: string, ja: string): Localized => ({ en, ja })
const task = (id: string, points: number, title: Localized, instruction: Localized, checkId: string, guidanceIds: string[] = []): CourseTask =>
  ({ id, assessmentVersion: 1, awardId: id, points, title, instruction, checkId, guidanceIds, hints: [] })

export function addScenarioFoundations(bundle: CourseBundle) {
  const privateLesson = bundle.lessons.find((lesson) => lesson.id === 'private-link')!
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
  const quizzes: Array<{ suffix: string; title: Localized; instruction: Localized; question: Localized; correct: string; choices: Array<[string, Localized, Localized]> }> = [
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
    { suffix: 'predict-subnet', title: l('Predict a subnet-sized discard', 'サブネット範囲の破棄を予測する'),
      instruction: l('This /24 discard is hypothetical; your current canvas stays unchanged.',
        'この /24 の破棄は仮定の変更で、現在のキャンバスは変更しません。'),
      question: l('In a later policy change, Application gets 10.22.1.0/24 → None alongside 10.22.0.0/16 → VNetPeering. Which destination would the /24 discard affect?',
      '後のポリシー変更で、Application に 10.22.0.0/16 → VNetPeering と 10.22.1.0/24 → None がある場合、/24 の破棄の影響を受ける宛先はどれですか。'),
      correct: 'workload-only', choices: [
        ['both', l('Both 10.22.1.4 and 10.22.2.4.', '10.22.1.4 と 10.22.2.4 の両方。'),
          l('Both belong to the /16, but only 10.22.1.4 is inside 10.22.1.0/24. Match the destination before comparing preference.', '両方とも /16 に含まれますが、10.22.1.0/24 に含まれるのは 10.22.1.4 だけです。優先度の比較前に、宛先の一致を確認します。')],
        ['neither', l('Neither 10.22.1.4 nor 10.22.2.4.', '10.22.1.4 と 10.22.2.4 のどちらも対象外。'),
          l('Peering does not override the more-specific /24 discard for 10.22.1.4. The /16 remains the better available match for 10.22.2.4.', 'ピアリングでも、10.22.1.4 に対するより具体的な /24 の破棄には優先しません。10.22.2.4 では、引き続き /16 が適切な一致です。')],
        ['workload-only', l('10.22.1.4, but not 10.22.2.4.', '10.22.1.4 は対象、10.22.2.4 は対象外。'),
          l('Correct. A subnet-sized /24 can affect one workload while a different subnet keeps using /16 peering. This is a prediction about the stated later change, not a change applied to your canvas.', '正解です。サブネット相当の /24 が一方に影響しても、別サブネットでは /16 のピアリングを使えます。これは指定した後の変更についての予測であり、キャンバスへの自動変更ではありません。')],
      ] },
  ]
  for (const quiz of quizzes) {
    bundle.checks.push({ id: `inspection-bypass.${quiz.suffix}-check`, kind: 'quiz.answered', params: {
      question: quiz.question, correctChoiceId: quiz.correct,
      choices: quiz.choices.map(([id, text, feedback]) => ({ id, text, feedback })),
    } })
    hubLesson.tasks.splice(hubLesson.tasks.findIndex((entry) => entry.id === 'inspection-bypass.inspect'), 0,
      task(`inspection-bypass.${quiz.suffix}`, 10, quiz.title, quiz.instruction, `inspection-bypass.${quiz.suffix}-check`))
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
