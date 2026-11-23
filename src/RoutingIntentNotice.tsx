import { t } from './i18n'
import { registerJapaneseMessages } from './messages'
import { routingIntentConflicts, routingIntentManaged, type IntentHub } from './routing-intent'

registerJapaneseMessages({
  'Managed by routing intent': 'ルーティング意図により管理',
  'Routing intent manages association and propagation for every connection. Default-route receipt and connection static-route advertisement remain independent.': 'ルーティング意図はすべての接続の関連付けと伝達を管理します。既定のルートの受信と接続の静的ルートの広告は独立しています。',
  'Removing all routing policies sets propagation to the default label; Azure does not restore the previous settings. Simulator Undo restores the previous document.': 'すべてのルーティング ポリシーを削除すると、伝達は default ラベルに設定されます。Azure は以前の設定を復元しません。シミュレーターの元に戻す操作は以前のドキュメントを復元します。',
  'Resolve incompatible hub tables and static routes before enabling routing intent. Existing configuration is not deleted automatically.': 'ルーティング意図を有効にする前に、互換性のないハブ テーブルと静的ルートを解消してください。既存の構成は自動的に削除されません。',
  'Apply routing-intent settings': 'ルーティング意図の設定を適用',
  'Saved connection settings differ from routing intent. Apply the managed settings explicitly; captured or unknown evidence is not silently rewritten.': '保存された接続設定がルーティング意図と異なります。管理対象の設定を明示的に適用してください。取得済みまたは不明な情報は自動的に書き換えられません。',
  'Receives an available hub default route into this VNet. This does not create a default route or enable Internet routing intent.': '利用可能なハブの既定のルートをこの VNet に受信します。既定のルートの作成やインターネット ルーティング意図の有効化は行いません。',
  'Propagate connection static routes into BGP': '接続の静的ルートを BGP に伝達',
  'Advertises configured connection static prefixes through hub routing. This does not control receipt of 0.0.0.0/0 into the VNet.': '構成済みの接続の静的プレフィックスをハブ ルーティング経由で広告します。VNet への 0.0.0.0/0 の受信は制御しません。',
  'Remove hub table': 'ハブ テーブルを削除',
  'Single hub only. Declare the original local Firewall identity. With routing intent, only default-table routes to that Firewall are supported here; policy-generated routes are managed. This does not establish Firewall permission or application delivery.': '単一ハブのみです。元のローカル Firewall の識別情報を宣言してください。ルーティング意図では、その Firewall を指す既定テーブルのルートのみをここでサポートします。ポリシー生成ルートは管理対象です。Firewall の許可やアプリケーションの配信を保証するものではありません。',
})

export function RoutingIntentNotice({ hub }: { hub: IntentHub }) {
  const conflicts = routingIntentConflicts(hub)
  return <>
    {routingIntentManaged(hub) && <p role="status"><strong>{t('Managed by routing intent')}</strong>.{' '}
      {t('Routing intent manages association and propagation for every connection. Default-route receipt and connection static-route advertisement remain independent.')}</p>}
    <p>{t('Removing all routing policies sets propagation to the default label; Azure does not restore the previous settings. Simulator Undo restores the previous document.')}</p>
    {conflicts.length > 0 && <div role="alert">
      <p>{t('Resolve incompatible hub tables and static routes before enabling routing intent. Existing configuration is not deleted automatically.')}</p>
      <ul>{conflicts.map((conflict) => <li key={conflict}>{conflict}</li>)}</ul>
    </div>}
  </>
}
