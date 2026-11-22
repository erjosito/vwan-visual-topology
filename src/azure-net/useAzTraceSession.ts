import { useMemo } from 'react'
import { useWorkspaceEditorState } from '../workspace-context'
import { contains, ipv4 } from '../validation'
import type { AzNetTopology } from './model'
import { traceAzNetFlow, traceAzNetPair, type AzSimulationResult } from './engine'
import { azEndpointKey, getAzNetEndpoints } from './endpoints'
import { AZ_NET_PAIR_LIMIT } from './diagnostics'
import { azDisplayResult } from './routing-input'
import { measureAzWork } from './performance'

export function useAzTraceSession(routingTopology: AzNetTopology, activeTopology: AzNetTopology, rawSimulation: AzSimulationResult, displayNames: string[]) {
  const rawEndpointOptions = useMemo(() => getAzNetEndpoints(routingTopology), [routingTopology])
  const endpointOptions = useMemo(() => azDisplayResult(rawEndpointOptions, displayNames), [rawEndpointOptions, displayNames])
  const [traceSourceKey, setTraceSourceKey] = useWorkspaceEditorState('aznet.traceSource', '')
  const [traceDestKey, setTraceDestKey] = useWorkspaceEditorState('aznet.traceDestination', '')
  const [customDestIp, setCustomDestIp] = useWorkspaceEditorState('aznet.traceIp', '')
  const [traceActive, setTraceActive] = useWorkspaceEditorState('aznet.traceActive', false)
  const [groupTrace, setGroupTrace] = useWorkspaceEditorState<{
    anchorKey: string; direction: 'to' | 'from'; group: 'workload' | 'site'
  } | null>('aznet.groupTrace', null)
  const rawSourceOpt = traceSourceKey ? rawEndpointOptions.find(option => option.key === traceSourceKey)
    : rawEndpointOptions.find(option => option.group === 'workload') ?? rawEndpointOptions[0]
  const rawDestOpt = traceDestKey ? rawEndpointOptions.find(option => option.key === traceDestKey)
    : rawEndpointOptions[rawEndpointOptions.length - 1] ?? rawEndpointOptions[0]
  const resolvedSourceOpt = endpointOptions.find(option => option.key === rawSourceOpt?.key)
  const resolvedDestOpt = endpointOptions.find(option => option.key === rawDestOpt?.key)
  const customIpNumber = customDestIp.trim() ? ipv4(customDestIp.trim()) : undefined
  const hasInvalidCustomIp = Boolean(customDestIp.trim()) && customIpNumber === undefined
  const customIpInEndpoint = Boolean(resolvedDestOpt && customIpNumber !== undefined && contains(resolvedDestOpt.prefix, customIpNumber))
  const rawPairAnalysis = useMemo(() => {
    if (!traceActive || groupTrace || hasInvalidCustomIp || !rawSourceOpt || !rawDestOpt) return null
    return measureAzWork('trace', () => traceAzNetPair(activeTopology, rawSimulation, rawSourceOpt.ref,
      rawSourceOpt.defaultIp, rawDestOpt.ref, customDestIp.trim() || rawDestOpt.defaultIp))
  }, [traceActive, groupTrace, hasInvalidCustomIp, rawSourceOpt, rawDestOpt, customDestIp, activeTopology, rawSimulation])
  const pairAnalysis = useMemo(() => azDisplayResult(rawPairAnalysis, displayNames), [rawPairAnalysis, displayNames])
  const rawSingleFlow = useMemo(() => {
    if (!traceActive || groupTrace || hasInvalidCustomIp || !rawSourceOpt || !rawDestOpt || !customDestIp.trim() || customIpInEndpoint) return null
    return measureAzWork('trace', () => traceAzNetFlow(activeTopology, rawSimulation, rawSourceOpt.ref, customDestIp.trim()))
  }, [traceActive, groupTrace, hasInvalidCustomIp, rawSourceOpt, rawDestOpt, customDestIp, customIpInEndpoint, activeTopology, rawSimulation])
  const singleFlowForCustomIp = useMemo(() => azDisplayResult(rawSingleFlow, displayNames), [rawSingleFlow, displayNames])
  const rawGroupedPaths = useMemo(() => {
    if (!traceActive || !groupTrace) return null
    const anchor = rawEndpointOptions.find(endpoint => endpoint.key === groupTrace.anchorKey)
    if (!anchor) return { paths: [], total: 0 }
    const others = rawEndpointOptions.filter(endpoint => endpoint.group === groupTrace.group && azEndpointKey(endpoint.ref) !== azEndpointKey(anchor.ref))
    return {
      total: others.length,
      paths: others.slice(0, AZ_NET_PAIR_LIMIT).map(other => {
        const source = groupTrace.direction === 'to' ? anchor : other
        const destination = groupTrace.direction === 'to' ? other : anchor
        return { source, destination, pair: measureAzWork('trace', () => traceAzNetPair(activeTopology,
          rawSimulation, source.ref, source.defaultIp, destination.ref, destination.defaultIp)) }
      }),
    }
  }, [traceActive, groupTrace, rawEndpointOptions, activeTopology, rawSimulation])
  const groupedPaths = useMemo(() => azDisplayResult(rawGroupedPaths, displayNames), [rawGroupedPaths, displayNames])
  return {
    endpointOptions, traceSourceKey, setTraceSourceKey, traceDestKey, setTraceDestKey,
    customDestIp, setCustomDestIp, traceActive, setTraceActive, groupTrace, setGroupTrace,
    resolvedSourceOpt, resolvedDestOpt, hasInvalidCustomIp, pairAnalysis, singleFlowForCustomIp, groupedPaths,
  }
}
