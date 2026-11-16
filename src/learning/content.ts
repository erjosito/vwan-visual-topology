import type { Language } from '../messages'

export type Localized = { en: string; ja: string }
export const text = (value: Localized, language: Language) => value[language]
export const contentVersion = 1
export type ConceptId = 'selection' | 'hrp' | 'contexts' | 'peering' | 'inspection' | 'coverage'

export const concepts: Record<ConceptId, { title: Localized; body: Localized; source: string }> = {
  selection: {
    title: { en: 'Routes and longest-prefix matching', ja: 'ルートと最長プレフィックス一致' },
    body: {
      en: 'A forwarding lookup first finds the most specific matching destination prefix. Best-path selection compares candidates for the same prefix; it is not a comparison between a /24 and a /16. Inspect the selected table, its candidates and the return path. Equal-cost alternatives do not predict a particular traffic hash.',
      ja: '転送では宛先に一致する最も具体的なプレフィックスを選びます。ベストパス選択は同じプレフィックスの候補を比較するもので、/24 と /16 の比較ではありません。選択されたテーブル、候補、戻り経路を確認してください。等コスト経路から個々の通信のハッシュは予測できません。',
    },
    source: 'https://learn.microsoft.com/azure/virtual-network/virtual-networks-udr-overview',
  },
  hrp: {
    title: { en: 'Virtual hub routing preference', ja: '仮想ハブのルーティング優先設定' },
    body: {
      en: 'Hub routing preference participates in Virtual WAN best-path selection for competing branch routes. It does not replace longest-prefix matching, route-table scope or routing intent. Use the engine reasons for the exact decision rather than assuming every route follows the preferred transport. The simulator reevaluates immediately; live Azure routes may need to be bounced after a preference change.',
      ja: 'ハブのルーティング優先設定は Virtual WAN の競合する拠点ルートの選択に関わります。最長プレフィックス一致、テーブルのスコープ、ルーティング インテントを置き換えるものではありません。すべてのルートが優先トランスポートを使うと仮定せず、エンジンの選択理由を確認してください。シミュレーターは即座に再評価しますが、実際の Azure では変更後にルートの再広告が必要になる場合があります。',
    },
    source: 'https://learn.microsoft.com/azure/virtual-wan/about-virtual-hub-routing-preference',
  },
  contexts: {
    title: { en: 'Association, propagation and table scope', ja: '関連付け、伝達、テーブルのスコープ' },
    body: {
      en: 'Association chooses the hub table used by a connection for forwarding. Propagation controls where its routes are exported; labels and table IDs are not interchangeable. A route visible in one table need not exist in another. Missing captured association or propagation controls are unknown, not proof of reachability or isolation.',
      ja: '関連付けは接続が転送に使うハブ テーブルを選びます。伝達はルートのエクスポート先を制御し、ラベルとテーブル ID は同じものではありません。あるテーブルに見えるルートが別のテーブルに存在するとは限りません。取得できなかった関連付けや伝達の設定は不明であり、到達性や分離の証明にはなりません。',
    },
    source: 'https://learn.microsoft.com/azure/virtual-wan/about-virtual-hub-routing',
  },
  peering: {
    title: { en: 'Peering and bidirectional connectivity', ja: 'ピアリングと双方向の接続' },
    body: {
      en: 'VNet peering connects address spaces, but ordinary peering is not transitive. Forwarded traffic and gateway transit have separate controls. A visible address-space route is not proof that access is allowed. Check both directions and the actual forwarding result, not just route presence.',
      ja: 'VNet ピアリングはアドレス空間を接続しますが、通常のピアリングに推移性はありません。転送されたトラフィックとゲートウェイ転送には別々の設定があります。アドレス空間のルートが見えていても、アクセスが許可される証明にはなりません。ルートの有無だけでなく、両方向と実際の転送結果を確認してください。',
    },
    source: 'https://learn.microsoft.com/azure/virtual-network/virtual-network-peering-overview',
  },
  inspection: {
    title: { en: 'Routing intent and inspection', ja: 'ルーティング インテントと検査' },
    body: {
      en: 'Modeled firewall or appliance traversal describes the forwarding path, not a firewall-policy verdict. Return paths may differ from forward paths. This simulator does not verify firewall rules, NAT, session state, application delivery or a live packet capture.',
      ja: 'モデル上のファイアウォールやアプライアンスの通過は転送経路を表し、ファイアウォール ポリシーの判定ではありません。戻り経路は往路と異なる場合があります。このシミュレーターはファイアウォール規則、NAT、セッション状態、アプリケーション配信、実際のパケット キャプチャを検証しません。',
    },
    source: 'https://learn.microsoft.com/azure/virtual-wan/how-to-routing-policies',
  },
  coverage: {
    title: { en: 'Evidence, uncertainty and practice awards', ja: '根拠、不確実性、練習の達成' },
    body: {
      en: 'Satisfied means the explicit requirement passed in the modeled snapshot. Violated means the engine found contrary evidence. Not assessed means the inputs, ownership, scope or analysis do not justify a decision. A missing route is not automatically a verified deny. Local practice badges are editable local history, not certification or server-verified awards. Basic help and grading run locally without an AI subscription.',
      ja: '「達成」は明示された要件がモデルのスナップショットで満たされたことを示します。「未達成」はエンジンが反証を検出したことを示します。「評価不能」は入力、所有関係、スコープ、分析が判定に十分でないことを示します。ルートがないだけで拒否が検証されたとは限りません。ローカルの練習バッジは編集可能な履歴であり、認定やサーバー検証済みの賞ではありません。基本の説明と評価は AI 契約なしでローカルに実行されます。',
    },
    source: '/docs/index.html',
  },
}

export const labels = {
  learn: { en: 'Learn & practice', ja: '学習と練習' },
  close: { en: 'Close learning', ja: '学習を閉じる' },
  explain: { en: 'Explain this', ja: '説明を表示' },
  concepts: { en: 'Concepts', ja: '概念' },
  practice: { en: 'Practice', ja: '練習' },
  exercise: { en: 'Choose an exercise', ja: '演習を選択' },
  matchingMode: { en: 'This exercise uses a different native document format. Open its draft directly in the compatible visual editor; independent assessment and saved drafts remain available here.', ja: 'この演習は別のネイティブ形式を使用します。下書きは互換ビジュアル エディターで直接開けます。独立した評価と保存済みの下書きはここで使用できます。' },
  source: { en: 'Source reference (opens only when selected)', ja: '参考資料（選択時のみ開きます）' },
  evidence: { en: 'Reasons from this modeled result', ja: 'このモデルの結果に基づく理由' },
  noEvidence: { en: 'No decision evidence is available here. This concept is not a claim about this route.', ja: 'ここには選択の根拠がありません。この概念の説明は、このルートの判定を主張するものではありません。' },
  snapshot: { en: 'Explanations describe this modeled snapshot, not verified live Azure behavior.', ja: '説明はこのモデルのスナップショットについてのもので、実際の Azure の動作を検証したものではありません。' },
  local: { en: 'Local practice only. No account, upload or verified certification. Drafts and progress stay in this browser or desktop profile; they are not encrypted or synchronized.', ja: 'ローカルの練習専用です。アカウント、アップロード、認定はありません。下書きと進捗はこのブラウザーまたはデスクトップのプロファイルに保存され、暗号化や同期はされません。' },
  requirements: { en: 'Requirements', ja: '要件' },
  draft: { en: 'Practice topology JSON', ja: '練習用トポロジ JSON' },
  useWorkspace: { en: 'Copy workspace configuration into practice', ja: 'ワークスペースの構成を練習にコピー' },
  openEditor: { en: 'Open draft in visual editor', ja: '下書きをビジュアル エディターで開く' },
  replace: { en: 'Open this draft in a separate practice canvas? Your normal design and layout are kept. This replaces any previous practice canvas, not its independent draft or badges. After visual edits, reopen learning and copy the practice canvas back before assessing.', ja: 'この下書きを別の練習キャンバスで開きますか。通常の設計とレイアウトは保持されます。以前の練習キャンバスは置き換わりますが、独立した下書きやバッジは保持されます。ビジュアル編集後に学習を再度開き、評価前に練習キャンバスをコピーしてください。' },
  confirm: { en: 'Open protected practice workspace', ja: '保護された練習ワークスペースを開く' },
  practiceWorkspace: { en: 'Practice workspace', ja: '練習ワークスペース' },
  practiceProtected: { en: 'Practice canvas — your normal design is kept separately.', ja: '練習キャンバス — 通常の設計は別に保持されています。' },
  practiceAvailable: { en: 'Separate practice workspace', ja: '独立した練習ワークスペース' },
  returnDesign: { en: 'Return to my design', ja: '自分の設計に戻る' },
  resumePractice: { en: 'Resume practice', ja: '練習を再開' },
  discardPractice: { en: 'Discard practice workspace', ja: '練習ワークスペースを破棄' },
  discardPracticeConfirm: { en: 'Discard only the saved practice canvas? Normal designs, practice drafts, attempts and badges are not deleted.', ja: '保存済みの練習キャンバスだけを破棄しますか。通常の設計、練習の下書き、試行、バッジは削除されません。' },
  practiceReadFailure: { en: 'Saved practice could not be read. Its original contents have not been overwritten.', ja: '保存済みの練習を読み取れませんでした。元の内容は上書きしていません。' },
  practiceSaveFailure: { en: 'Practice could not be saved. Changes remain in this session only. Return to practice and export your design before reloading.', ja: '練習を保存できませんでした。変更はこのセッションだけに保持されます。再読み込み前に練習に戻り、設計をエクスポートしてください。' },
  practiceStartFailure: { en: 'Practice could not be saved, so the new practice canvas was not opened. Existing canvases have not been replaced. Check available browser storage before trying again.', ja: '練習を保存できなかったため、新しい練習キャンバスは開いていません。既存のキャンバスは置き換えていません。ブラウザーの空き容量を確認してから再試行してください。' },
  practiceConflict: { en: 'Saved practice changed in another tab. It has not been overwritten. Reload to use that saved session.', ja: '保存済みの練習が別のタブで変更されました。上書きしていません。保存済みのセッションを使用するには再読み込みしてください。' },
  cancel: { en: 'Cancel', ja: 'キャンセル' },
  assess: { en: 'Assess practice draft', ja: '練習の下書きを評価' },
  running: { en: 'Assessing locally...', ja: 'ローカルで評価中...' },
  hint: { en: 'Show next hint', ja: '次のヒントを表示' },
  hints: { en: 'Hints used', ja: '使用したヒント' },
  passed: { en: 'Practice requirements satisfied', ja: '練習の要件を達成' },
  violated: { en: 'Requirements not yet satisfied', ja: '要件はまだ未達成' },
  unknown: { en: 'Not assessed', ja: '評価不能' },
  stale: { en: 'The draft changed. Assess again; the earlier result does not verify this draft.', ja: '下書きが変わりました。再評価してください。以前の結果はこの下書きを検証しません。' },
  history: { en: 'Local practice progress', ja: 'ローカルの練習の進捗' },
  badge: { en: 'Practice badge (local, unverified)', ja: '練習バッジ（ローカル、未認証）' },
  older: { en: 'Historical pass from an older exercise or grader; reassess with the current version.', ja: '以前の演習または評価エンジンによる達成です。現在のバージョンで再評価してください。' },
  fresh: { en: 'No recorded practice pass', ja: '練習の達成記録なし' },
  reset: { en: 'Reset local practice progress', ja: 'ローカルの練習の進捗をリセット' },
  resetConfirm: { en: 'Delete practice drafts, attempts and local badges? The visual workspace is not changed.', ja: '練習の下書き、試行、ローカルのバッジを削除しますか？ビジュアル ワークスペースは変更されません。' },
  resetNow: { en: 'Delete practice progress', ja: '練習の進捗を削除' },
  saved: { en: 'Saved locally', ja: 'ローカルに保存済み' },
  saveFailed: { en: 'Local storage is unavailable or full. Changes remain in this session only; copy your draft to preserve it.', ja: 'ローカル ストレージが使用できないか満杯です。変更はこのセッションのみに残ります。下書きをコピーして保存してください。' },
  damaged: { en: 'Saved practice data could not be read. Its original contents have not been overwritten. Reset explicitly to enable saving again.', ja: '保存された練習データを読み取れませんでした。元の内容は上書きしていません。保存を再開するには明示的にリセットしてください。' },
  invalid: { en: 'Invalid or oversized practice topology. Review the JSON and engine findings; no badge was awarded.', ja: '練習のトポロジが無効、または大きすぎます。JSON とエンジンの結果を確認してください。バッジは付与されませんでした。' },
  details: { en: 'Engine evidence for this attempt', ja: 'この試行のエンジンの根拠' },
  prerequisite: { en: 'Recommended preparation', ja: '推奨される準備' },
} satisfies Record<string, Localized>
