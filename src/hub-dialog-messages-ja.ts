import { registerJapaneseMessages } from './messages'

registerJapaneseMessages({
  'Remove all hubs, sites, spokes, ER locations, connections, route maps and saved layouts? This replaces the workspace saved in this browser and cannot be undone. Export JSON first if you need a backup.': 'すべてのハブ、サイト、スポーク、ER ピアリングの場所、接続、ルート マップ、保存済みレイアウトを削除しますか? このブラウザーに保存したワークスペースが置き換わり、元に戻せません。必要に応じて先に JSON をエクスポートしてください。',
  'Counts are enabled/defined connections, not deployed gateways. Missing connections do not prove that no live gateway exists.': '数値は有効な接続数/定義済みの接続数であり、デプロイ済みのゲートウェイ数ではありません。接続がないことは、実際のゲートウェイが存在しない証拠にはなりません。',
  'Clear all objects from the current topology? This replaces the saved topology in this workspace and cannot be undone. Export JSON first if you need a backup. Other workspaces, preferences and training progress are kept.': '現在のトポロジのすべてのオブジェクトをクリアしますか? このワークスペースの保存済みトポロジが置き換わり、元に戻せません。必要に応じて先に JSON をエクスポートしてください。他のワークスペース、設定、学習の進行状況は保持されます。',
  'Derived from this topology, not explicit gateway inventory or live observations. SKU, public addresses and provisioning state are unknown.': 'このトポロジから導出した情報であり、明示的なゲートウェイ インベントリや実環境の観測結果ではありません。SKU、パブリック アドレス、プロビジョニング状態は不明です。',
  'No modeled VPN or ExpressRoute connections for this hub.': 'このハブにはモデル化された VPN または ExpressRoute 接続がありません。',
  'No explicit local Firewall declaration.': '明示的なローカル Firewall の指定はありません。',
  'Routing intent may select Firewall inspection independently of a local declaration.': 'ローカルの指定とは別に、ルーティング インテントによって Firewall 検査が選択される場合があります。',
})
