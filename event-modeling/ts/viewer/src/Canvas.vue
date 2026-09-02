<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue"
import Card from "./Card.vue"
import {
  ARROW_H,
  type Box,
  HEADER_H,
  type Layout,
  NAME_H,
  path,
  polyline,
  SPEC_CARD_TITLE,
  SPEC_LINE_H,
  SPEC_TITLE_LINE,
} from "./layout.ts"

const props = defineProps<{
  layout: Layout
  selectedColumn: number | null
  selectedBox: string | null
  hovered: string | null
  /** Bumping `seq` brings the column into view. */
  focus: { column: number | null; seq: number }
}>()
const emit = defineEmits<{
  selectCard: [box: Box]
  selectSlice: [column: number]
  link: [canonical: string]
  hover: [name: string | null]
  clear: []
}>()

const el = ref<HTMLDivElement | null>(null)
const view = ref({ x: 0, y: 0, k: 1 })
const animate = ref(false)
const dragging = ref(false)
const hoverColumn = ref<number | null>(null)
const byId = computed(() => new Map(props.layout.boxes.map((b) => [b.id, b])))

// Fit the whole model when it first arrives; a redraw keeps the user's view.
function fit() {
  const box = el.value?.getBoundingClientRect()
  if (!box) return
  const k = Math.min(
    1,
    (box.width - 40) / props.layout.width,
    (box.height - 40) / props.layout.height,
  )
  view.value = { x: 20, y: 20, k }
}
onMounted(() => {
  fit()
  if (props.focus.column !== null) focusColumn(props.focus.column)
})

function focusColumn(index: number) {
  const col = props.layout.columns[index]
  const box = el.value?.getBoundingClientRect()
  if (!col || !box) return
  const rect = { x: col.x - 16, y: 0, w: col.w + 32, h: props.layout.height }
  const k = Math.min(1.25, (box.width - 40) / rect.w, (box.height - 40) / rect.h)
  animate.value = true
  view.value = {
    x: box.width / 2 - k * (rect.x + rect.w / 2),
    y: Math.max(20, box.height / 2 - k * (rect.h / 2)),
    k,
  }
  setTimeout(() => {
    animate.value = false
  }, 350)
}
watch(
  () => props.focus.seq,
  () => {
    if (props.focus.column !== null) focusColumn(props.focus.column)
  },
)

let last: { x: number; y: number } | null = null
let moved = false
function down(e: PointerEvent) {
  if (e.button !== 0) return
  last = { x: e.clientX, y: e.clientY }
  moved = false
  dragging.value = true
}
function move(e: PointerEvent) {
  if (!last) return
  const dx = e.clientX - last.x
  const dy = e.clientY - last.y
  if (Math.abs(dx) + Math.abs(dy) > 2) moved = true
  view.value = { ...view.value, x: view.value.x + dx, y: view.value.y + dy }
  last = { x: e.clientX, y: e.clientY }
}
function up() {
  last = null
  dragging.value = false
}
function background() {
  if (!moved) emit("clear")
}
function wheel(e: WheelEvent) {
  e.preventDefault()
  if (e.ctrlKey || e.metaKey) {
    const box = el.value?.getBoundingClientRect()
    if (!box) return
    const px = e.clientX - box.left
    const py = e.clientY - box.top
    const k = Math.min(3, Math.max(0.2, view.value.k * (1 - e.deltaY * 0.01)))
    const ratio = k / view.value.k
    view.value = { x: px - (px - view.value.x) * ratio, y: py - (py - view.value.y) * ratio, k }
  } else {
    view.value = { ...view.value, x: view.value.x - e.deltaX, y: view.value.y - e.deltaY }
  }
}

// Hovering a name lights every card with that name and the edges into them,
// so a read model or an event shows everywhere it is used.
const lit = computed(() => {
  const name = props.hovered
  if (name === null) return null
  const ids = new Set(props.layout.boxes.filter((b) => b.name === name).map((b) => b.id))
  const edges = new Set<number>()
  props.layout.edges.forEach((e, i) => {
    if (ids.has(e.from) || ids.has(e.to)) edges.add(i)
  })
  const cards = new Set(ids)
  for (const i of edges) {
    const e = props.layout.edges[i]
    if (e) {
      cards.add(e.from)
      cards.add(e.to)
    }
  }
  return { named: ids, cards, edges }
})

function edgeClass(i: number) {
  if (!lit.value) return {}
  return { lit: lit.value.edges.has(i), dim: !lit.value.edges.has(i) }
}
function cardClass(b: Box) {
  const state = { selected: b.id === props.selectedBox, lit: false, dim: false }
  if (lit.value) {
    state.lit = lit.value.named.has(b.id)
    state.dim = !lit.value.cards.has(b.id)
  }
  return state
}
function edgePath(i: number) {
  const e = props.layout.edges[i]
  if (!e) return ""
  if (e.points) return polyline(e.points)
  const a = byId.value.get(e.from)
  const b = byId.value.get(e.to)
  return a && b ? path(a, b) : ""
}
function hoverCard(b: Box | null) {
  emit("hover", b?.name ?? null)
  hoverColumn.value = b?.column ?? null
}

// A chapter is an arrow along the time line; the first has a flat start.
function arrow(x: number, w: number, first: boolean) {
  const y = HEADER_H - ARROW_H - 12
  const h = ARROW_H
  const n = 12
  const start = first ? `M${x} ${y}` : `M${x} ${y} L${x + n} ${y + h / 2} L${x} ${y + h}`
  const body = first ? `L${x} ${y + h}` : ""
  return `${start} ${body} L${x + w - n - 4} ${y + h} L${x + w - 4} ${y + h / 2} L${x + w - n - 4} ${y} Z`
}
const transform = computed(
  () => `translate(${view.value.x}px, ${view.value.y}px) scale(${view.value.k})`,
)
</script>

<template>
  <div
    ref="el"
    class="canvas"
    :class="{ dragging }"
    @pointerdown="down"
    @pointermove="move"
    @pointerup="up"
    @pointerleave="up"
    @wheel="wheel"
  >
    <svg @click.self="background">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" />
        </marker>
        <marker id="arrow-lit" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#2563eb" />
        </marker>
      </defs>
      <g class="world" :class="{ animate }" :style="{ transform }">
        <rect class="page" :x="0" :y="0" :width="layout.width" :height="layout.height" @click="background" />
        <g v-for="row in layout.rows" :key="row.id">
          <rect class="lane" :class="row.kind" :x="0" :y="row.y" :width="layout.width" :height="row.h" @click="background" />
          <line class="lane-line" :x1="0" :x2="layout.width" :y1="row.y" :y2="row.y" />
          <text v-if="row.label" class="lane-label" :x="16" :y="row.y + 22">
            {{ row.label }}<tspan v-if="row.sub" class="lane-kind"> ({{ row.sub }})</tspan>
          </text>
        </g>
        <line class="lane-line" :x1="0" :x2="layout.width" :y1="layout.height" :y2="layout.height" />

        <g v-for="col in layout.columns" :key="col.index">
          <rect
            class="slice"
            :class="{ hover: hoverColumn === col.index, selected: selectedColumn === col.index }"
            :x="col.x + 4"
            :y="layout.nameY + NAME_H + 4"
            :width="col.w - 8"
            :height="layout.height - layout.nameY - NAME_H - 8"
            rx="10"
          />
          <g
            class="slice-head"
            :class="{ selected: selectedColumn === col.index }"
            @click.stop="emit('selectSlice', col.index)"
            @pointerenter="hoverColumn = col.index"
            @pointerleave="hoverColumn = null"
          >
            <rect :x="col.x + 4" :y="layout.nameY" :width="col.w - 8" :height="NAME_H" rx="10" />
            <text text-anchor="middle" :x="col.x + col.w / 2" :y="layout.nameY + NAME_H / 2 + 4.5">
              {{ col.label }}
            </text>
            <circle v-if="col.noted" class="note-dot" :cx="col.x + col.w - 16" :cy="layout.nameY + NAME_H / 2" r="3.5" />
          </g>
        </g>

        <g v-for="(chapter, i) in layout.chapters" :key="chapter.name + chapter.x" class="chapter">
          <path :d="arrow(chapter.x, chapter.w, i === 0)" />
          <text :x="chapter.x + (i === 0 ? 16 : 24)" :y="HEADER_H - 12 - ARROW_H / 2 + 5">{{ chapter.name }}</text>
        </g>

        <path
          v-for="(edge, i) in layout.edges"
          :key="i"
          class="edge"
          :class="{ dashed: edge.dashed, ...edgeClass(i) }"
          :d="edgePath(i)"
          :marker-end="lit?.edges.has(i) ? 'url(#arrow-lit)' : 'url(#arrow)'"
        />
        <Card
          v-for="box in layout.boxes"
          :key="box.id"
          :box="box"
          :class="cardClass(box)"
          @click.stop="emit('selectCard', box)"
          @link="emit('link', $event)"
          @pointerenter="hoverCard(box)"
          @pointerleave="hoverCard(null)"
        />

        <g v-for="spec in layout.specs" :key="spec.column + spec.title.join()" class="spec-block">
          <text
            v-for="(line, i) in spec.title"
            :key="i"
            class="spec-title"
            :x="spec.x"
            :y="spec.y + 11 + i * SPEC_TITLE_LINE"
          >
            {{ line }}
          </text>
          <g v-for="step in spec.steps" :key="step.word">
            <text class="spec-word" :x="spec.x" :y="step.y + 10">{{ step.word }}</text>
            <g
              v-for="(card, ci) in step.cards"
              :key="ci"
              class="card spec"
              :class="[card.kind, { lit: hovered === card.name, dim: lit !== null && hovered !== card.name }]"
              :transform="`translate(${card.x} ${card.y})`"
              @pointerenter="emit('hover', card.name)"
              @pointerleave="emit('hover', null)"
            >
              <rect class="shape" :width="card.w" :height="card.h" rx="6" />
              <text class="title" :x="10" :y="16">{{ card.name }}</text>
              <text
                v-for="(line, li) in card.lines"
                :key="li"
                class="field"
                :x="10"
                :y="SPEC_CARD_TITLE + li * SPEC_LINE_H"
              >
                {{ line }}
              </text>
            </g>
          </g>
        </g>
      </g>
    </svg>
  </div>
</template>
