import { engineVersion, type PlatformRequest, type PlatformResult } from './contract'

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && Object.getPrototypeOf(value) === Object.prototype
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(item => typeof item === 'string')

/** Check transport identity and completeness, not the truth of opaque assessment evidence. */
export function validatePlatformResult(input: unknown, request: PlatformRequest): PlatformResult {
  if (!object(input) || Object.values(Object.getOwnPropertyDescriptors(input)).some(field => !('value' in field))) {
    throw new Error('Plain worker result required.')
  }
  if (input.contractVersion !== request.contractVersion || input.engineVersion !== engineVersion
    || !['complete', 'invalid', 'not assessed'].includes(String(input.status)) || typeof input.revision !== 'string'
    || !strings(input.limitations) || !Array.isArray(input.errors) || !Array.isArray(input.assessments)
    || input.errors.some(error => !object(error) || typeof error.code !== 'string' || typeof error.message !== 'string')
    || input.assessments.some(entry => !object(entry) || typeof entry.id !== 'string'
      || !['satisfied', 'violated', 'not assessed'].includes(String(entry.outcome)) || !strings(entry.reasons))) {
    throw new Error('Invalid worker result envelope.')
  }
  if (input.status === 'invalid') {
    if (!input.errors.length || input.assessments.length || input.document !== undefined || input.simulation !== undefined) {
      throw new Error('Invalid requests cannot carry passing evidence.')
    }
  } else {
    if (input.status === 'complete' && (input.errors.length || !object(input.document) || !input.revision)) {
      throw new Error('Complete worker result lacks admitted document evidence.')
    }
    if (input.status === 'complete' && (request.operation === 'simulate' || request.operation === 'evaluate')
      && input.simulation === undefined) throw new Error('Complete worker result lacks simulation evidence.')
    if (input.document !== undefined && (!object(input.document) || input.document.mode !== request.document.mode
      || !object(input.document.topology) || input.document.topology.version !== (request.document.mode === 'vwan' ? 1 : 2))) {
      throw new Error('Worker result provider mismatch.')
    }
    if (input.simulation !== undefined) {
      if (!object(input.document) || !object(input.simulation) || !strings(input.simulation.warnings)
        || (request.document.mode === 'vwan'
          ? typeof input.simulation.converged !== 'boolean' || !object(input.simulation.siteTables) || !object(input.simulation.hubTables)
          : !object(input.simulation.subnetTables) || !object(input.simulation.siteRibs) || !object(input.simulation.vwanHubTables))) {
        throw new Error('Worker simulation provider mismatch.')
      }
    }
    const expected = request.operation === 'evaluate' || request.operation === 'simulate' ? request.requirements ?? [] : []
    const ids = input.assessments.map(entry => entry.id)
    if (ids.length !== expected.length || new Set(ids).size !== ids.length
      || expected.some(requirement => !ids.includes(requirement.id))
      || input.status === 'complete' && input.assessments.some(entry => entry.outcome === 'not assessed')
      || input.errors.length && input.assessments.some(entry => entry.outcome !== 'not assessed')) {
      throw new Error('Worker result requirements are incomplete or inconsistent.')
    }
  }
  return input as PlatformResult
}
