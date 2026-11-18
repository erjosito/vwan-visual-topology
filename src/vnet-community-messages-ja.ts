import { registerJapaneseMessages } from './messages'
import { vnetCommunityError, vnetCommunityHelp } from './vnet-communities'

registerJapaneseMessages({
  'VNet BGP community': 'VNet BGP コミュニティ',
  'Original VNet community configuration': '元の VNet コミュニティ構成',
  'Captured regional community': '取得済みのリージョン コミュニティ',
  'Not captured': '未取得',
  'Unknown VNet BGP community property.': '不明な VNet BGP コミュニティ プロパティです。',
  'VNet community tagging of gateway summaries is not assessed; only original VNet address-space advertisements receive VNet community metadata.': 'ゲートウェイ集約ルートへの VNet コミュニティの付与は未評価です。元の VNet アドレス空間の広告にのみ VNet コミュニティ メタデータが付与されます。',
  [vnetCommunityError]: '12076:0～65535 の形式でコミュニティを 1 つ入力してください（空白・先頭のゼロは不可）。',
  [vnetCommunityHelp]: 'VNet コミュニティは従来の ExpressRoute プライベート ピアリングでのみ広告されます。Virtual WAN、VPN、VNet ピアリング、NVA BGP には適用されません。リージョン コミュニティは取得済みメタデータであり、自動生成されません。',
})
