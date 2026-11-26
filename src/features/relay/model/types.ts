import type { Point, Sample } from '../../../shared/race'

export interface RelayCriteria {
  /** Maximum centre-to-centre distance, in chart units. */
  maxDistance: number
  /** Maximum absolute speed difference, in knots. */
  maxSpeedDelta: number
  /** Maximum absolute heading difference, in degrees. */
  maxHeadingDelta: number
  /** Continuous time all simultaneous conditions must hold, in seconds. */
  minDuration: number
  /** Designated relay water. An empty polygon means the whole chart. */
  zone: Point[]
  /** Internal time sampling step for rehearsal, in seconds. */
  timeStep: number
  /** Coarse offset search step, in seconds. */
  offsetStep: number
}

export type BoundaryCertainty = 'confirmed' | 'critical' | 'undetermined'

export interface RelayBoundary {
  side: 'lower' | 'upper'
  /** Best continuous estimate of the critical offset. */
  value: number
  certainty: BoundaryCertainty
  /** Conservative bracket when the saved samples cannot resolve the edge. */
  bracket: [number, number]
  reason: string
}

export interface RelayRun {
  start: number
  end: number
  duration: number
  /** Time inside the designated zone while the motion metrics remain aligned. */
  zoneDuration: number
  centroid: Point
  minDistance: number
  maxDistance: number
  maxSpeedDelta: number
  maxHeadingDelta: number
  allInZone: boolean
}

export type EncounterVerdict = 'feasible' | 'too-short' | 'outside-water' | 'metrics' | 'unsampled'

export interface RelayEncounter {
  id: number
  time: number
  centroid: Point
  nominalOffset: number
  searchLower: number
  searchUpper: number
  verdict: EncounterVerdict
  reason: string
  bestDuration: number
  bestOffset: number | null
  bestRun: RelayRun | null
}

export interface RelayOffsetRange {
  id: string
  encounterId: number
  lower: RelayBoundary
  upper: RelayBoundary
  /** Interior that remains clear of the numerical/critical boundary. */
  safeLower: number
  safeUpper: number
  centroid: Point
  bestDuration: number
  /** Earliest sustained handoff time at the most conservative safe offset. */
  previewHandoffTime: number | null
}

export interface RelayCondition {
  time: number
  recordTimeB: number
  a: Sample
  b: Sample
  distance: number
  speedDelta: number
  headingDelta: number
  aInZone: boolean
  bInZone: boolean
  inZone: boolean
  distanceOk: boolean
  speedOk: boolean
  headingOk: boolean
  compliant: boolean
  reasons: string[]
}

export interface RelayAnalysis {
  hasTwoTracks: boolean
  offsetDomain: [number, number]
  encounters: RelayEncounter[]
  ranges: RelayOffsetRange[]
  criteria: RelayCriteria
  generatedWith: { samplesA: number; samplesB: number }
}

export interface LiveRelayState {
  active: boolean
  handedOff: boolean
  boatB: Sample | null
  condition: RelayCondition | null
  compliantSince: number | null
  heldDuration: number
  handoffTime: number | null
  offset: number
  message: string
}
