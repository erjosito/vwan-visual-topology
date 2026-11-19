import type { CourseBundle } from './course-contract'
import type { PracticeWorkspace } from './practice-workspace'
import type { PlatformDocument } from '../platform/contract'

export const scenarioTransitionConflict = 'Scenario extension conflicts with the current practice network'

/** Add the next mission's VNets and routing tables without replacing the learner's existing network. */
export function prepareCourseScenario(bundle: CourseBundle, scenarioId: string, previous?: PracticeWorkspace): PlatformDocument {
  const scenario = bundle.scenarios.find((entry) => entry.id === scenarioId)!
  const fallback = structuredClone(scenario.document)
  if (!previous?.active || previous.courseId !== bundle.course.id || previous.scenarioId !== scenario.extendsScenarioId) return fallback
  const source = bundle.scenarios.find((entry) => entry.id === scenario.extendsScenarioId)!.document
  if (fallback.mode === 'vwan' || source.mode === 'vwan' || previous.document.mode !== fallback.mode) throw new Error('Unsupported scenario extension')
  const result = structuredClone(previous.document)
  const newTables = fallback.topology.udrTables.filter((entry) => !source.topology.udrTables.some((old) => old.id === entry.id))
  for (const vnet of fallback.topology.vnets.filter((entry) => !source.topology.vnets.some((old) => old.id === entry.id))) {
    if (result.topology.vnets.some((entry) => entry.id === vnet.id)) throw new Error(scenarioTransitionConflict)
    result.topology.vnets.push(vnet)
  }
  for (const table of newTables) {
    if (result.topology.udrTables.some((entry) => entry.id === table.id)) throw new Error(scenarioTransitionConflict)
    result.topology.udrTables.push(table)
  }
  for (const vnet of fallback.topology.vnets) for (const subnet of vnet.subnets) {
    if (!newTables.some((table) => table.id === subnet.routeTableId)) continue
    const current = result.topology.vnets.find((entry) => entry.id === vnet.id)?.subnets.find((entry) => entry.id === subnet.id)
    if (!current || current.routeTableId && current.routeTableId !== subnet.routeTableId) throw new Error(scenarioTransitionConflict)
    current.routeTableId = subnet.routeTableId
  }
  result.topology.name = fallback.topology.name
  return result
}
