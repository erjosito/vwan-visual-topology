param location string = 'swedencentral'
param adminUsername string = 'azadmin'
param sshPublicKey string

var vmSize = 'Standard_B2ts_v2'
var imageRef = {
  publisher: 'Canonical'
  offer: '0001-com-ubuntu-server-jammy'
  sku: '22_04-lts-gen2'
  version: 'latest'
}

resource vnetHub 'Microsoft.Network/virtualNetworks@2024-05-01' existing = {
  name: 'vnet-aznet-hub'
}

resource vnetSpoke1 'Microsoft.Network/virtualNetworks@2024-05-01' existing = {
  name: 'vnet-aznet-spoke1'
}

resource vnetSpoke2 'Microsoft.Network/virtualNetworks@2024-05-01' existing = {
  name: 'vnet-aznet-spoke2'
}

// NSG for NVA & Branch VM
resource nsgLab 'Microsoft.Network/networkSecurityGroups@2024-05-01' = {
  name: 'nsg-aznet-lab'
  location: location
  properties: {
    securityRules: [
      {
        name: 'Allow-IKE-UDP-500'
        properties: {
          priority: 100
          protocol: 'Udp'
          access: 'Allow'
          direction: 'Inbound'
          sourceAddressPrefix: '*'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '500'
        }
      }
      {
        name: 'Allow-IPsec-UDP-4500'
        properties: {
          priority: 110
          protocol: 'Udp'
          access: 'Allow'
          direction: 'Inbound'
          sourceAddressPrefix: '*'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '4500'
        }
      }
      {
        name: 'Allow-RFC1918-Inbound'
        properties: {
          priority: 200
          protocol: '*'
          access: 'Allow'
          direction: 'Inbound'
          sourceAddressPrefixes: [
            '10.0.0.0/8'
            '172.16.0.0/12'
            '192.168.0.0/16'
          ]
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '*'
        }
      }
    ]
  }
}

// 1. GatewaySubnet Proxy Probe NIC & VM (snet-gw-proxy: 10.100.4.4)
resource nicGwProxy 'Microsoft.Network/networkInterfaces@2024-05-01' = {
  name: 'nic-vm-gw-proxy'
  location: location
  properties: {
    enableIPForwarding: false
    ipConfigurations: [
      {
        name: 'ipconfig1'
        properties: {
          privateIPAllocationMethod: 'Static'
          privateIPAddress: '10.100.4.4'
          subnet: {
            id: '${vnetHub.id}/subnets/snet-gw-proxy'
          }
        }
      }
    ]
  }
}

var probeCloudInit = '''#cloud-config
runcmd:
  - |
    cat << 'EOF' > /usr/local/bin/http-ident.py
    import http.server, socket, json
    class H(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            body = json.dumps({"hostname": socket.gethostname(), "path": self.path}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        def log_message(self, format, *args):
            pass
    http.server.HTTPServer(("0.0.0.0", 8080), H).serve_forever()
    EOF
  - nohup python3 /usr/local/bin/http-ident.py >/var/log/http-ident.log 2>&1 &
'''

resource vmGwProxy 'Microsoft.Compute/virtualMachines@2024-03-01' = {
  name: 'vm-gw-proxy'
  location: location
  properties: {
    hardwareProfile: { vmSize: vmSize }
    osProfile: {
      computerName: 'vm-gw-proxy'
      adminUsername: adminUsername
      customData: base64(probeCloudInit)
      linuxConfiguration: {
        disablePasswordAuthentication: true
        ssh: {
          publicKeys: [
            {
              path: '/home/${adminUsername}/.ssh/authorized_keys'
              keyData: sshPublicKey
            }
          ]
        }
      }
    }
    storageProfile: {
      imageReference: imageRef
      osDisk: {
        createOption: 'FromImage'
        managedDisk: { storageAccountType: 'StandardSSD_LRS' }
      }
    }
    networkProfile: {
      networkInterfaces: [
        { id: nicGwProxy.id }
      ]
    }
  }
}

// 2. Hub NVA Router NIC & VM (snet-nva: 10.100.2.4, ASN 65010, Peers with ARS 10.100.1.4 & 10.100.1.5)
resource pipHubNva 'Microsoft.Network/publicIPAddresses@2024-05-01' = {
  name: 'pip-vm-hub-nva'
  location: location
  sku: { name: 'Standard' }
  properties: { publicIPAllocationMethod: 'Static' }
}

resource nicHubNva 'Microsoft.Network/networkInterfaces@2024-05-01' = {
  name: 'nic-vm-hub-nva'
  location: location
  properties: {
    enableIPForwarding: true
    networkSecurityGroup: { id: nsgLab.id }
    ipConfigurations: [
      {
        name: 'ipconfig1'
        properties: {
          privateIPAllocationMethod: 'Static'
          privateIPAddress: '10.100.2.4'
          subnet: {
            id: '${vnetHub.id}/subnets/snet-nva'
          }
          publicIPAddress: {
            id: pipHubNva.id
          }
        }
      }
    ]
  }
}

var nvaCloudInit = '''#cloud-config
package_update: true
packages:
  - bird2
  - traceroute
runcmd:
  - sysctl -w net.ipv4.ip_forward=1
  - echo "net.ipv4.ip_forward=1" >> /etc/sysctl.conf
  - ip addr add 192.168.100.4/24 dev lo || true
  - ip route replace 10.100.1.0/26 via 10.100.2.1 dev eth0
  - ip route replace 10.101.0.0/16 via 10.100.2.1 dev eth0
  - ip route replace 10.102.0.0/16 via 10.100.2.1 dev eth0
  - |
    cat << 'EOF' > /etc/bird/bird.conf
    log syslog all;
    router id 10.100.2.4;
    protocol device { scan time 5; }
    protocol direct { ipv4; interface "lo"; }
    protocol kernel {
      ipv4 {
        import none;
        export where source = RTS_BGP;
      };
    }
    protocol static nva_origin {
      ipv4;
      route 192.168.100.0/24 blackhole;
    }
    filter export_to_ars {
      if net = 192.168.100.0/24 then accept;
      reject;
    }
    protocol bgp ars0 {
      local 10.100.2.4 as 65010;
      neighbor 10.100.1.4 as 65515;
      multihop 2;
      hold time 30;
      keepalive time 10;
      ipv4 {
        import all;
        export filter export_to_ars;
      };
    }
    protocol bgp ars1 {
      local 10.100.2.4 as 65010;
      neighbor 10.100.1.5 as 65515;
      multihop 2;
      hold time 30;
      keepalive time 10;
      ipv4 {
        import all;
        export filter export_to_ars;
      };
    }
    EOF
  - systemctl enable bird
  - systemctl restart bird
  - |
    cat << 'EOF' > /usr/local/bin/http-ident.py
    import http.server, socket, json
    class H(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            body = json.dumps({"hostname": socket.gethostname(), "path": self.path}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        def log_message(self, format, *args):
            pass
    http.server.HTTPServer(("0.0.0.0", 8080), H).serve_forever()
    EOF
  - nohup python3 /usr/local/bin/http-ident.py >/var/log/http-ident.log 2>&1 &
'''

resource vmHubNva 'Microsoft.Compute/virtualMachines@2024-03-01' = {
  name: 'vm-hub-nva'
  location: location
  properties: {
    hardwareProfile: { vmSize: vmSize }
    osProfile: {
      computerName: 'vm-hub-nva'
      adminUsername: adminUsername
      customData: base64(nvaCloudInit)
      linuxConfiguration: {
        disablePasswordAuthentication: true
        ssh: {
          publicKeys: [
            {
              path: '/home/${adminUsername}/.ssh/authorized_keys'
              keyData: sshPublicKey
            }
          ]
        }
      }
    }
    storageProfile: {
      imageReference: imageRef
      osDisk: {
        createOption: 'FromImage'
        managedDisk: { storageAccountType: 'StandardSSD_LRS' }
      }
    }
    networkProfile: {
      networkInterfaces: [
        { id: nicHubNva.id }
      ]
    }
  }
}

// 3. Spoke 1 Workload NIC & VM (snet-spoke1-work: 10.101.1.4)
resource nicSpoke1 'Microsoft.Network/networkInterfaces@2024-05-01' = {
  name: 'nic-vm-spoke1'
  location: location
  properties: {
    enableIPForwarding: false
    ipConfigurations: [
      {
        name: 'ipconfig1'
        properties: {
          privateIPAllocationMethod: 'Static'
          privateIPAddress: '10.101.1.4'
          subnet: {
            id: '${vnetSpoke1.id}/subnets/snet-spoke1-work'
          }
        }
      }
    ]
  }
}

resource vmSpoke1 'Microsoft.Compute/virtualMachines@2024-03-01' = {
  name: 'vm-spoke1'
  location: location
  properties: {
    hardwareProfile: { vmSize: vmSize }
    osProfile: {
      computerName: 'vm-spoke1'
      adminUsername: adminUsername
      customData: base64(probeCloudInit)
      linuxConfiguration: {
        disablePasswordAuthentication: true
        ssh: {
          publicKeys: [
            {
              path: '/home/${adminUsername}/.ssh/authorized_keys'
              keyData: sshPublicKey
            }
          ]
        }
      }
    }
    storageProfile: {
      imageReference: imageRef
      osDisk: {
        createOption: 'FromImage'
        managedDisk: { storageAccountType: 'StandardSSD_LRS' }
      }
    }
    networkProfile: {
      networkInterfaces: [
        { id: nicSpoke1.id }
      ]
    }
  }
}

// 4. Spoke 2 Workload NIC & VM (snet-spoke2-work: 10.102.1.4)
resource nicSpoke2 'Microsoft.Network/networkInterfaces@2024-05-01' = {
  name: 'nic-vm-spoke2'
  location: location
  properties: {
    enableIPForwarding: false
    ipConfigurations: [
      {
        name: 'ipconfig1'
        properties: {
          privateIPAllocationMethod: 'Static'
          privateIPAddress: '10.102.1.4'
          subnet: {
            id: '${vnetSpoke2.id}/subnets/snet-spoke2-work'
          }
        }
      }
    ]
  }
}

resource vmSpoke2 'Microsoft.Compute/virtualMachines@2024-03-01' = {
  name: 'vm-spoke2'
  location: location
  properties: {
    hardwareProfile: { vmSize: vmSize }
    osProfile: {
      computerName: 'vm-spoke2'
      adminUsername: adminUsername
      customData: base64(probeCloudInit)
      linuxConfiguration: {
        disablePasswordAuthentication: true
        ssh: {
          publicKeys: [
            {
              path: '/home/${adminUsername}/.ssh/authorized_keys'
              keyData: sshPublicKey
            }
          ]
        }
      }
    }
    storageProfile: {
      imageReference: imageRef
      osDisk: {
        createOption: 'FromImage'
        managedDisk: { storageAccountType: 'StandardSSD_LRS' }
      }
    }
    networkProfile: {
      networkInterfaces: [
        { id: nicSpoke2.id }
      ]
    }
  }
}

// 5. Storage Account + Private Endpoint (pe-aznet-blob in vnet-aznet-spoke1/snet-spoke1-pe -> 10.101.2.4)
var storageName = 'staznet${uniqueString(resourceGroup().id)}'

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    publicNetworkAccess: 'Disabled'
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
  }
}

resource privateEndpoint 'Microsoft.Network/privateEndpoints@2024-05-01' = {
  name: 'pe-aznet-blob'
  location: location
  properties: {
    subnet: {
      id: '${vnetSpoke1.id}/subnets/snet-spoke1-pe'
    }
    privateLinkServiceConnections: [
      {
        name: 'plsc-blob'
        properties: {
          privateLinkServiceId: storageAccount.id
          groupIds: [ 'blob' ]
        }
      }
    ]
  }
}

// 6. On-Premises Branch HQ Simulator VNet + StrongSwan/BIRD VM (10.250.0.0/16, ASN 65100)
resource vnetBranch 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: 'vnet-branch-hq'
  location: location
  properties: {
    addressSpace: {
      addressPrefixes: [ '10.250.0.0/16' ]
    }
    subnets: [
      {
        name: 'snet-branch'
        properties: {
          addressPrefix: '10.250.0.0/24'
          networkSecurityGroup: { id: nsgLab.id }
        }
      }
    ]
  }
}

resource pipBranch 'Microsoft.Network/publicIPAddresses@2024-05-01' = {
  name: 'pip-vm-branch-hq'
  location: location
  sku: { name: 'Standard' }
  properties: { publicIPAllocationMethod: 'Static' }
}

resource nicBranch 'Microsoft.Network/networkInterfaces@2024-05-01' = {
  name: 'nic-vm-branch-hq'
  location: location
  properties: {
    enableIPForwarding: true
    networkSecurityGroup: { id: nsgLab.id }
    ipConfigurations: [
      {
        name: 'ipconfig1'
        properties: {
          privateIPAllocationMethod: 'Static'
          privateIPAddress: '10.250.0.4'
          subnet: {
            id: '${vnetBranch.id}/subnets/snet-branch'
          }
          publicIPAddress: {
            id: pipBranch.id
          }
        }
      }
    ]
  }
}

var branchCloudInit = '''#cloud-config
package_update: true
packages:
  - strongswan
  - bird2
  - traceroute
runcmd:
  - sysctl -w net.ipv4.ip_forward=1
  - sysctl -w net.ipv4.conf.all.rp_filter=0
  - sysctl -w net.ipv4.conf.default.rp_filter=0
  - ip addr add 10.250.0.254/32 dev lo || true
  - |
    cat << 'EOF' > /usr/local/bin/http-ident.py
    import http.server, socket, json
    class H(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            body = json.dumps({"hostname": socket.gethostname(), "path": self.path}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        def log_message(self, format, *args):
            pass
    http.server.HTTPServer(("0.0.0.0", 8080), H).serve_forever()
    EOF
  - nohup python3 /usr/local/bin/http-ident.py >/var/log/http-ident.log 2>&1 &
'''

resource vmBranch 'Microsoft.Compute/virtualMachines@2024-03-01' = {
  name: 'vm-branch-hq'
  location: location
  properties: {
    hardwareProfile: { vmSize: vmSize }
    osProfile: {
      computerName: 'vm-branch-hq'
      adminUsername: adminUsername
      customData: base64(branchCloudInit)
      linuxConfiguration: {
        disablePasswordAuthentication: true
        ssh: {
          publicKeys: [
            {
              path: '/home/${adminUsername}/.ssh/authorized_keys'
              keyData: sshPublicKey
            }
          ]
        }
      }
    }
    storageProfile: {
      imageReference: imageRef
      osDisk: {
        createOption: 'FromImage'
        managedDisk: { storageAccountType: 'StandardSSD_LRS' }
      }
    }
    networkProfile: {
      networkInterfaces: [
        { id: nicBranch.id }
      ]
    }
  }
}

output branchPublicIp string = pipBranch.properties.ipAddress
output pePrivateIp string = privateEndpoint.properties.customDnsConfigs[0].ipAddresses[0]
