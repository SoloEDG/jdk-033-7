import { angleDelta, distance, normalize, pointAt, mix } from '../../../shared/math'
import type { Point, Sample } from '../../../shared/race'

/**
 * Interpolate a saved voyage at an arbitrary record time.
 * The saved recorder already uses dense samples; interpolation keeps an offset
 * continuous instead of snapping rehearsal to integer seconds.
 */
export function trackSampleAt(samples: Sample[], time: number): Sample | null {
  if (!samples.length) return null
  if (time <= samples[0].time) return { ...samples[0], time }
  const last = samples[samples.length - 1]
  if (time >= last.time) return { ...last, time }

  let lo = 0
  let hi = samples.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (samples[mid].time < time) lo = mid + 1
    else hi = mid
  }
  const next = lo
  if (next <= 0) return { ...samples[0], time }
  const a = samples[next - 1]
  const b = samples[next]
  const span = b.time - a.time
  const t = span > 0 ? (time - a.time) / span : 0
  // Control state is discrete; do not invent intermediate rudder/sheet states.
  const discrete = t < 1 ? a : b
  return {
    ...discrete,
    time,
    boat: {
      ...discrete.boat,
      position: pointAt(a.boat.position, b.boat.position, t),
      heading: normalize(a.boat.heading + angleDelta(a.boat.heading, b.boat.heading) * t),
      knots: mix(a.boat.knots, b.boat.knots, t),
    },
    wind: a.wind && b.wind
      ? {
          bearing: normalize(a.wind.bearing + angleDelta(a.wind.bearing, b.wind.bearing) * t),
          knots: mix(a.wind.knots, b.wind.knots, t),
        }
      : (discrete.wind ?? { bearing: 0, knots: 0 }),
  }
}

export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  if (polygon.length < 3) return true
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y
    const xj = polygon[j].x, yj = polygon[j].y
    const intersects = ((yi > point.y) !== (yj > point.y)) &&
      (point.x < (xj - xi) * (point.y - yi) / ((yj - yi) || Number.EPSILON) + xi)
    if (intersects) inside = !inside
  }
  return inside
}

export function chartDistance(a: Sample, b: Sample): number {
  return distance(a.boat.position, b.boat.position)
}

export function metricValues(a: Sample, b: Sample) {
  return {
    distance: chartDistance(a, b),
    speedDelta: Math.abs(a.boat.knots - b.boat.knots),
    headingDelta: Math.abs(angleDelta(a.boat.heading, b.boat.heading)),
  }
}

export function centroidOf(points: Point[]): Point {
  if (!points.length) return { x: 0, y: 0 }
  const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 })
  return { x: sum.x / points.length, y: sum.y / points.length }
}

export function clampNumber(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value))
}

export function round(value: number, digits = 2): number {
  const f = 10 ** digits
  return Math.round((value + Number.EPSILON) * f) / f
}
