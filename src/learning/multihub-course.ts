import type { CourseBundle, CourseTask } from './course-contract'
import { multihubLessonRequirements, multihubLessonTopology } from './multihub-scenario'

const l = (en: string, ja: string) => ({ en, ja })

export function appendMultihubLesson(bundle: CourseBundle) {
  const id = 'multihub-labels'
  const source = { hubId: 'west-hub', tableId: 'west-workloads', prefix: '10.102.0.0/16' }
  const reply = { hubId: 'east-hub', tableId: 'east-services', prefix: '10.101.0.0/16' }
  const topology = multihubLessonTopology()
  bundle.scenarios.push({ id, document: { mode: 'full', topology } })
  bundle.guidance.push(
    { id: `${id}.source-guide`, action: 'hub-routes.open', params: source,
      instruction: l('Inspect West hub / West workloads for the East service prefix. Default is a different table.', 'West hub / West workloads で East サービスのプレフィックスを調べます。Default は別のテーブルです。') },
    { id: `${id}.return-guide`, action: 'hub-routes.open', params: reply,
      instruction: l('Inspect East hub / East services for the West application prefix, independently of the source table.', '送信元テーブルとは独立して、East hub / East services で West アプリのプレフィックスを調べます。') },
    ...['west', 'east'].map((side) => ({ id: `${id}.${side}-guide`, action: 'hub.configure' as const,
      params: { hubId: `${side}-hub` },
      instruction: l(`Open ${side === 'west' ? 'West' : 'East'} hub's native routing editor. Compare table labels with connection propagation; guidance changes nothing.`,
        `${side === 'west' ? 'West' : 'East'} hub のルーティング設定を開き、テーブルのラベルと接続の伝達先を比較します。案内だけでは変更されません。`) })),
  )
  bundle.checks.push(
    { id: `${id}.load-check`, kind: 'scenario.loaded', params: { scenarioId: id } },
    { id: `${id}.before-source`, kind: 'control-routes.inspected', params: source },
    { id: `${id}.before-return`, kind: 'control-routes.inspected', params: reply },
    { id: `${id}.diagnosis-check`, kind: 'quiz.answered', params: {
      question: l('East services contains the West application route, but West workloads lacks the East service route. What does this establish?',
        'East services には West アプリのルートがありますが、West workloads には East サービスのルートがありません。何が分かりますか。'),
      correctChoiceId: 'independent-contexts', choices: [
        { id: 'independent-contexts', text: l('The two ingress tables have different reachability; the return entry does not repair the forward lookup.',
          '両方向の流入テーブルで到達性が異なり、復路のエントリは往路の検索を修復しません。'),
          feedback: l('Association selects the ingress table. Check propagation into that exact destination table rather than combining routes across the hubs.',
            '関連付けが流入テーブルを選びます。複数ハブのルートを合成せず、その伝達先テーブルへの伝達を確認します。') },
        { id: 'same-local-id', text: l('The two custom tables need matching resource IDs before either direction can use the inter-hub link.',
          'ハブ間リンクを使うには、両方向のカスタム テーブルでリソース ID を一致させる必要があります。'),
          feedback: l('These local table IDs are intentionally different. Labels group propagation destinations across hubs; renaming an ID does not explain the asymmetric entries.',
            'ローカルなテーブル ID は意図的に異なります。ハブ間の伝達先をまとめるのはラベルであり、ID の変更ではエントリの非対称性を説明できません。') },
        { id: 'default-union', text: l('The Default table combines the two custom-table entries when a workload starts the conversation.',
          'ワークロードが通信を始めると、Default テーブルが両カスタム テーブルのエントリをまとめます。'),
          feedback: l('Default is another table, not a union. The original West application is associated with West workloads.',
            'Default は別のテーブルであり、ルートの集合ではありません。元の West アプリは West workloads に関連付けられています。') },
      ],
    } },
    { id: `${id}.repair-check`, kind: 'hub-associations.configured', params: {
      associations: topology.vnets.map((vnet) => ({ vnetId: vnet.id, hubId: vnet.vwanHubAttachment!.hubId,
        tableId: vnet.vwanHubAttachment!.hubRouting!.associatedTableId! })),
      requirements: multihubLessonRequirements,
    } },
    { id: `${id}.after-source`, kind: 'control-routes.inspected', params: source },
    { id: `${id}.after-return`, kind: 'control-routes.inspected', params: reply },
    { id: `${id}.quiz`, kind: 'quiz.answered', params: {
      question: l('Why does the repaired case preserve West Operations and tenant isolation while restoring the cross-hub service?',
        '修復後、ハブ間サービスを復旧しながら West Operations とテナントの分離を維持できるのはなぜですか。'),
      correctChoiceId: 'destination-labels', choices: [
        { id: 'propagation-association', text: l('Connection propagation also selects the ingress lookup, so a shared export label supplies each workload with a common table.',
          '接続の伝達設定が流入検索も選ぶため、共通のエクスポート ラベルが各ワークロードに共通テーブルを与えます。'),
          feedback: l('Propagation places routes; association selects the lookup table. The original associations are retained and independently checked.',
            '伝達はルートを配置し、関連付けは検索テーブルを選びます。元の関連付けは維持され、独立して検証されます。') },
        { id: 'local-table-seed', text: l('Selecting a local table for propagation also selects its counterpart in the other hub, so the existing local IDs complete the repair.',
          '伝達先のローカル テーブルを選ぶと他方のハブの対応テーブルも選ばれるため、既存のローカル ID で修復できます。'),
          feedback: l('An explicit local table can seed the export, but remote imports still depend on matching destination labels in this modeled case.',
            '明示的なローカル テーブルはエクスポート元になりますが、このモデルではリモートへの取り込みには伝達先ラベルの一致が必要です。') },
        { id: 'destination-labels', text: l('Matching destination labels restore the missing import; separate associations and propagation keep the tenant out of the service tables.',
          '伝達先ラベルの一致で不足したルートが取り込まれ、別々の関連付けと伝達先によってテナントはサービス テーブルに入りません。'),
          feedback: l('The checks retain four original attachments, assess both service directions and Operations, and test both tenant initiations in exact table scopes. This is modeled routing, not firewall enforcement or live Azure delivery.',
            '評価は元の 4 接続を維持し、サービスの両方向、Operations、テナントとの両方向の新規通信を正確なテーブル範囲で確認します。これはモデル上のルーティングであり、ファイアウォールの強制や実 Azure での配送ではありません。') },
      ],
    } },
  )
  const task = (suffix: string, points: number, title: ReturnType<typeof l>, instruction: ReturnType<typeof l>, check: string, guides: string[] = []): CourseTask => ({
    id: `${id}.${suffix}`, assessmentVersion: 1, awardId: `${id}.${suffix}`, points, title, instruction,
    hints: [], checkId: `${id}.${check}`, guidanceIds: guides.map((guide) => `${id}.${guide}`),
  })
  const tasks = [
    task('load', 5, l('Open the two-hub incident', '2 ハブの障害を開く'),
      l('Confirm loading the original two-hub practice network. Your normal design stays protected; no Azure resources are deployed.',
        '初期の 2 ハブ練習ネットワークの読み込みを確認します。通常の設計は保護され、Azure リソースはデプロイされません。'), 'load-check'),
    task('inspect', 10, l('Read the source association table', '送信元の関連付けテーブルを読む'),
      l('In West hub / West workloads, inspect 10.102.0.0/16 for East shared service 10.102.1.10. Record the missing route in this exact table, not Default.',
        'West hub / West workloads で East shared service 10.102.1.10 の 10.102.0.0/16 を調べます。Default ではなく、このテーブルでルートが欠けていることを記録します。'), 'before-source', ['source-guide']),
    task('compare', 10, l('Read the independent return context', '独立した復路の範囲を読む'),
      l('In East hub / East services, inspect and record 10.101.0.0/16. Compare this existing return entry with the missing forward entry.',
        'East hub / East services で 10.101.0.0/16 を調べて記録し、存在する復路のエントリと欠けている往路のエントリを比較します。'), 'before-return', ['return-guide']),
    task('diagnose', 25, l('Interpret the asymmetric evidence', '非対称な根拠を読み解く'),
      l('Explain the two independent lookups before editing the network.', 'ネットワークを編集する前に、独立した 2 つの検索を説明します。'), 'diagnosis-check'),
    task('repair', 150, l('Restore the service without widening the tenant', 'テナントの到達範囲を広げずにサービスを復旧する'),
      l('Compare both hubs’ table labels and the original VNet connections’ propagation labels, including letter case. Restore West application 10.101.1.10 ↔ East shared service 10.102.1.10. Retain all four enabled original attachments and their associations: West application and West Operations → West workloads; East shared service → East services; Restricted tenant → Tenant only. Keep West Operations 10.104.1.10 reachable and prevent new initiations in either direction between West application and Restricted tenant 10.103.1.10. Do not substitute Default or merge table views.',
        '両ハブのテーブルのラベルと元の VNet 接続の伝達ラベルを、大文字小文字も含めて比較します。West application 10.101.1.10 ↔ East shared service 10.102.1.10 を復旧します。元の 4 接続を有効なまま維持し、West application と West Operations → West workloads、East shared service → East services、Restricted tenant → Tenant only の関連付けを保持します。West Operations 10.104.1.10 の到達性を維持し、West application と Restricted tenant 10.103.1.10 間の両方向の新規通信を禁止します。Default で代用したり、テーブル表示を合成したりしないでください。'), 'repair-check', ['west-guide', 'east-guide']),
    task('verify-source', 10, l('Verify the restored source table', '復旧した送信元テーブルを確認する'),
      l('Record West hub / West workloads for 10.102.0.0/16 after your repair. Check the original service route and the tenant’s continued absence.',
        '修復後の West hub / West workloads で 10.102.0.0/16 を記録します。元のサービスのルートと、テナントのルートが引き続きないことを確認します。'), 'after-source', ['source-guide']),
    task('verify-return', 10, l('Verify the return table separately', '復路テーブルを別に確認する'),
      l('Record East hub / East services for 10.101.0.0/16 after repair. The West source-table observation cannot stand in for this return context.',
        '修復後の East hub / East services で 10.101.0.0/16 を記録します。West の送信元テーブルの観察では、この復路の範囲を代用できません。'), 'after-return', ['return-guide']),
    task('explain', 30, l('Explain scoped propagation', '範囲を限定した伝達を説明する'),
      l('Distinguish local table IDs, destination labels, association and propagation using the original service and tenant evidence.',
        '元のサービスとテナントの根拠から、ローカル テーブル ID、伝達先ラベル、関連付け、伝達を区別します。'), 'quiz'),
  ]
  bundle.lessons.push({ id, contentVersion: 1, scenarioId: id, prerequisites: ['hybrid-preference'],
    title: l('WAN incident: one return route, two table contexts', 'WAN 障害: 1 つの復路と 2 つのテーブル範囲'),
    objective: l('Repair cross-hub destination-label propagation with independent source and return evidence while preserving Operations and a connected tenant boundary.',
      '独立した往路と復路の根拠を使い、Operations と接続されたテナントの境界を維持しながら、ハブ間の伝達先ラベルを修復します。'),
    taskOrder: tasks.map((entry) => entry.id), tasks })
}
