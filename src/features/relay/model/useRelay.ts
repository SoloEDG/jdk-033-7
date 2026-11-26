import { computed, reactive, ref, shallowRef, watch, type Ref } from 'vue'
import type { Boat, Voyage } from '../../../shared/race'
import { analyzeRelayTracks, type RelayAnalysisResult } from '../lib/analyze'
import { conditionFromBoats } from '../lib/condition'
import { trackSampleAt } from '../lib/track'
import { DEFAULT_RELAY_CRITERIA } from './criteria'
import type { LiveRelayState } from './types'

const idleLive: LiveRelayState = {
  active: false,
  handedOff: false,
  boatB: null,
  condition: null,
  compliantSince: null,
  heldDuration: 0,
  handoffTime: null,
  offset: 0,
  message: '请选择两份航迹并完成预演',
}

export interface HandoffResult {
  time: number
  offset: number
  boat: Boat
  sheet: number
  knots: number
  heading: number
  condition: NonNullable<LiveRelayState['condition']>
}

export function useRelay(voyages: Ref<Voyage[]>) {
  const trackAId = ref('')
  const trackBId = ref('')
  const offset = ref(0)
  const criteria = reactive(structuredClone(DEFAULT_RELAY_CRITERIA))
  const live = shallowRef<LiveRelayState>({ ...idleLive })
  const settlement = shallowRef<{ time: number; offset: number; knots: number; sheet: number } | null>(null)

  const selectedA = computed(() => voyages.value.find(v => v.id === trackAId.value) ?? null)
  const selectedB = computed(() => voyages.value.find(v => v.id === trackBId.value) ?? null)

  function chooseDefaults() {
    const list = voyages.value
    if (!list.some(v => v.id === trackAId.value)) trackAId.value = list[0]?.id ?? ''
    if (!list.some(v => v.id === trackBId.value) || trackBId.value === trackAId.value) {
      trackBId.value = list.find(v => v.id !== trackAId.value)?.id ?? list[1]?.id ?? ''
    }
  }
  chooseDefaults()
  watch(voyages, chooseDefaults, { deep: false })
  watch(trackAId, () => {
    if (trackAId.value === trackBId.value) {
      trackBId.value = voyages.value.find(v => v.id !== trackAId.value)?.id ?? ''
    }
  })

  const analysis = computed<RelayAnalysisResult>(() =>
    analyzeRelayTracks(selectedA.value?.samples, selectedB.value?.samples, criteria),
  )

  const currentRange = computed(() =>
    analysis.value.ranges.find(range =>
      offset.value >= range.lower.value && offset.value <= range.upper.value) ?? null)
  const confirmedOffset = computed(() =>
    analysis.value.ranges.find(range =>
      offset.value >= range.safeLower && offset.value <= range.safeUpper) ?? null)

  function setOffset(value: number) {
    if (!Number.isFinite(value)) return
    offset.value = Math.max(-600, Math.min(600, value))
  }

  function resetForRace() {
    settlement.value = null
    live.value = {
      ...idleLive,
      active: true,
      offset: offset.value,
      message: '接棒艇按第二份记录航行，等待两艇同时满足交棒条件',
    }
  }

  function disarm() {
    live.value = { ...idleLive, offset: offset.value }
    settlement.value = null
  }

  /**
   * Reconfirm using the actual player boat and the actual interpolated state
   * of the record-following relay boat. Rehearsal ranges never call this.
   */
  function tick(elapsed: number, actualBoatA: Boat, dt: number): HandoffResult | null {
    if (!live.value.active || live.value.handedOff || !selectedB.value) return null
    const recordTimeB = elapsed - offset.value
    const durationB = selectedB.value.duration
    const boatBSample = trackSampleAt(selectedB.value.samples, recordTimeB)
    if (!boatBSample) return null

    const recordActive = recordTimeB >= -1e-6 && recordTimeB <= durationB + 1e-6
    const condition = conditionFromBoats(
      actualBoatA, boatBSample, elapsed, recordTimeB, criteria,
      selectedA.value ? trackSampleAt(selectedA.value.samples, elapsed) ?? undefined : undefined,
    )

    if (!recordActive) {
      live.value = {
        ...live.value,
        boatB: boatBSample,
        condition,
        compliantSince: null,
        heldDuration: 0,
        message: recordTimeB < 0 ? '接棒艇尚未到出发偏移时刻' : '第二份记录已经结束，不能交棒',
      }
      return null
    }

    if (!condition.compliant) {
      live.value = {
        ...live.value,
        boatB: boatBSample,
        condition,
        compliantSince: null,
        heldDuration: 0,
        message: condition.reasons[0] ?? '交棒条件未同时成立',
      }
      return null
    }

    const since = live.value.compliantSince ?? Math.max(0, elapsed - dt)
    const held = elapsed - since
    const next: LiveRelayState = {
      ...live.value,
      boatB: boatBSample,
      condition,
      compliantSince: since,
      heldDuration: Math.min(criteria.minDuration, held),
      message: `条件合规，保持 ${held.toFixed(2)} / ${criteria.minDuration.toFixed(0)} s`,
    }

    if (held + 1e-8 >= criteria.minDuration) {
      next.handedOff = true
      next.handoffTime = elapsed
      next.heldDuration = criteria.minDuration
      next.message = '交棒成功：已从接棒艇的实际速度与帆态继续'
      live.value = next
      settlement.value = {
        time: elapsed, offset: offset.value,
        knots: boatBSample.boat.knots, sheet: boatBSample.boat.sheet,
      }
      return {
        time: elapsed,
        offset: offset.value,
        // The recorded rudder is a playback command, not sail state. Center it
        // so the player receives a controllable boat at the same heading.
        boat: { ...boatBSample.boat, rudder: 0 },
        sheet: boatBSample.boat.sheet,
        knots: boatBSample.boat.knots,
        heading: boatBSample.boat.heading,
        condition,
      }
    }

    live.value = next
    return null
  }

  return {
    trackAId, trackBId, offset, criteria,
    selectedA, selectedB, analysis, currentRange, confirmedOffset,
    live, settlement, setOffset, chooseDefaults,
    resetForRace, disarm, tick,
  }
}

export type RelayController = ReturnType<typeof useRelay>
