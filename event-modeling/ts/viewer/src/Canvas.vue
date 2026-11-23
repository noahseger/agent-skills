<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue"
import Card from "./Card.vue"
import {
  ARROW_H,
  type Box,
  HEADER_H,
  type Layout,
  NAME_H,
  NOTE_W,
  outside,
  path,
  polyline,
} from "./layout.ts"
import Mark from "./Mark.vue"
import Sticky from "./Sticky.vue"

const props = defineProps<{
  layout: Layout
  selectedColumn: number | null
  selectedBox: string | null
  hovered: string | null
  /** Bumping `seq` brings the column into view, or with none the whole model. */
  focus: { column: number | null; seq: number }
}>()
const emit = defineEmits<{
  selectCard: [box: Box]
  selectSlice: [column: number]
  openSlice: [column: number]
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

// Fit the whole model when it first arrives and when Present starts; a redraw keeps the user's view.
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
// After the DOM updates, so a canvas that just grew is measured at its new size.
watch(
  () => props.focus.seq,
  () => {
    if (props.focus.column !== null) focusColumn(props.focus.column)
    else fit()
  },
  { flush: "post" },
)

let last: { x: number; y: number } | null = null
let moved = false
function down(e: PointerEvent) {
  if (e.button !== 0) return
  last = { x: e.clientX, y: e.clientY }
  moved = false
  dragging.value = true
}
function columnAt(clientX: number): number | null {
  const box = el.value?.getBoundingClientRect()
  if (!box) return null
  const x = (clientX - box.left - view.value.x) / view.value.k
  return props.layout.columns.find((c) => x >= c.x && x < c.x + c.w)?.index ?? null
}
function move(e: PointerEvent) {
  hoverColumn.value = columnAt(e.clientX)
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
function leave() {
  up()
  hoverColumn.value = null
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

// Hovering a name shows everywhere it is used.
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

// Focusing a chapter, by its heading or a slice in it, dims the arrows from and to other chapters.
const away = computed(() => {
  const col = props.selectedColumn === null ? undefined : props.layout.columns[props.selectedColumn]
  return col ? outside(props.layout, col.chapter) : new Set<number>()
})

function edgeClass(i: number) {
  if (!lit.value) return { dim: away.value.has(i) }
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
}

// A double click anywhere in a column opens that slice.
function open(e: MouseEvent) {
  const col = columnAt(e.clientX)
  if (col !== null) emit("openSlice", col)
}

function firstSlice(chapter: number) {
  const col = props.layout.columns.find((c) => c.chapter === chapter)
  if (col) emit("selectSlice", col.index)
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
    @pointerleave="leave"
    @wheel="wheel"
  >
    <svg role="img" :aria-label="`Event model canvas, ${layout.columns.length} slices`" @click.self="background" @dblclick="open">
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
          <text v-if="row.label" class="lane-label" :x="16" :y="row.y + 22">{{ row.label }}</text>
          <text v-if="row.sub" class="lane-kind" :x="16" :y="row.y + 37">{{ row.sub }}</text>
        </g>
        <line class="lane-line" :x1="0" :x2="layout.width" :y1="layout.height" :y2="layout.height" />

        <g v-for="col in layout.columns" :key="col.index">
          <rect
            class="slice-outline"
            :class="{ hover: hoverColumn === col.index, selected: selectedColumn === col.index }"
            :x="col.x + 4"
            :y="layout.nameY + NAME_H + 4"
            :width="col.w - 8"
            :height="layout.height - layout.nameY - NAME_H - 8"
            rx="10"
          />
          <g
            class="slice-head"
            :class="{ selected: selectedColumn === col.index, hover: hoverColumn === col.index }"
            role="button"
            tabindex="0"
            :aria-label="`Slice ${col.title}`"
            @click.stop="emit('selectSlice', col.index)"
            @keydown.enter.stop="emit('openSlice', col.index)"
          >
            <rect :x="col.x + 4" :y="layout.nameY" :width="col.w - 8" :height="NAME_H" rx="10" />
            <text text-anchor="middle" :x="col.x + col.w / 2" :y="layout.nameY + NAME_H / 2 + 4.5">
              {{ col.title }}
            </text>
            <Mark :mark="col.mark" :at="[col.x + 20, layout.nameY + NAME_H / 2]" />
          </g>
        </g>

        <template v-for="col in layout.columns" :key="col.index">
          <Sticky v-for="(note, i) in col.notes ?? []" :key="i" :sticky="note" :x="col.railX ?? col.x" :w="NOTE_W" />
        </template>

        <template v-for="(chapter, i) in layout.chapters" :key="chapter.name + chapter.x">
          <g v-if="chapter.title" class="chapter" @click.stop="firstSlice(i)">
            <title v-if="chapter.note">{{ chapter.note }}</title>
            <path :d="arrow(chapter.x, chapter.w, i === 0)" />
            <text :x="chapter.x + (i === 0 ? 16 : 24)" :y="HEADER_H - 12 - ARROW_H / 2 + 5">{{ chapter.title }}</text>
          </g>
        </template>

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
          @pick="emit('selectCard', box)"
          @link="emit('link', $event)"
          @pointerenter="hoverCard(box)"
          @pointerleave="hoverCard(null)"
        />
      </g>
    </svg>
  </div>
</template>
