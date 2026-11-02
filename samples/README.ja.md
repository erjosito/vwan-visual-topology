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
