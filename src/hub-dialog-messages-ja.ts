import { registerJapaneseMessages } from './messages'

registerJapaneseMessages({
  'Remove all hubs, sites, spokes, ER locations, connections, route maps and saved layouts? A blank topology will open in a new document. Save first if you need a file or cloud backup.': 'すべてのハブ、サイト、スポーク、ER ピアリングの場所、接続、ルート マップ、保存済みレイアウトを削除しますか? 新しいドキュメントで空のトポロジが開きます。ファイルまたはクラウドのバックアップが必要な場合は、先に保存してください。',
  'Counts are enabled/defined connections, not deployed gateways. Missing connections do not prove that no live gateway exists.': '数値は有効な接続数/定義済みの接続数であり、デプロイ済みのゲートウェイ数ではありません。接続がないことは、実際のゲートウェイが存在しない証拠にはなりません。',
  'Clear all objects from the current topology? A blank topology will open in a new document. Save first if you need a file or cloud backup. Other topologies, preferences and training progress are kept.': '現在のトポロジのすべてのオブジェクトをクリアしますか? 新しいドキュメントで空のトポロジが開きます。ファイルまたはクラウドのバックアップが必要な場合は、先に保存してください。他のトポロジ、設定、学習の進行状況は保持されます。',
  'Derived from this topology, not explicit gateway inventory or live observations. SKU, public addresses and provisioning state are unknown.': 'このトポロジから導出した情報であり、明示的なゲートウェイ インベントリや実環境の観測結果ではありません。SKU、パブリック アドレス、プロビジョニング状態は不明です。',
  'No modeled VPN or ExpressRoute connections for this hub.': 'このハブにはモデル化された VPN または ExpressRoute 接続がありません。',
  'No explicit local Firewall declaration.': '明示的なローカル Firewall の指定はありません。',
  'Routing intent may select Firewall inspection independently of a local declaration.': 'ローカルの指定とは別に、ルーティング インテントによって Firewall 検査が選択される場合があります。',
})
