import { useState } from 'react'
import { AzureNetDiagram, type AzSelectedEntity } from '../azure-net/AzureNetDiagram'
import type { AzNetTopology } from '../azure-net/model'
import { TopologyDiagram } from '../TopologyDiagram'
import type { ObjectSelection, Topology } from '../model'

const noop = () => {}
export default function SharedDiagram({ topology }: { topology: unknown }) {
  const [selected, setSelected] = useState<AzSelectedEntity>()
  const [selection, setSelection] = useState<ObjectSelection>()
  const [zoom, setZoom] = useState(1)
  if ((topology as Topology).version === 1) {
    const native = topology as Topology
    return <TopologyDiagram readOnly topology={native} hubId={native.hubs[0]?.id ?? ''} selected={[]} paths={[]} tracing={false}
      selection={selection} onObjectClick={setSelection} onObjectContextMenu={noop} onNodeMove={noop}
      onShowRouteMapRules={noop} zoom={zoom} onZoom={setZoom} onClearSelection={() => setSelection(undefined)} />
  }
  return <AzureNetDiagram readOnly topology={topology as AzNetTopology} selected={selected}
    onSelect={setSelected} onClearSelection={() => setSelected(undefined)} onMoveNode={noop}
    diagnostics={[]} showDiagnosticBadges={false} onShowIssues={noop} onClearHighlights={noop} />
}
