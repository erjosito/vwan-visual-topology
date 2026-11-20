import { registerJapaneseMessages } from '../messages'

registerJapaneseMessages({
  'VPN over ER private peering': 'ER プライベート ピアリング経由の VPN',
  'ER underlay and private tunnel endpoints': 'ER アンダーレイとプライベート トンネル エンドポイント',
  'Classic active/standby RouteBased VPN gateway only. Static routing, active/active, NAT, NVA and Virtual WAN private overlays are not assessed. BGP is not an Azure prerequisite.': '従来型のアクティブ / スタンバイの RouteBased VPN ゲートウェイのみ対応します。静的ルーティング、アクティブ / アクティブ、NAT、NVA、Virtual WAN のプライベート オーバーレイは未評価です。Azure 自体では BGP は必須ではありません。',
  'Azure ER link': 'Azure 側の ER リンク',
  'Site ER link': 'サイト側の ER リンク',
  'Azure private tunnel endpoint': 'Azure のプライベート トンネル エンドポイント',
  'On-premises private tunnel endpoint': 'オンプレミスのプライベート トンネル エンドポイント',
  'Gateway private IPs enabled': 'ゲートウェイのプライベート IP を有効化',
  'Gateway public IP SKU (explicit capability)': 'ゲートウェイのパブリック IP SKU (明示的な機能宣言)',
  'Gateway owned private tunnel IPs': 'ゲートウェイが所有するプライベート トンネル IP',
  'ER links': 'ER リンク',
  'Prefer the VPN overlay for Azure workload prefixes using the site inbound route map local preference. Direct ER may otherwise win without IPsec. Intended IPsec path is not verification of IKE/SAs or packet delivery.': 'サイトの受信ルート マップのローカル優先度で Azure ワークロード宛ての VPN オーバーレイを優先してください。未設定の場合、IPsec を使わない直接 ER 経路が選択される可能性があります。意図した IPsec 経路は IKE / SA の確立やパケット到達の証明ではありません。',
  'Select site prefixes advertised on this transport': 'このトランスポートで広告するサイト プレフィックスを選択',
  'Advertised prefixes (empty withdraws all)': '広告プレフィックス (空欄ですべて撤回)',
  'Exact selection from site routes, before outbound route maps. Use separate endpoint and workload prefixes on the same logical site. Static VPN routing uses its static-prefix field instead.': '送信ルート マップ適用前のサイト ルートから完全一致で選択します。同一の論理サイトでエンドポイント用とワークロード用のプレフィックスを分離してください。静的 VPN ルーティングには静的プレフィックス欄を使用します。',
})
