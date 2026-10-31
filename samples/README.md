# Sample Topologies

## `three-hub-all-features-asymmetric.json`

A 3-hub global enterprise topology designed to exercise every major feature of the Virtual WAN Visual Topology Simulator:

- **3 Virtual Hubs with all 3 Hub Routing Preferences**:
  - **West Europe Hub (`hub-weu`)**: `ExpressRoute` preference, Secured Virtual Hub with Azure Firewall Routing Intent enabled for both **Private** and **Internet** traffic.
  - **East US Hub (`hub-eus`)**: `VPN` preference, standard hub.
  - **Japan East Hub (`hub-jpe`)**: `ASPath` preference, Secured Virtual Hub with Azure Firewall Routing Intent enabled for **Private** traffic.
- **ExpressRoute Peering Location (`Equinix AM5 Amsterdam`)**:
  - Connects `Amsterdam Core DC` (`10.110.0.0/16`, `10.110.10.0/24`) to both `West Europe Hub` and `East US Hub`.
- **All 4 Connectivity Transports**:
  - **ExpressRoute** via `Equinix AM5 Amsterdam`.
  - **BGP S2S VPN** (`Amsterdam Backup S2S VPN` to `West Europe Hub`, `New York Primary S2S VPN` to `East US Hub`).
  - **Static S2S VPN with Default-Route Propagation** (`Madrid Retail Branch` `10.130.0.0/24` with `propagateDefaultRoute: true` from `West Europe Hub`).
  - **SD-WAN** (`Tokyo SD-WAN Branch` `10.140.0.0/16` connected to `Japan East Hub`, demonstrating bidirectional SD-WAN route learning).
  - **Spoke BGP NVA (`EMEA Transit NVA Spoke`, peer `10.11.0.4`, ASN `65110`)**:
    - Hosts an embedded NVA router advertising both a **Downstream Standalone Azure VNet** (`Downstream AI Landing Zone VNet`, `10.90.0.0/16`) and a **Downstream On-Premises Site** (`Zurich B2B Partner Enclave`, `172.20.0.0/16`).
- **On-Premises WAN Link**:
  - `Transatlantic MPLS Backhaul` (`site-ams-dc` ↔ `site-nyc-hq`).
- **Hub & Site Route Maps**:
  - `WEU-ER-Out-Prepend-64496` (`hub-weu` outbound on `er-hub-weu`): prepends documentation ASN `64496 64496` on `10.0.0.0/8` routes.
  - `EUS-VPN-In-Summarize-NYC` (`hub-eus` inbound on `conn-vpn-nyc-eus`): permits `10.120.0.0/16` inbound.
  - `AMS-VPN-Out-Prepend` (`site-ams-dc` outbound on `conn-vpn-ams-weu`): prepends `65010` on backup VPN advertisements.
- **Intentional Asymmetric Routing Issue**:
  - **Forward (`Azure → Amsterdam Core DC`)**: `West Europe Hub` prefers **ExpressRoute** (`Equinix AM5 Amsterdam`) due to `ExpressRoute` hub routing preference and shorter inbound AS path `[65010]`.
  - **Return (`Amsterdam Core DC → West Europe Spokes`)**: Because `WEU-ER-Out-Prepend-64496` prepends `64496 64496` outbound on the `West Europe Hub` ExpressRoute link (`er-hub-weu`), `Amsterdam Core DC` sees a shorter AS path (`[65515]`) over `Amsterdam Backup S2S VPN` (`conn-vpn-ams-weu`) than over ExpressRoute (`[65515, 64496, 64496]`, or `[65515, 65515]` via `East US Hub`), causing return traffic to take **VPN** (or cross-region **East US Hub**) while forward traffic takes **West Europe ExpressRoute**.
