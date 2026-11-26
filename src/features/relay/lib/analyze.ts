import { distance } from '../../../shared/math'
import type { Sample } from '../../../shared/race'
import { evaluateOffset, type OffsetEvaluation } from './evaluate'
import type {
  RelayBoundary,
  RelayCriteria,
  RelayEncounter,
  RelayOffsetRange,
} from '../model/types'
import { commonTimeDomain, conditionAt } from './condition'
import { centroidOf, round } from './track'

interface EncounterCluster {
  centroid: { x: number; y: number }
  medianTimeA: number
  startTime: number
  endTime: number
  timeWindow: [number, number]
  lower: number
  upper: number
  nominalOffset: number
  nearestDistance: number
}

interface NearestPoint {
  indexA: number
  indexB: number
  time: number
  offset: number
  distance: number
  x: number
  y: number
}

const keyOf = (x: number, y: number) => `${Math.floor(x)},${Math.floor(y)}`

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** Offset-independent fallback for tracks whose timestamps are not aligned at zero. */
function detectGeometricClusters(a: Sample[], b: Sample[], criteria: RelayCriteria): EncounterCluster[] {
  const searchRadius = Math.max(120, criteria.maxDistance + 70)
  const cellSize = searchRadius
  const grid = new Map<string, number[]>()
  b.forEach((sample, index) => {
    const key = keyOf(Math.floor(sample.boat.position.x / cellSize), Math.floor(sample.boat.position.y / cellSize))
    const list = grid.get(key)
    if (list) list.push(index)
    else grid.set(key, [index])
  })
  const nearest: NearestPoint[] = []
  a.forEach((sa, indexA) => {
    const cx = Math.floor(sa.boat.position.x / cellSize)
    const cy = Math.floor(sa.boat.position.y / cellSize)
    let bestIndex = -1
    let bestDistance = Infinity
    for (let ix = cx - 1; ix <= cx + 1; ix++) {
      for (let iy = cy - 1; iy <= cy + 1; iy++) {
        for (const indexB of grid.get(`${ix},${iy}`) ?? []) {
          const d = distance(sa.boat.position, b[indexB].boat.position)
          if (d < bestDistance) {
            bestDistance = d
            bestIndex = indexB
          }
        }
      }
    }
    if (bestIndex >= 0 && bestDistance <= searchRadius) {
      const sb = b[bestIndex]
      nearest.push({
        indexA, indexB: bestIndex, time: sa.time, offset: sa.time - sb.time,
        distance: bestDistance,
        x: (sa.boat.position.x + sb.boat.position.x) / 2,
        y: (sa.boat.position.y + sb.boat.position.y) / 2,
      })
    }
  })
  const minima = nearest.filter(point =>
    point.indexA > 2 && point.indexA < a.length - 3 &&
    !nearest.some(other => Math.abs(other.time - point.time) <= 3.2 && other.distance < point.distance - .75))
  const accepted: NearestPoint[] = []
  for (const point of minima.sort((x, y) => x.distance - y.distance)) {
    if (!accepted.some(other => Math.abs(other.time - point.time) < 7 || distance(point, other) < 125)) accepted.push(point)
  }
  const globalLower = -b[b.length - 1].time
  const globalUpper = a[a.length - 1].time
  return accepted.sort((x, y) => x.time - y.time).slice(0, 4).map(point => {
    const start = Math.max(0, point.time - criteria.minDuration - 2)
    const end = point.time + criteria.minDuration + 2
    return {
      centroid: { x: point.x, y: point.y },
      medianTimeA: point.time,
      startTime: point.time - 2,
      endTime: point.time + 2,
      timeWindow: [start, end] as [number, number],
      lower: Math.max(globalLower, point.offset - 12),
      upper: Math.min(globalUpper, point.offset + 12),
      nominalOffset: round(point.offset, 3),
      nearestDistance: round(point.distance, 2),
    }
  })
}

/**
 * Detect separated near-encounter segments on the reference (zero) offset.
 * Offset feasibility is then solved continuously around each segment.
 */
export function detectClusters(
  a: Sample[], b: Sample[], criteria: RelayCriteria, referenceOffset = 0,
): EncounterCluster[] {
  const domain = commonTimeDomain(a, b, referenceOffset)
  if (!domain) return []
  const nearRadius = Math.max(92, criteria.maxDistance + 62)
  const cellSize = nearRadius
  const grid = new Map<string, number[]>()
  b.forEach((sample, index) => {
    const key = keyOf(Math.floor(sample.boat.position.x / cellSize), Math.floor(sample.boat.position.y / cellSize))
    const list = grid.get(key)
    if (list) list.push(index)
    else grid.set(key, [index])
  })
  const scanStep = 0.1
  const points: { time: number; x: number; y: number; distance: number }[] = []
  const steps = Math.ceil((domain[1] - domain[0]) / scanStep)
  for (let i = 0; i <= steps; i++) {
    const time = Math.min(domain[1], domain[0] + i * scanStep)
    const condition = conditionAt(a, b, time, referenceOffset, criteria)
    if (condition) {
      points.push({
        time,
        x: (condition.a.boat.position.x + condition.b.boat.position.x) / 2,
        y: (condition.a.boat.position.y + condition.b.boat.position.y) / 2,
        distance: condition.distance,
      })
    }
  }

  const rawRuns: typeof points[] = []
  let current: typeof points = []
  for (const point of points) {
    if (point.distance <= nearRadius) {
      current.push(point)
    } else if (current.length) {
      rawRuns.push(current)
      current = []
    }
  }
  if (current.length) rawRuns.push(current)

  // Merge short above-radius gaps caused by a brief turn or sample noise.
  const merged: typeof points[] = []
  for (const run of rawRuns) {
    const previous = merged[merged.length - 1]
    if (previous && run[0].time - previous[previous.length - 1].time <= 2.4) {
      previous.push(...run)
    } else {
      merged.push([...run])
    }
  }

  const globalLower = -b[b.length - 1].time
  const globalUpper = a[a.length - 1].time
  const temporal = merged
    .filter(run => run.length >= 2)
    .slice(0, 6)
    .map(run => {
      const start = run[0].time
      const end = run[run.length - 1].time
      const centroid = centroidOf(run)

      // Estimate the large-scale time shift from nearby geometric pairs. The
      // continuous feasible interval is then solved around this nominal shift.
      const offsetCandidates: number[] = []
      for (const sampleA of a) {
        if (sampleA.time < start - 1 || sampleA.time > end + 1) continue
        const cx = Math.floor(sampleA.boat.position.x / cellSize)
        const cy = Math.floor(sampleA.boat.position.y / cellSize)
        let bestB: Sample | null = null
        let bestD = nearRadius * 1.25
        for (let ix = cx - 1; ix <= cx + 1; ix++) {
          for (let iy = cy - 1; iy <= cy + 1; iy++) {
            for (const indexB of grid.get(`${ix},${iy}`) ?? []) {
              const sampleB = b[indexB]
              const d = distance(sampleA.boat.position, sampleB.boat.position)
              if (d < bestD) {
                bestD = d
                bestB = sampleB
              }
            }
          }
        }
        if (bestB) offsetCandidates.push(sampleA.time - bestB.time)
      }
      const nominalOffset = offsetCandidates.length ? median(offsetCandidates) : referenceOffset
      const searchPadding = 12
      return {
        centroid,
        medianTimeA: (start + end) / 2,
        startTime: start,
        endTime: end,
        timeWindow: [
          Math.max(0, start - criteria.minDuration - 3),
          end + criteria.minDuration + 3,
        ] as [number, number],
        lower: Math.max(globalLower, nominalOffset - searchPadding),
        upper: Math.min(globalUpper, nominalOffset + searchPadding),
        nominalOffset: round(nominalOffset, 3),
        nearestDistance: round(Math.min(...run.map(p => p.distance)), 2),
      }
    })

  const geometric = detectGeometricClusters(a, b, criteria)
  for (const candidate of geometric) {
    const duplicate = temporal.some(cluster =>
      (candidate.medianTimeA >= cluster.startTime - 5 && candidate.medianTimeA <= cluster.endTime + 8) ||
      distance(candidate.centroid, cluster.centroid) < 230)
    if (!duplicate) temporal.push(candidate)
  }
  return temporal.sort((x, y) => x.medianTimeA - y.medianTimeA).slice(0, 6)
}

function runMatchesEncounter(runCentroid: { x: number; y: number }, cluster: EncounterCluster): boolean {
  return distance(runCentroid, cluster.centroid) <= 230
}

function feasibleAt(
  a: Sample[], b: Sample[], criteria: RelayCriteria, cluster: EncounterCluster, offset: number,
): OffsetEvaluation | null {
  const evaluation = evaluateOffset(a, b, offset, criteria, cluster.timeWindow)
  const run = evaluation.runs.find(run =>
    run.duration + 1e-7 >= criteria.minDuration && runMatchesEncounter(run.centroid, cluster))
  return run ? evaluation : null
}

function bisectOffsetEdge(
  a: Sample[], b: Sample[], criteria: RelayCriteria, cluster: EncounterCluster,
  knownBad: number, knownGood: number,
): number {
  let bad = knownBad
  let good = knownGood
  for (let i = 0; i < 36; i++) {
    const mid = (bad + good) / 2
    const ok = Boolean(feasibleAt(a, b, criteria, cluster, mid))
    // Works for both edge orientations: good and bad may be in either order.
    if (ok) good = mid
    else bad = mid
  }
  return (bad + good) / 2
}

function sampleGapUncertainty(
  a: Sample[], b: Sample[], criteria: RelayCriteria, value: number, window?: [number, number],
): number {
  const evaluation = evaluateOffset(a, b, value, criteria, window)
  const run = evaluation.longestRun
  if (!run) return 0.04
  const gapNear = (samples: Sample[], time: number) => {
    let index = samples.findIndex(s => s.time >= time)
    if (index < 0) index = samples.length - 1
    if (index <= 0) return 0
    return samples[index].time - samples[index - 1].time
  }
  const gapA = Math.max(gapNear(a, run.start), gapNear(a, run.end))
  const gapB = Math.max(gapNear(b, run.start - value), gapNear(b, run.end - value))
  return Math.max(0.03, Math.min(1, (gapA + gapB) * 0.25))
}

function makeBoundary(
  side: 'lower' | 'upper', value: number, searchEdge: boolean, gapError: number,
): RelayBoundary {
  const uncertainty = searchEdge ? Math.max(0.25, gapError * 2) : gapError
  return {
    side,
    value: round(value, 3),
    certainty: searchEdge ? 'undetermined' : 'critical',
    bracket: [round(value - uncertainty, 3), round(value + uncertainty, 3)],
    reason: searchEdge
      ? '已到预演搜索边界，保存航迹不能确定外侧是否仍可用'
      : '阈值临界值；等号是否成立及实际状态须在实赛重新确认',
  }
}

interface ScannedPoint {
  offset: number
  feasible: boolean
  evaluation: OffsetEvaluation
}

function analyseCluster(
  a: Sample[], b: Sample[], criteria: RelayCriteria, cluster: EncounterCluster, id: number,
): { encounter: RelayEncounter; ranges: RelayOffsetRange[] } {
  const span = cluster.upper - cluster.lower
  const step = Math.max(0.1, criteria.offsetStep)
  const count = Math.max(2, Math.ceil(span / step))
  const points: ScannedPoint[] = []
  let best: ScannedPoint | null = null

  for (let i = 0; i <= count; i++) {
    const offset = cluster.lower + Math.min(span, i * step)
    const evaluation = evaluateOffset(a, b, offset, criteria, cluster.timeWindow)
    const feasible = Boolean(evaluation.runs.some(run =>
      run.duration + 1e-7 >= criteria.minDuration && runMatchesEncounter(run.centroid, cluster)))
    const point = { offset, feasible, evaluation }
    points.push(point)
    const metric = evaluation.longestMetricRun
    if (metric && (!best || metric.zoneDuration > (best.evaluation.longestMetricRun?.zoneDuration ?? -1))) best = point
  }

  const encounter: RelayEncounter = {
    id,
    time: cluster.medianTimeA,
    centroid: cluster.centroid,
    nominalOffset: cluster.nominalOffset,
    searchLower: round(cluster.lower, 3),
    searchUpper: round(cluster.upper, 3),
    verdict: 'unsampled',
    reason: '保存航迹在该偏移范围内没有重叠样本',
    bestDuration: 0,
    bestOffset: null,
    bestRun: null,
  }

  const ranges: RelayOffsetRange[] = []
  const feasibleIndexes = points.map((p, i) => p.feasible ? i : -1).filter(i => i >= 0)

  if (feasibleIndexes.length) {
    encounter.verdict = 'feasible'
    encounter.reason = '存在同时满足距离、速差、航向差、水域和持续时间的连续偏移区间'
    const groups: [number, number][] = []
    let start = feasibleIndexes[0]
    let previous = start
    for (const index of feasibleIndexes.slice(1)) {
      if (index === previous + 1) previous = index
      else { groups.push([start, previous]); start = previous = index }
    }
    groups.push([start, previous])

    groups.forEach(([first, last], groupIndex) => {
      const lowerSearchEdge = first === 0
      const upperSearchEdge = last === points.length - 1
      const lower = lowerSearchEdge
        ? points[first].offset
        : bisectOffsetEdge(a, b, criteria, cluster, points[first - 1].offset, points[first].offset)
      const upper = upperSearchEdge
        ? points[last].offset
        : bisectOffsetEdge(a, b, criteria, cluster, points[last + 1].offset, points[last].offset)
      const lowerError = sampleGapUncertainty(a, b, criteria, lower, cluster.timeWindow)
      const upperError = sampleGapUncertainty(a, b, criteria, upper, cluster.timeWindow)
      const lowerBoundary = makeBoundary('lower', lower, lowerSearchEdge, lowerError)
      const upperBoundary = makeBoundary('upper', upper, upperSearchEdge, upperError)
      const safety = 0.03
      const safeLower = round(lower + safety, 3)
      const safeUpper = round(upper - safety, 3)
      const middle = safeLower <= safeUpper ? (safeLower + safeUpper) / 2 : (lower + upper) / 2
      const preview = feasibleAt(a, b, criteria, cluster, middle)
      const run = preview?.runs.find(r => runMatchesEncounter(r.centroid, cluster)) ?? preview?.runs[0] ?? null
      ranges.push({
        id: `E${id + 1}-R${groupIndex + 1}`,
        encounterId: id,
        lower: lowerBoundary,
        upper: upperBoundary,
        safeLower: round(safeLower, 3),
        safeUpper: round(safeUpper, 3),
        centroid: run?.centroid ?? cluster.centroid,
        bestDuration: run?.duration ?? criteria.minDuration,
        previewHandoffTime: run ? round(run.start + criteria.minDuration, 3) : null,
      })
    })
  } else if (best?.evaluation.longestMetricRun) {
    const run = best.evaluation.longestMetricRun
    encounter.bestOffset = round(best.offset, 3)
    encounter.bestDuration = round(run.duration, 2)
    encounter.bestRun = run
    if (run.duration + 1e-7 < criteria.minDuration) {
      encounter.verdict = 'too-short'
      encounter.reason = `较早近遇的并行段仅 ${run.duration.toFixed(2)}s，不足以持续 ${criteria.minDuration}s`
    } else if (run.zoneDuration + 1e-7 < criteria.minDuration) {
      encounter.verdict = 'outside-water'
      encounter.reason = `运动并行 ${run.duration.toFixed(2)}s，但指定水域内可确认并行仅 ${run.zoneDuration.toFixed(2)}s`
    } else {
      encounter.verdict = 'metrics'
      encounter.reason = '距离、速差或航向差在关键段越界'
    }
  } else {
    const nominal = evaluateOffset(a, b, cluster.nominalOffset, criteria, cluster.timeWindow)
    encounter.bestOffset = cluster.nominalOffset
    if (nominal.domain) {
      const time = cluster.medianTimeA
      let reason: string | null = null
      for (let t = time - 3; t <= time + 3; t += criteria.timeStep * 4) {
        const c = conditionAt(a, b, t, cluster.nominalOffset, criteria)
        if (c && !c.compliant) {
          reason = c.reasons[0] ?? '条件不合规'
          break
        }
      }
      encounter.verdict = 'metrics'
      encounter.reason = reason ? `近遇处：${reason}` : '近遇处缺少持续合规段'
    }
  }

  if (encounter.bestOffset === null && best) {
    encounter.bestOffset = round(best.offset, 3)
    encounter.bestDuration = round(best.evaluation.longestMetricRun?.duration ?? 0, 2)
    encounter.bestRun = best.evaluation.longestMetricRun
  }

  return { encounter, ranges }
}

export function analyzeRelayTracks(
  a: Sample[] | undefined,
  b: Sample[] | undefined,
  criteria: RelayCriteria,
) {
  if (!a?.length || !b?.length) {
    return {
      hasTwoTracks: false as const,
      offsetDomain: [-120, 120] as [number, number],
      encounters: [] as RelayEncounter[],
      ranges: [] as RelayOffsetRange[],
      criteria,
      generatedWith: { samplesA: a?.length ?? 0, samplesB: b?.length ?? 0 },
    }
  }

  const clusters = detectClusters(a, b, criteria)
  const encounters: RelayEncounter[] = []
  const ranges: RelayOffsetRange[] = []
  clusters.forEach((cluster, index) => {
    const result = analyseCluster(a, b, criteria, cluster, index)
    encounters.push(result.encounter)
    ranges.push(...result.ranges)
  })

  return {
    hasTwoTracks: true as const,
    offsetDomain: [-b[b.length - 1].time, a[a.length - 1].time] as [number, number],
    encounters,
    ranges,
    criteria,
    generatedWith: { samplesA: a.length, samplesB: b.length },
  }
}

export type RelayAnalysisResult = ReturnType<typeof analyzeRelayTracks>
