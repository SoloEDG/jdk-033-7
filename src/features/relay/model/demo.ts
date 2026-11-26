import type { Boat, Sample, Voyage, Wind } from '../../../shared/race'
import { normalize } from '../../../shared/math'

interface Keyframe {
  t: number
  x: number
  y: number
  heading: number
  knots: number
  sheet?: number
  rudder?: number
}

const steadyWind: Wind = { bearing: 18, knots: 12 }

function sampleKeyframes(id: string, keyframes: Keyframe[], duration: number, dt = 0.1): Voyage {
  const samples: Sample[] = []
  const sorted = [...keyframes].sort((a, b) => a.t - b.t)
  for (let time = 0; time <= duration + 1e-9; time = Math.round((time + dt) * 1000) / 1000) {
    let i = sorted.findIndex(k => k.t >= time)
    if (i < 0) i = sorted.length - 1
    if (i === 0 && time <= sorted[0].t) i = 0
    const left = sorted[Math.max(0, i - (i === 0 ? 0 : 1))]
    const right = sorted[Math.min(sorted.length - 1, i)]
    const span = right.t - left.t
    const p = span > 0 ? Math.min(1, Math.max(0, (time - left.t) / span)) : 0
    const boat: Boat = {
      position: {
        x: left.x + (right.x - left.x) * p,
        y: left.y + (right.y - left.y) * p,
      },
      heading: normalize(left.heading + ((((right.heading - left.heading + 540) % 360) - 180) * p)),
      knots: left.knots + (right.knots - left.knots) * p,
      sheet: right.sheet ?? 42,
      rudder: right.rudder ?? 0,
    }
    samples.push({
      time: Math.min(time, duration),
      boat,
      wind: steadyWind,
      nextGate: 0,
      penalty: 0,
    })
  }
  return {
    id,
    date: '2026-11-26T00:00:00.000Z',
    courseId: 'needle-bay',
    windMode: 'steady',
    status: 'finished',
    duration,
    penalty: 0,
    samples,
    events: [],
  }
}

/**
 * Deterministic rehearsal fixture described by the relay brief:
 * E1 is an early turning near-miss without enough parallel water;
 * E2 has one narrow fractional-second offset window.
 */
export function makeDemoVoyages(): [Voyage, Voyage] {
  const a = sampleKeyframes('demo-relay-a', [
    { t: 0, x: 132, y: 468, heading: -32, knots: 0, sheet: 39 },
    { t: 2, x: 151, y: 455, heading: -32, knots: 6.2 },
    { t: 10, x: 260, y: 392, heading: -30, knots: 7.1 },
    { t: 22, x: 420, y: 300, heading: -28, knots: 7.2 },
    { t: 25, x: 470, y: 286, heading: -14, knots: 7.0, rudder: 0.7 },
    { t: 32, x: 590, y: 300, heading: 10, knots: 7.3 },
    { t: 42, x: 690, y: 337, heading: 24, knots: 7.1 },
    { t: 46, x: 720, y: 360, heading: 37, knots: 7.0 },
    { t: 58, x: 835, y: 446, heading: 37, knots: 7.1 },
    { t: 66, x: 892, y: 486, heading: 41, knots: 6.8 },
  ], 66)

  const b = sampleKeyframes('demo-relay-b', [
    { t: 0, x: 184, y: 452, heading: -24, knots: 0, sheet: 44 },
    { t: 6, x: 232, y: 425, heading: -30, knots: 6.8 },
    // Six seconds of aligned motion; this whole early leg is outside R1.
    { t: 10, x: 268, y: 406, heading: -30, knots: 7.0 },
    { t: 16.5, x: 355, y: 356, heading: -30, knots: 7.2 },
    { t: 20, x: 386, y: 397, heading: 53, knots: 6.4, rudder: 0.8 },
    { t: 27, x: 472, y: 430, heading: 24, knots: 6.5 },
    { t: 34, x: 560, y: 396, heading: -18, knots: 6.8, rudder: -0.5 },
    { t: 39, x: 632, y: 360, heading: 18, knots: 6.9 },
    { t: 42, x: 684, y: 344, heading: 28, knots: 6.9 },
    // Translated parallel leg. B record time = A time - 1.5 s.
    { t: 44.5, x: 706, y: 379, heading: 37, knots: 7.0, sheet: 46 },
    { t: 56.5, x: 821, y: 465, heading: 37, knots: 7.1, sheet: 46 },
    { t: 62, x: 861, y: 493, heading: 42, knots: 6.7 },
  ], 62)

  return [a, b]
}
