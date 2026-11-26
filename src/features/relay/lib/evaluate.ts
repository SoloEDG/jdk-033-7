import type { Sample } from '../../../shared/race'
import type { RelayCriteria, RelayRun } from '../model/types'
import { commonTimeDomain, conditionAt } from './condition'
import { centroidOf } from './track'

export interface OffsetEvaluation {
  offset: number
  domain: [number, number] | null
  runs: RelayRun[]
  metricRuns: RelayRun[]
  longestRun: RelayRun | null
  longestMetricRun: RelayRun | null
}

type Predicate = (c: NonNullable<ReturnType<typeof conditionAt>>) => boolean

function refineBoundary(
  a: Sample[], b: Sample[], offset: number, criteria: RelayCriteria,
  lo: number, hi: number, wantTrueAtHi: boolean, predicate: Predicate,
): number {
  let left = lo
  let right = hi
  for (let i = 0; i < 38; i++) {
    const mid = (left + right) / 2
    const c = conditionAt(a, b, mid, offset, criteria)
    const ok = c ? predicate(c) : false
    // wantTrueAtHi: false at left, true at right. Otherwise true at left/false at right.
    if (wantTrueAtHi) {
      if (ok) right = mid
      else left = mid
    } else {
      if (ok) left = mid
      else right = mid
    }
  }
  return (left + right) / 2
}

function buildRuns(
  conditions: NonNullable<ReturnType<typeof conditionAt>>[],
  predicate: Predicate,
  a: Sample[], b: Sample[], offset: number, criteria: RelayCriteria,
  withZoneDuration = false,
): RelayRun[] {
  const runs: RelayRun[] = []
  let startIndex = -1
  const flush = (endIndex: number) => {
    if (startIndex < 0) return
    const raw = conditions.slice(startIndex, endIndex + 1)
    const first = raw[0]
    const last = raw[raw.length - 1]
    let start = first.time
    let end = last.time
    if (startIndex > 0) {
      start = refineBoundary(a, b, offset, criteria, conditions[startIndex - 1].time, first.time, true, predicate)
    }
    if (endIndex < conditions.length - 1) {
      end = refineBoundary(a, b, offset, criteria, last.time, conditions[endIndex + 1].time, false, predicate)
    }
    const points = raw.map(c => c.b.boat.position)
    const centroid = centroidOf(points)
    const run: RelayRun = {
      start,
      end,
      duration: Math.max(0, end - start),
      zoneDuration: withZoneDuration
        ? raw.filter(c => c.inZone).length * criteria.timeStep
        : end - start,
      centroid,
      minDistance: Math.min(...raw.map(c => c.distance)),
      maxDistance: Math.max(...raw.map(c => c.distance)),
      maxSpeedDelta: Math.max(...raw.map(c => c.speedDelta)),
      maxHeadingDelta: Math.max(...raw.map(c => c.headingDelta)),
      allInZone: raw.every(c => c.inZone),
    }
    runs.push(run)
    startIndex = -1
  }

  conditions.forEach((c, i) => {
    if (predicate(c)) {
      if (startIndex < 0) startIndex = i
    } else {
      flush(i - 1)
    }
  })
  flush(conditions.length - 1)
  return runs
}

export function evaluateOffset(
  samplesA: Sample[],
  samplesB: Sample[],
  offset: number,
  criteria: RelayCriteria,
  window?: [number, number],
): OffsetEvaluation {
  const fullDomain = commonTimeDomain(samplesA, samplesB, offset)
  if (!fullDomain) return { offset, domain: null, runs: [], metricRuns: [], longestRun: null, longestMetricRun: null }
  const domain: [number, number] = window
    ? [Math.max(fullDomain[0], window[0]), Math.min(fullDomain[1], window[1])]
    : fullDomain
  if (domain[1] < domain[0]) return { offset, domain, runs: [], metricRuns: [], longestRun: null, longestMetricRun: null }

  const [lo, hi] = domain
  const conditions: NonNullable<ReturnType<typeof conditionAt>>[] = []
  // Integer step count avoids accumulated floating-point drift.
  const steps = Math.max(1, Math.ceil((hi - lo) / criteria.timeStep))
  for (let i = 0; i <= steps; i++) {
    const time = Math.min(hi, lo + i * criteria.timeStep)
    const condition = conditionAt(samplesA, samplesB, time, offset, criteria)
    if (condition) conditions.push(condition)
  }

  const runs = buildRuns(conditions, c => c.compliant, samplesA, samplesB, offset, criteria)
  const metricRuns = buildRuns(
    conditions,
    c => c.distanceOk && c.speedOk && c.headingOk,
    samplesA, samplesB, offset, criteria, true,
  )
  const longestRun = runs.length ? runs.reduce((x, y) => x.duration >= y.duration ? x : y) : null
  const longestMetricRun = metricRuns.length ? metricRuns.reduce((x, y) => x.duration >= y.duration ? x : y) : null
  return { offset, domain, runs, metricRuns, longestRun, longestMetricRun }
}
