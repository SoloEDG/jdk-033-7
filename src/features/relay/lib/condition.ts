import { angleDelta } from '../../../shared/math'
import type { Boat, Sample } from '../../../shared/race'
import type { RelayCondition, RelayCriteria } from '../model/types'
import { pointInPolygon, trackSampleAt } from './track'

export function conditionFromBoats(
  aBoat: Boat,
  bSample: Sample,
  raceTime: number,
  recordTimeB: number,
  criteria: RelayCriteria,
  aSample?: Sample,
): RelayCondition {
  const bBoat = bSample.boat
  const distance = Math.hypot(aBoat.position.x - bBoat.position.x, aBoat.position.y - bBoat.position.y)
  const speedDelta = Math.abs(aBoat.knots - bBoat.knots)
  const headingDelta = Math.abs(angleDelta(aBoat.heading, bBoat.heading))
  const aInZone = pointInPolygon(aBoat.position, criteria.zone)
  const bInZone = pointInPolygon(bBoat.position, criteria.zone)
  const inZone = aInZone && bInZone
  const distanceOk = distance <= criteria.maxDistance + 1e-9
  const speedOk = speedDelta <= criteria.maxSpeedDelta + 1e-9
  const headingOk = headingDelta <= criteria.maxHeadingDelta + 1e-9
  const compliant = distanceOk && speedOk && headingOk && inZone

  const reasons: string[] = []
  if (!distanceOk) reasons.push(`距离 ${distance.toFixed(1)} > ${criteria.maxDistance.toFixed(1)}`)
  if (!speedOk) reasons.push(`速差 ${speedDelta.toFixed(2)} > ${criteria.maxSpeedDelta}`)
  if (!headingOk) reasons.push(`航向差 ${headingDelta.toFixed(1)}° > ${criteria.maxHeadingDelta}°`)
  if (!inZone) reasons.push('未同时处于指定水域')

  const fallbackA: Sample = aSample ?? {
    ...bSample,
    time: raceTime,
    boat: aBoat,
  }
  return {
    time: raceTime, recordTimeB, a: fallbackA, b: bSample,
    distance, speedDelta, headingDelta,
    aInZone, bInZone, inZone,
    distanceOk, speedOk, headingOk, compliant, reasons,
  }
}

/**
 * Evaluate the simultaneous handoff predicate on the common race clock.
 * offset = time at which track B's own record clock starts:
 *   recordTimeB = raceTime - offset.
 */
export function conditionAt(
  samplesA: Sample[],
  samplesB: Sample[],
  raceTime: number,
  offset: number,
  criteria: RelayCriteria,
): RelayCondition | null {
  const a = trackSampleAt(samplesA, raceTime)
  const recordTimeB = raceTime - offset
  const b = trackSampleAt(samplesB, recordTimeB)
  if (!a || !b) return null
  return conditionFromBoats(a.boat, b, raceTime, recordTimeB, criteria, a)
}

export function commonTimeDomain(a: Sample[], b: Sample[], offset: number): [number, number] | null {
  if (!a.length || !b.length) return null
  const lo = Math.max(a[0].time, b[0].time + offset)
  const hi = Math.min(a[a.length - 1].time, b[b.length - 1].time + offset)
  return hi >= lo ? [lo, hi] : null
}
