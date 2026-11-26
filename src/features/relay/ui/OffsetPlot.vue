<script setup lang="ts">
import { computed } from 'vue'
import type { RelayAnalysisResult } from '../lib/analyze'

const props = defineProps<{
  analysis: RelayAnalysisResult
  offset: number
  locked?: boolean
}>()
const emit = defineEmits<{ updateOffset: [value: number] }>()

const width = 720
const margin = { left: 48, right: 22, top: 38, bottom: 34 }
const rowHeight = 82

const height = computed(() => margin.top + Math.max(1, props.analysis.encounters.length) * rowHeight + margin.bottom)

const domain = computed<[number, number]>(() => {
  const values = [props.offset, 0]
  for (const encounter of props.analysis.encounters) {
    if (encounter.bestOffset !== null) values.push(encounter.bestOffset)
  }
  for (const range of props.analysis.ranges) {
    values.push(range.lower.value, range.upper.value, range.safeLower, range.safeUpper)
    values.push(...range.lower.bracket, ...range.upper.bracket)
  }
  let lo = Math.min(...values) - 0.7
  let hi = Math.max(...values) + 0.7
  lo = Math.floor(lo)
  hi = Math.ceil(hi)
  if (hi - lo < 4) {
    const center = (lo + hi) / 2
    lo = Math.floor(center - 2)
    hi = Math.ceil(center + 2)
  }
  return [lo, hi]
})

const x = (value: number) => {
  const [lo, hi] = domain.value
  return margin.left + (value - lo) / (hi - lo) * (width - margin.left - margin.right)
}
const yRow = (index: number) => margin.top + index * rowHeight + 28
const ticks = computed(() => {
  const [lo, hi] = domain.value
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)
})

function offsetFromEvent(event: PointerEvent): number {
  const svg = event.currentTarget as SVGSVGElement
  const rect = svg.getBoundingClientRect()
  const px = (event.clientX - rect.left) / rect.width * width
  const ratio = (px - margin.left) / (width - margin.left - margin.right)
  const [lo, hi] = domain.value
  return Math.round((lo + ratio * (hi - lo)) * 1000) / 1000
}
function pointerDown(event: PointerEvent) {
  if (props.locked) return
  ;(event.currentTarget as Element).setPointerCapture?.(event.pointerId)
  emit('updateOffset', offsetFromEvent(event))
}
function pointerMove(event: PointerEvent) {
  if (props.locked || event.buttons !== 1) return
  emit('updateOffset', offsetFromEvent(event))
}

const formatOffset = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(2)}`
const verdictText: Record<string, string> = {
  feasible: '可用',
  'too-short': '并行不足',
  'outside-water': '水域不足',
  metrics: '指标越界',
  unsampled: '无重叠',
}
</script>

<template>
  <div class="offset-plot" data-testid="relay-offset-plot">
    <svg
      :viewBox="`0 0 ${width} ${height}`"
      role="img"
      aria-label="各近遇的出发偏移区间与临界值"
      @pointerdown="pointerDown"
      @pointermove="pointerMove"
    >
      <rect :x="margin.left" :y="10" :width="width - margin.left - margin.right" :height="height - 42" rx="6" class="plot-bg"/>
      <g v-for="tick in ticks" :key="tick">
        <line :x1="x(tick)" :x2="x(tick)" :y1="18" :y2="height - margin.bottom + 8" :class="['tick', { integer: true }]"/>
        <text :x="x(tick)" :y="height - 12" text-anchor="middle" class="tick-label">{{ tick }}s</text>
      </g>

      <g v-for="(encounter, index) in analysis.encounters" :key="encounter.id" :data-encounter="encounter.id">
        <text :x="10" :y="yRow(index) - 18" class="row-title">近遇 {{ index + 1 }}</text>
        <text :x="10" :y="yRow(index) - 3" :class="['row-verdict', encounter.verdict]" data-testid="relay-encounter-verdict">
          {{ verdictText[encounter.verdict] }}
        </text>
        <line :x1="margin.left" :x2="width - margin.right" :y1="yRow(index)" :y2="yRow(index)" class="row-line"/>

        <g
          v-for="range in analysis.ranges.filter(r => r.encounterId === encounter.id)"
          :key="range.id"
          data-testid="relay-range"
          :data-lower="range.lower.value"
          :data-upper="range.upper.value"
          :data-safe-lower="range.safeLower"
          :data-safe-upper="range.safeUpper"
        >
          <line
            :x1="x(range.lower.bracket[0])" :x2="x(range.upper.bracket[1])"
            :y1="yRow(index)" :y2="yRow(index)" class="uncertain-band"/>
          <line
            :x1="x(range.lower.bracket[0])" :x2="x(range.lower.bracket[1])"
            :y1="yRow(index) - 9" :y2="yRow(index) - 9" class="bracket-cap"/>
          <line
            :x1="x(range.upper.bracket[0])" :x2="x(range.upper.bracket[1])"
            :y1="yRow(index) - 9" :y2="yRow(index) - 9" class="bracket-cap"/>
          <line
            :x1="x(range.safeLower)" :x2="x(range.safeUpper)"
            :y1="yRow(index)" :y2="yRow(index)" class="safe-band"/>
          <path
            :d="`M ${x(range.lower.value)} ${yRow(index) - 7} L ${x(range.lower.value) + 6} ${yRow(index)} L ${x(range.lower.value)} ${yRow(index) + 7} L ${x(range.lower.value) - 6} ${yRow(index)} Z`"
            :class="['boundary-diamond', range.lower.certainty]" data-testid="relay-boundary" :data-certainty="range.lower.certainty">
            <title>{{ range.lower.reason }}</title>
          </path>
          <path
            :d="`M ${x(range.upper.value)} ${yRow(index) - 7} L ${x(range.upper.value) + 6} ${yRow(index)} L ${x(range.upper.value)} ${yRow(index) + 7} L ${x(range.upper.value) - 6} ${yRow(index)} Z`"
            :class="['boundary-diamond', range.upper.certainty]" data-testid="relay-boundary" :data-certainty="range.upper.certainty">
            <title>{{ range.upper.reason }}</title>
          </path>
          <text :x="x(range.lower.value)" :y="yRow(index) + 24" text-anchor="middle" class="boundary-label lower">
            {{ range.lower.certainty === 'undetermined' ? '?' : '◇' }}{{ formatOffset(range.lower.value) }}
          </text>
          <text :x="x(range.upper.value)" :y="yRow(index) + 24" text-anchor="middle" class="boundary-label upper">
            {{ formatOffset(range.upper.value) }}{{ range.upper.certainty === 'undetermined' ? '?' : '◇' }}
          </text>
        </g>

        <g v-if="!analysis.ranges.some(r => r.encounterId === encounter.id) && encounter.bestOffset !== null">
          <circle :cx="x(encounter.bestOffset)" :cy="yRow(index)" r="6" class="failed-dot"/>
          <text :x="x(encounter.bestOffset) + 10" :y="yRow(index) + 5" class="failed-label">
            最近搜索偏移 {{ formatOffset(encounter.bestOffset) }}s · {{ encounter.bestDuration.toFixed(1) }}s
          </text>
        </g>
      </g>

      <g v-if="!analysis.encounters.length">
        <text :x="width / 2" :y="height / 2" text-anchor="middle" class="empty-plot">两份航迹在当前容差下没有识别出近遇</text>
      </g>

      <line :x1="x(offset)" :x2="x(offset)" :y1="14" :y2="height - 26" class="current-line"/>
      <path :d="`M ${x(offset) - 6} 16 L ${x(offset) + 6} 16 L ${x(offset)} 25 Z`" class="current-flag"/>
      <text :x="x(offset)" y="13" text-anchor="middle" class="current-label">{{ formatOffset(offset) }}s</text>
    </svg>
    <div class="plot-legend">
      <span><i class="legend-safe"/>可确认范围</span>
      <span><i class="legend-critical"/>临界估计（实赛重认）</span>
      <span><i class="legend-unknown"/>未定括号</span>
      <span><i class="legend-current"/>当前偏移</span>
    </div>
  </div>
</template>

<style scoped>
.offset-plot { border: 1px solid #c9c1a7; background: #fbf6e5; padding: 6px 8px 8px; margin-top: 9px; }
svg { width: 100%; height: auto; display: block; touch-action: none; cursor: ew-resize; }
.plot-bg { fill: #f1ead2; }
.tick { stroke: #d4ccb0; stroke-width: 1; }
.tick.integer { stroke: #bdb494; }
.tick-label { font: 10px var(--mono); fill: #74705e; }
.row-line { stroke: #c9c1a7; stroke-width: 1.5; }
.row-title { font: 700 13px var(--display); fill: #263f40; }
.row-verdict { font-size: 10px; font-weight: 700; }
.row-verdict.feasible { fill: #2f704f; }
.row-verdict.too-short, .row-verdict.outside-water { fill: #9a6414; }
.row-verdict.metrics, .row-verdict.unsampled { fill: #9b3a2b; }
.safe-band { stroke: #2f8a57; stroke-width: 10; stroke-linecap: round; }
.uncertain-band { stroke: #c58a22; stroke-width: 2; stroke-dasharray: 5 4; }
.bracket-cap { stroke: #9a6414; stroke-width: 2; stroke-dasharray: 3 3; }
.boundary-diamond { stroke: #7a4c08; stroke-width: 1.5; fill: #fff2b8; }
.boundary-diamond.undetermined { fill: #f6c9bf; stroke: #9b2f20; }
.boundary-label { font: 10px var(--mono); fill: #62410d; }
.failed-dot { fill: #b6543d; stroke: #fff2df; stroke-width: 2; }
.failed-label { font: 11px var(--mono); fill: #7c3528; }
.current-line { stroke: #a75b16; stroke-width: 1.6; stroke-dasharray: 4 3; }
.current-flag { fill: #a75b16; }
.current-label { font: 700 11px var(--mono); fill: #8a430d; }
.empty-plot { font-size: 13px; fill: #6b6757; }
.plot-legend { display: flex; flex-wrap: wrap; gap: 10px; font-size: 11px; color: #5f604f; margin-top: 4px; }
.plot-legend span { display: inline-flex; align-items: center; gap: 4px; }
.plot-legend i { width: 16px; height: 5px; border-radius: 3px; display: inline-block; }
.legend-safe { background: #2f8a57; }
.legend-critical { width: 9px !important; height: 9px !important; transform: rotate(45deg); border: 1.5px solid #7a4c08; background: #fff2b8; }
.legend-unknown { background: repeating-linear-gradient(90deg,#c58a22 0 4px,transparent 4px 7px); height: 2px !important; }
.legend-current { background: #a75b16; height: 2px !important; }
</style>
