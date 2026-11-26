<script setup lang="ts">
import { computed } from 'vue'
import { Anchor, FlaskConical, Handshake, TimerReset } from 'lucide-vue-next'
import type { Voyage } from '../../../shared/race'
import { clock } from '../../../shared/format'
import OffsetPlot from './OffsetPlot.vue'
import { chartUnitsToMetres, DEFAULT_RELAY_ZONE, metresToChartUnits, OFFSET_LIMITS } from '../model/criteria'
import type { RelayController } from '../model/useRelay'

const props = defineProps<{
  voyages: Voyage[]
  controller: RelayController
  locked: boolean
  recordedRelay?: Voyage['relay'] | null
}>()
const emit = defineEmits<{ loadDemo: [] }>()

const {
  trackAId, trackBId, offset, criteria, analysis, currentRange, confirmedOffset,
  live, settlement, setOffset,
} = props.controller

const distanceMetres = computed({
  get: () => Math.round(chartUnitsToMetres(criteria.maxDistance) * 10) / 10,
  set: value => { criteria.maxDistance = metresToChartUnits(Math.max(1, value)) },
})
const zoneEnabled = computed({
  get: () => criteria.zone.length >= 3,
  set: enabled => { criteria.zone = enabled ? DEFAULT_RELAY_ZONE : [] },
})

const resultTime = computed(() =>
  settlement.value?.time ?? live.value.handoffTime ?? props.recordedRelay?.actualHandoffTime ?? null)
const offsetState = computed(() => {
  if (confirmedOffset.value) return { kind: 'safe', text: `+${offset.value.toFixed(3)}s 位于可确认区间 ${confirmedOffset.value.id}` }
  if (currentRange.value) return { kind: 'edge', text: `+${offset.value.toFixed(3)}s 只落在临界估计区间，需避开端点并在实赛重认` }
  return { kind: 'none', text: `+${offset.value.toFixed(3)}s 不在预演可行偏移区间` }
})
</script>

<template>
  <section class="relay-panel" aria-label="接力布置" data-testid="relay-panel">
    <div class="relay-heading">
      <h2><Handshake :size="17"/> 接力布置</h2>
      <button type="button" class="demo-button" :disabled="locked" @click="emit('loadDemo')">
        <FlaskConical :size="14"/> 载入示例航迹
      </button>
    </div>

    <div class="relay-selects">
      <label>
        <span>第一份记录 · 当前艇</span>
        <select v-model="trackAId" data-testid="relay-track-a" :disabled="locked">
          <option value="">选择航次</option>
          <option v-for="voyage in voyages" :key="voyage.id" :value="voyage.id">
            {{ clock(voyage.duration + voyage.penalty) }} · {{ voyage.status === 'finished' ? '完赛' : '未完赛' }}
          </option>
        </select>
      </label>
      <label>
        <span>第二份记录 · 接棒艇</span>
        <select v-model="trackBId" data-testid="relay-track-b" :disabled="locked">
          <option value="">选择航次</option>
          <option v-for="voyage in voyages" :key="voyage.id" :value="voyage.id">
            {{ clock(voyage.duration + voyage.penalty) }} · {{ voyage.status === 'finished' ? '完赛' : '未完赛' }}
          </option>
        </select>
      </label>
    </div>

    <div class="offset-control">
      <div class="slider-label">
        <label for="relay-offset-range"><TimerReset :size="13"/> 出发偏移（连续，秒）</label>
        <input
          id="relay-offset-number"
          type="number"
          step="any"
          :value="offset"
          :disabled="locked || !analysis.hasTwoTracks"
          aria-label="精确出发偏移（秒）"
          @input="setOffset(Number(($event.target as HTMLInputElement).value))"
        >
      </div>
      <input
        id="relay-offset-range"
        data-testid="relay-offset"
        type="range"
        :min="OFFSET_LIMITS.min"
        :max="OFFSET_LIMITS.max"
        step="any"
        :value="offset"
        :disabled="locked || !analysis.hasTwoTracks"
        @input="setOffset(Number(($event.target as HTMLInputElement).value))"
      >
      <div class="offset-state" :data-kind="offsetState.kind" data-testid="relay-offset-state">{{ offsetState.text }}</div>
    </div>

    <details class="criteria-details" :open="true">
      <summary>交棒容差与指定水域</summary>
      <div class="criteria-grid">
        <label>距离 ≤ m
          <input type="number" min="3" max="120" step="0.5" v-model.number="distanceMetres" :disabled="locked">
        </label>
        <label>速差 ≤ kn
          <input type="number" min="0.1" max="10" step="0.1" v-model.number="criteria.maxSpeedDelta" :disabled="locked">
        </label>
        <label>航向差 ≤ °
          <input type="number" min="1" max="90" step="1" v-model.number="criteria.maxHeadingDelta" :disabled="locked">
        </label>
        <label>持续 ≥ s
          <input type="number" min="0.5" max="60" step="0.5" v-model.number="criteria.minDuration" :disabled="locked">
        </label>
        <label class="zone-toggle"><input type="checkbox" v-model="zoneEnabled" :disabled="locked"> R1 指定水域</label>
      </div>
    </details>

    <OffsetPlot :analysis="analysis" :offset="offset" :locked="locked" @update-offset="setOffset"/>

    <div class="critical-table" data-testid="relay-critical-table">
      <span
        v-for="boundary in analysis.ranges.flatMap(range => [range.lower, range.upper])"
        :key="`${boundary.side}-${boundary.value}`"
        class="critical-chip"
        :data-certainty="boundary.certainty"
        data-testid="relay-critical-value"
      >
        临界未定 · {{ boundary.side === 'lower' ? '下限' : '上限' }} {{ boundary.value.toFixed(3) }}s
        <em>{{ boundary.certainty === 'undetermined' ? '样本不能定边' : '实赛重认' }}</em>
      </span>
    </div>

    <div class="encounter-list">
      <article
        v-for="(encounter, index) in analysis.encounters"
        :key="encounter.id"
        class="encounter-card"
        :data-verdict="encounter.verdict"
        data-testid="relay-encounter"
      >
        <header>
          <b>近遇 {{ index + 1 }}</b>
          <span>{{ ({ feasible: '存在可用偏移', 'too-short': '并行时长不足', 'outside-water': '并行水域不足', metrics: '运动指标不合', unsampled: '样本不足' } as const)[encounter.verdict] }}</span>
        </header>
        <p>{{ encounter.reason }}</p>
        <div
          v-for="range in analysis.ranges.filter(r => r.encounterId === encounter.id)"
          :key="range.id"
          class="range-summary"
          data-testid="relay-range-summary"
          :data-range-id="range.id"
          :data-lower="range.lower.value"
          :data-upper="range.upper.value"
          :data-safe-lower="range.safeLower"
          :data-safe-upper="range.safeUpper"
        >
          <strong data-testid="offset-range">可确认 {{ range.safeLower.toFixed(3) }}s … {{ range.safeUpper.toFixed(3) }}s</strong>
          <span data-testid="critical-values">临界 {{ range.lower.value.toFixed(3) }}s / {{ range.upper.value.toFixed(3) }}s；实赛以实际船态重认</span>
        </div>
      </article>
      <p v-if="!analysis.encounters.length" class="empty-note">至少选择两份包含样本的已保存航次；也可载入内置示例查看“两次近遇”的预演图。</p>
    </div>

    <div class="relay-live" :data-handed-off="live.handedOff" :data-handoff="live.handedOff ? 'success' : 'waiting'" data-testid="relay-live">
      <div class="live-row">
        <Anchor :size="15"/>
        <strong data-testid="relay-status">{{ locked ? live.message : '开赛前可连续调整一次偏移；出发后选择被锁定' }}</strong>
      </div>
      <div v-if="locked && live.condition" class="live-metrics">
        <span :data-ok="live.condition.distanceOk">距离 {{ (live.condition.distance * 100 / 96).toFixed(1) }}m</span>
        <span :data-ok="live.condition.speedOk">速差 {{ live.condition.speedDelta.toFixed(2) }}kn</span>
        <span :data-ok="live.condition.headingOk">航向差 {{ live.condition.headingDelta.toFixed(1) }}°</span>
        <span :data-ok="live.condition.inZone">水域 {{ live.condition.inZone ? '内' : '外' }}</span>
        <div class="hold-track"><i :style="{ width: `${Math.min(100, live.heldDuration / criteria.minDuration * 100)}%` }"/></div>
      </div>
      <div class="handoff-result" data-testid="handoff">
        <span>实际交棒时刻 / 接力成绩</span>
        <output data-testid="relay-result"><span data-testid="handoff-time">{{ resultTime === null ? '--:--.-' : clock(resultTime) }}</span></output>
      </div>
    </div>
  </section>
</template>

<style scoped>
.relay-panel { background: var(--paper); border: 1px solid var(--rule); padding: 13px 15px; margin-top: 14px; }
.relay-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.relay-heading h2 { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 17px; }
.demo-button { display: inline-flex; align-items: center; gap: 5px; border: 1px solid #9d967d; background: #fff8df; border-radius: 3px; padding: 6px 9px; font-size: 12px; }
.relay-selects { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 11px; }
.relay-selects label, .criteria-grid label { display: grid; gap: 4px; font-size: 11px; color: #5d604f; }
.relay-selects select, .criteria-grid input { width: 100%; min-height: 34px; border: 1px solid #b5b09c; background: #fffae8; padding: 5px; font-size: 12px; }
.offset-control { margin-top: 11px; }
.slider-label { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 12px; }
.slider-label label { display: inline-flex; align-items: center; gap: 5px; font-weight: 700; }
.slider-label input[type=number] { width: 96px; min-height: 31px; border: 1px solid #b5b09c; background: #fffae8; padding: 4px 6px; font: 12px var(--mono); }
.offset-control input[type=range] { margin: 7px 0 4px; }
.offset-state { font-size: 12px; padding: 6px 8px; border-radius: 3px; background: #e7e0c7; color: #5c5745; }
.offset-state[data-kind=safe] { background: #d8eddc; color: #22633e; }
.offset-state[data-kind=edge] { background: #f7e4b5; color: #7a4c08; }
.offset-state[data-kind=none] { background: #f0d4cb; color: #843528; }
.critical-table { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 8px; }
.critical-chip { display: inline-flex; align-items: baseline; gap: 6px; padding: 5px 8px; border: 1px dashed #a9791f; background: #fff0bd; color: #65430b; font: 11px var(--mono); }
.critical-chip em { font-style: normal; font-family: system-ui, sans-serif; font-size: 10px; color: #8a651e; }
.critical-chip[data-certainty=undetermined] { border-style: solid; border-color: #9b3a2b; background: #f6d4cb; color: #7d2c20; }
.criteria-details { margin-top: 9px; font-size: 12px; }
.criteria-details summary { cursor: pointer; font-weight: 700; }
.criteria-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 8px; }
.criteria-grid .zone-toggle { grid-column: span 2; display: flex; align-items: center; grid-auto-flow: column; justify-content: start; gap: 6px; }
.zone-toggle input { width: auto !important; min-height: 0 !important; }
.encounter-list { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; margin-top: 10px; }
.encounter-card { border: 1px solid #d2caae; background: #fff8df; padding: 9px 10px; border-left-width: 4px; }
.encounter-card[data-verdict=feasible] { border-left-color: #2f8a57; }
.encounter-card[data-verdict=outside-water], .encounter-card[data-verdict=too-short] { border-left-color: #c58a22; }
.encounter-card[data-verdict=metrics], .encounter-card[data-verdict=unsampled] { border-left-color: #a84a38; }
.encounter-card header { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; }
.encounter-card header span { color: #66705d; }
.encounter-card p { margin: 6px 0; font-size: 12px; line-height: 1.45; }
.range-summary { display: grid; gap: 2px; padding-top: 6px; border-top: 1px dashed #c9c1a7; }
.range-summary strong { font: 12px var(--mono); color: #22633e; }
.range-summary span { font-size: 11px; color: #756a4e; }
.relay-live { margin-top: 11px; border-top: 1px solid #d2caae; padding-top: 9px; }
.live-row { display: flex; align-items: center; gap: 7px; font-size: 12px; }
.live-metrics { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; font: 11px var(--mono); }
.live-metrics span { padding: 3px 6px; background: #eadfc4; color: #8a3a2c; }
.live-metrics span[data-ok=true] { background: #d8eddc; color: #22633e; }
.hold-track { flex-basis: 100%; height: 7px; background: #d7cfb4; border-radius: 4px; overflow: hidden; }
.hold-track i { display: block; height: 100%; background: #2f8a57; transition: width .08s linear; }
.handoff-result { display: flex; align-items: center; justify-content: space-between; margin-top: 9px; font-size: 12px; }
.handoff-result output { font: 700 20px var(--mono); color: #8a430d; }
.relay-live[data-handed-off=true] .handoff-result output { color: #22633e; }
@media (max-width: 700px) {
  .relay-selects, .encounter-list { grid-template-columns: 1fr; }
  .criteria-grid { grid-template-columns: 1fr 1fr; }
}
</style>
