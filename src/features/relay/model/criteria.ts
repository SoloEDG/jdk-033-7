import type { RelayCriteria } from '../model/types'

/** Chart scale bar: 96 SVG units represent 100 m. */
export const METRES_PER_CHART_UNIT = 100 / 96

export const metresToChartUnits = (metres: number) => metres / METRES_PER_CHART_UNIT
export const chartUnitsToMetres = (units: number) => units * METRES_PER_CHART_UNIT

/**
 * Designated relay water between the reef gate and the finish.
 * The polygon is deliberately drawn in the same coordinate system as Course.
 */
export const DEFAULT_RELAY_ZONE = [
  { x: 724, y: 276 },
  { x: 899, y: 407 },
  { x: 827, y: 505 },
  { x: 650, y: 374 },
]

export const DEFAULT_RELAY_CRITERIA: RelayCriteria = {
  maxDistance: metresToChartUnits(25),
  maxSpeedDelta: 1.6,
  maxHeadingDelta: 18,
  minDuration: 5,
  zone: DEFAULT_RELAY_ZONE,
  timeStep: 0.05,
  offsetStep: 0.05,
}

export const OFFSET_LIMITS = { min: -600, max: 600, step: 0.01 }
