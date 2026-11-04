# サンプル トポロジ一覧

**言語 / Language:** [English](./README.md) | **日本語**

このディレクトリには、[ユーザー ガイドと実践サンプル](../docs/README.ja.md)（[Web ドキュメント `vwan-simulator.com/docs/?lang=ja`](https://vwan-simulator.com/docs/?lang=ja)）で使用されている、そのままインポート可能な Virtual WAN トポロジ JSON ファイルが含まれています。

| ファイル | シナリオ | シミュレーター ライブ リンク |
| :--- | :--- | :--- |
| [`hub-routing-preferences.json`](./hub-routing-preferences.json) | **サンプル 1:** ExpressRoute と BGP VPN の二重接続における `ExpressRoute` 優先と `ASPath` 優先の比較 | [シミュレーターで開く](https://vwan-simulator.com/?sample=hub-routing-preferences) |
| [`secured-hub-routing-intent.json`](./secured-hub-routing-intent.json) | **サンプル 2:** プライベート + インターネットの Azure Firewall ルーティング インテントと静的 VPN 既定ルート伝達を備えたセキュリティで保護された仮想ハブ | [シミュレーターで開く](https://vwan-simulator.com/?sample=secured-hub-routing-intent) |
| [`spoke-bgp-nva-transit.json`](./spoke-bgp-nva-transit.json) | **サンプル 3:** 仮想ハブと BGP ピアリングし、配下のスタンドアロン VNet およびパートナー拠点へトランジットを提供するスポーク BGP NVA | [シミュレーターで開く](https://vwan-simulator.com/?sample=spoke-bgp-nva-transit) |
| [`three-hub-all-features-asymmetric.json`](./three-hub-all-features-asymmetric.json) | **サンプル 4:** 意図的な非対称ルーティング経路を含む 3 ハブ全機能エンタープライズ ショーケース | [シミュレーターで開く](https://vwan-simulator.com/?sample=three-hub-all-features-asymmetric) |

---

## `three-hub-all-features-asymmetric.json` — 詳細ウォークスルー

Virtual WAN トポロジ ラボのすべての主要機能を検証できるように設計された、3 ハブ構成のグローバル エンタープライズ トポロジです。

- **3 つの仮想ハブと 3 種類すべてのハブのルーティングの優先順位**:
  - **West Europe Hub (`hub-weu`)**: `ExpressRoute` 優先、**プライベート** と **インターネット** の両方で Azure Firewall ルーティング インテントを有効化したセキュリティで保護された仮想ハブ。
  - **East US Hub (`hub-eus`)**: `VPN` 優先、標準ハブ。
  - **Japan East Hub (`hub-jpe`)**: `ASPath` 優先、**プライベート** トラフィックに対して Azure Firewall ルーティング インテントを有効化したセキュリティで保護された仮想ハブ。
- **ExpressRoute ピアリングの場所 (`Equinix AM5 Amsterdam`)**:
  - `Amsterdam Core DC`（`10.100.0.0/16`、`10.101.0.0/16`）を `West Europe Hub` と `East US Hub` の両方に接続します。
- **4 種類すべてのトランスポートとスポーク BGP NVA**:
  - **ExpressRoute**（`Equinix AM5 Amsterdam` 経由）。
  - **BGP S2S VPN**（`West Europe Hub` へのバックアップ VPN、`East US Hub` へのプライマリ VPN）。
  - **既定ルート伝達を伴う静的 S2S VPN**（`West Europe Hub` から `0.0.0.0/0` を受け取る `Madrid Retail Branch` `10.120.0.0/16`）。
  - **SD-WAN**（`Japan East Hub` に接続された `Tokyo SD-WAN Branch` `10.130.0.0/16`）。
  - **スポーク BGP NVA (`EMEA NVA Transit Spoke`、ピア `10.12.0.4`、ASN `65110`)**:
    - 配下の **ダウンストリーム スタンドアロン Azure VNet**（`AI Landing Zone VNet (Downstream)`、`10.90.0.0/16`）と **ダウンストリーム オンプレミス サイト**（`Zurich Partner Enclave`、`172.20.0.0/16`）の両方をハブへアドバタイズします。
- **オンプレミス サイト間 WAN リンク**:
  - `Amsterdam Core DC` ↔ `New York Campus` 間の専用バックホール リンク。
- **ハブおよびサイトのルート マップ**:
  - `WEU-ER-Out-Prepend`（`hub-weu` の ExpressRoute リンクのアウトバウンド）: アドバタイズするルートに ASN `64496 64496` をプリペンド。
  - `WEU-VPN-In-Drop-10-101`（`hub-weu` のバックアップ VPN のインバウンド）: `10.101.0.0/16` を破棄し、バックアップ VPN 経由では `10.100.0.0/16` のみを許可。
  - `NYC-Out-Prepend-To-WEU`（`New York Campus` のアウトバウンド）: クロスリージョン バックアップ VPN に `65020 65020` をプリペンド。
- **意図的な非対称ルーティング**:
  - **往路（`Azure → Amsterdam Core DC`）**: `West Europe Hub` は `ExpressRoute` 優先のため、**ExpressRoute**（`Equinix AM5 Amsterdam`）を選択します。
  - **復路（`Amsterdam Core DC → West Europe スポーク`）**: `WEU-ER-Out-Prepend` が `West Europe Hub` の ExpressRoute リンクで `64496 64496` をプリペンドするため、`Amsterdam Core DC` から見るとバックアップ BGP VPN 経由の AS パス（`[65515]`）の方が ExpressRoute 経由（`[65515, 64496, 64496]`）より短くなり、復路は **BGP VPN** を通ります。

---

## 包括的な Azure VNet トポロジ (`samples/azure-net/`)

[`samples/azure-net/`](./azure-net/) ディレクトリには、**Azure Networking シミュレーター (プレビュー)** 用の **5 つの包括的な Azure VNet ショーケース トポロジ** と **9 つの実機検証シナリオ (`uc1`〜`uc9`)** が含まれています。すべてのファイルは `public/docs/samples/azure-net/` にミラーリングされ、`src/azure-net/engine.test.ts` によって自動検証されています。

| ファイル | 主な機能とアーキテクチャ | シミュレーター ライブ リンク |
| :--- | :--- | :--- |
| [`azure-net/enterprise-vnet-all-features-showcase.json`](./azure-net/enterprise-vnet-all-features-showcase.json) | **Enterprise マルチリージョン VNet 全機能ショーケース:** 2 リージョン ハブ VNet (`westeurope` + `northeurope`)、グローバル VNet ピアリング、両ハブの Azure Firewall、Azure Route Server (`ASN 65515`) + SD-WAN BGP NVA (`ASN 65110`)、ExpressRoute + Active-Active VPN ゲートウェイ、Private Endpoint ネットワーク ポリシー (`RouteTableEnabled` vs `Disabled`)、BGP `/16` LPM による `/8` サマリー UDR バイパス検出 | [Azure Net シミュレーターで開く](https://gray-wave-0e5ecfd03.3.azurestaticapps.net/?sample=enterprise-vnet-all-features-showcase) |
| [`azure-net/hub-spoke-firewall-udr.json`](./azure-net/hub-spoke-firewall-udr.json) | **Hub-and-Spoke + AzFW + GatewaySubnet UDR:** クラシック ハブ & スポーク VNet、ER/VPN ゲートウェイ、スポーク UDR、Private Endpoint `/32` `InterfaceEndpoint` 優先、`GatewaySubnet` 戻り UDR 欠落による非対称バイパス検出 | [Azure Net シミュレーターで開く](https://gray-wave-0e5ecfd03.3.azurestaticapps.net/?sample=hub-spoke-firewall-udr) |
| [`azure-net/ars-sdwan-nva-coexistence.json`](./azure-net/ars-sdwan-nva-coexistence.json) | **Azure Route Server + SD-WAN BGP NVA + ER/VPN B2B:** Azure Route Server (`branchToBranchTraffic: true`)、デュアル BGP NVA、ER/VPN ブランチ間ルート交換、スポークの BGP 伝播無効化ブラックホール検出 | [Azure Net シミュレーターで開く](https://gray-wave-0e5ecfd03.3.azurestaticapps.net/?sample=ars-sdwan-nva-coexistence) |
| [`azure-net/dual-hub-vnra-global-peering.json`](./azure-net/dual-hub-vnra-global-peering.json) | **Dual-Region Managed VNRA + Global Peering UDR:** 2 リージョンの 100 Gbps マネージド VNRA アプライアンス、グローバル VNet ピアリング越しの多段 UDR チェーン、ピアリング フラグ検証 | [Azure Net シミュレーターで開く](https://gray-wave-0e5ecfd03.3.azurestaticapps.net/?sample=dual-hub-vnra-global-peering) |
| [`azure-net/hybrid-vwan-and-hub-spoke.json`](./azure-net/hybrid-vwan-and-hub-spoke.json) | **Hybrid Virtual WAN Secured Hub + Classic Hub-and-Spoke:** セキュア Virtual WAN ハブ（Routing Intent 有効）とクラシック ハブ & スポーク VNet が共有 ExpressRoute MSEE (`ASN 12076`) を介して共存するハイブリッド構成 | [Azure Net シミュレーターで開く](https://gray-wave-0e5ecfd03.3.azurestaticapps.net/?sample=hybrid-vwan-and-hub-spoke) |

### 実機 Azure 検証シナリオ (`uc1`〜`uc9`)

| ファイル | 実機 Azure に対して検証されたルーティング動作 | シミュレーター ライブ リンク |
| :--- | :--- | :--- |
| [`azure-net/uc1-hub-spoke-nva-ars-baseline.json`](./azure-net/uc1-hub-spoke-nva-ars-baseline.json) | **UC1:** ARS (`ASN 65515`)、BGP NVA (`ASN 65001`)、VNet ピアリング (`AllowGatewayTransit` / `UseRemoteGateways`)、対称 UDR 検査の基本ハブ & スポーク | [UC1 を開く](https://gray-wave-0e5ecfd03.3.azurestaticapps.net/?sample=uc1-hub-spoke-nva-ars-baseline) |
| [`azure-net/uc2-gateway-subnet-missing-udr-asymmetry.json`](./azure-net/uc2-gateway-subnet-missing-udr-asymmetry.json) | **UC2:** `GatewaySubnet` にスポーク宛て戻り UDR がない場合の非対称ファイアウォール バイパス | [UC2 を開く](https://gray-wave-0e5ecfd03.3.azurestaticapps.net/?sample=uc2-gateway-subnet-missing-udr-asymmetry) |
| [`azure-net/uc3-bgp-propagation-and-peering-gates.json`](./azure-net/uc3-bgp-propagation-and-peering-gates.json) | **UC3:** 3 つのスポーク間での `disableBgpRoutePropagation`、`allowGatewayTransit`、`useRemoteGateways`、`allowForwardedTraffic` の相互作用 | [UC3 を開く](https://gray-wave-0e5ecfd03.3.azurestaticapps.net/?sample=uc3-bgp-propagation-and-peering-gates) |
| [`azure-net/uc4-private-endpoint-udr-override.json`](./azure-net/uc4-private-endpoint-udr-override.json) | **UC4:** `privateEndpointNetworkPolicies: RouteTableEnabled` を有効化するまで Private Endpoint `/32 InterfaceEndpoint` ルートが `/16` UDR に優先する動作 | [UC4 を開く](https://gray-wave-0e5ecfd03.3.azurestaticapps.net/?sample=uc4-private-endpoint-udr-override) |
| [`azure-net/uc5-ars-branch-to-branch-and-bgp-selection.json`](./azure-net/uc5-ars-branch-to-branch-and-bgp-selection.json) | **UC5:** デュアル BGP NVA (`ASN 65001` vs `ASN 65002` + AS パス プリペンド) と ARS のベスト パス選択・ECMP | [UC5 を開く](https://gray-wave-0e5ecfd03.3.azurestaticapps.net/?sample=uc5-ars-branch-to-branch-and-bgp-selection) |
| [`azure-net/uc6-ars-default-route-self-blackhole.json`](./azure-net/uc6-ars-default-route-self-blackhole.json) | **UC6:** BGP NVA が `0.0.0.0/0` を ARS に広報した際に `snet-nva` 自身に `0.0.0.0/0` が注入されて発生する自己ブラックホール ループ | [UC6 を開く](https://gray-wave-0e5ecfd03.3.azurestaticapps.net/?sample=uc6-ars-default-route-self-blackhole) |
| [`azure-net/uc7-bgp-lpm-bypasses-summary-udr.json`](./azure-net/uc7-bgp-lpm-bypasses-summary-udr.json) | **UC7:** BGP ルート伝播が有効な場合に、より具体的な `/16` BGP ルートが `10.0.0.0/8` サマリー UDR に LPM で優先してファイアウォールをバイパスする動作 | [UC7 を開く](https://gray-wave-0e5ecfd03.3.azurestaticapps.net/?sample=uc7-bgp-lpm-bypasses-summary-udr) |
| [`azure-net/uc8-udr-next-hop-types-and-vng-transit-trap.json`](./azure-net/uc8-udr-next-hop-types-and-vng-transit-trap.json) | **UC8:** `NextHopType=None` ブラックホール、`NextHopType=Internet` 強制ブレークアウト、およびスポーク間通信における無効な `NextHopType=VirtualNetworkGateway` | [UC8 を開く](https://gray-wave-0e5ecfd03.3.azurestaticapps.net/?sample=uc8-udr-next-hop-types-and-vng-transit-trap) |
| [`azure-net/uc9-expressroute-hairpin-two-vnets.json`](./azure-net/uc9-expressroute-hairpin-two-vnets.json) | **UC9:** 共有 ExpressRoute 回線 / MSEE (`ASN 12076`) を介した 2 つのハブ VNet 間のヘアピン トランジット | [UC9 を開く](https://gray-wave-0e5ecfd03.3.azurestaticapps.net/?sample=uc9-expressroute-hairpin-two-vnets) |
