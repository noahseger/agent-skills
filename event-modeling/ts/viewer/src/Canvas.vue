<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue"
import Card from "./Card.vue"
import Fit from "./Fit.vue"
import {
  ARROW_H,
  type Box,
  fitLines,
  fitTo,
  LABEL_W,
  type Layout,
  NAME_H,
  outside,
  path,
  polyline,
  type Row,
  type Scope,
  usedLanes,
} from "./layout.ts"
import Mark from "./Mark.vue"
import { measure } from "./measure.ts"
import Sticky from "./Sticky.vue"

const props = defineProps<{
  layout: Layout
  /** The selected slice or chapter. */
  selected: Scope | null
  selectedBox: string | null
  hovered: string | null
  /** Bumping `seq` fits the slice or chapter top to bottom, or with none the whole model. */
  focus: { scope: Scope | null; seq: number }
}>()
const emit = defineEmits<{
  selectCard: [box: Box]
  selectSlice: [column: number]
  selectChapter: [chapter: number]
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
const selectedColumn = computed(() =>
  props.selected && "column" in props.selected ? props.selected.column : null,
)

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
  if (props.focus.scope !== null) focusOn(props.focus.scope)
})

function focusOn(scope: Scope) {
  const box = el.value?.getBoundingClientRect()
  const fitted = box && fitTo(props.layout, scope, { w: box.width, h: box.height })
  if (!fitted) return
  animate.value = true
  view.value = fitted
  setTimeout(() => {
    animate.value = false
  }, 350)
}
// After the DOM updates, so a canvas that just grew is measured at its new size.
watch(
  () => props.focus.seq,
  () => {
    if (props.focus.scope !== null) focusOn(props.focus.scope)
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
/** A point on the screen as a point on the board. */
function at(e: MouseEvent) {
  const box = el.value?.getBoundingClientRect()
  return {
    x: (e.clientX - (box?.left ?? 0) - view.value.x) / view.value.k,
    y: (e.clientY - (box?.top ?? 0) - view.value.y) / view.value.k,
  }
}
const within = (x: number, c: { x: number; w: number }) => x >= c.x && x < c.x + c.w
function columnAt(e: MouseEvent): number | null {
  const { x } = at(e)
  return props.layout.columns.find((c) => within(x, c))?.index ?? null
}
function move(e: PointerEvent) {
  hoverColumn.value = columnAt(e)
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
// A click selects what is under it: above the slice names a chapter, below them a slice, anywhere
// in its column; a card selects itself. Nothing there clears the selection.
function click(e: MouseEvent) {
  if (moved) return
  const { x, y } = at(e)
  const chapter = props.layout.chapters.findIndex((c) => c.title && within(x, c))
  const column = columnAt(e)
  if (y < props.layout.nameY && chapter >= 0) emit("selectChapter", chapter)
  else if (y >= props.layout.nameY && column !== null) emit("selectSlice", column)
  else emit("clear")
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

// Selecting a chapter, or a slice in it, dims the arrows from and to other chapters.
const away = computed(() => {
  const sel = props.selected
  const chapter =
    sel && ("chapter" in sel ? sel.chapter : props.layout.columns[sel.column]?.chapter)
  return typeof chapter === "number" ? outside(props.layout, chapter) : new Set<number>()
})

// A selection dims the lanes it has no card in.
const used = computed(() => (props.selected ? usedLanes(props.layout, props.selected) : null))

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

// A chapter is an arrow along the time line; the first has a flat start.
function arrow(x: number, w: number, first: boolean) {
  const y = props.layout.nameY - ARROW_H - 12
  const h = ARROW_H
  const n = 12
  const start = first ? `M${x} ${y}` : `M${x} ${y} L${x + n} ${y + h / 2} L${x} ${y + h}`
  const body = first ? `L${x} ${y + h}` : ""
  return `${start} ${body} L${x + w - n - 4} ${y + h} L${x + w - 4} ${y + h / 2} L${x + w - n - 4} ${y} Z`
}
/** A lane's name wraps in the label column as far as its lane is tall, its kind under it. */
const LANE_ROOM = LABEL_W - 24
const laneLines = (row: Row) => Math.max(1, Math.floor((row.h - 45) / 15) + 1)
const drawnLines = (row: Row) =>
  fitLines(row.label, LANE_ROOM, laneLines(row), (s) => measure(s, "lane")).length
const notes = computed(() =>
  [...props.layout.chapters, ...props.layout.columns].flatMap((c) => c.notes ?? []),
)
// Lane names stay at the viewport's left edge, so every lane is named wherever the canvas is panned.
const pin = computed(() => `translateX(${Math.max(0, -view.value.x / view.value.k)}px)`)
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
    <svg role="img" :aria-label="`Event model canvas, ${layout.columns.length} slices`" @click="click">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" />
        </marker>
        <marker id="arrow-lit" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#2563eb" />
        </marker>
        <!-- A lane name's backing ends in a fade, so the cards it cuts read as passing under it. -->
        <linearGradient id="pin-fade">
          <stop :offset="(LABEL_W - 8) / (LABEL_W + 16)" stop-color="white" />
          <stop offset="1" stop-color="white" stop-opacity="0" />
        </linearGradient>
        <mask id="pin-mask" maskContentUnits="objectBoundingBox">
          <rect width="1" height="1" fill="url(#pin-fade)" />
        </mask>
      </defs>
      <g class="world" :class="{ animate }" :style="{ transform }">
        <rect class="page" :x="0" :y="0" :width="layout.width" :height="layout.height" />
        <g v-for="row in layout.rows" :key="row.id">
          <rect class="lane" :class="[row.kind, { idle: used && !used.has(row.id) }]" :x="0" :y="row.y" :width="layout.width" :height="row.h" />
          <line class="lane-line" :x1="0" :x2="layout.width" :y1="row.y" :y2="row.y" />
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
            @keydown.enter.stop="emit('openSlice', col.index)"
          >
            <rect :x="col.x + 4" :y="layout.nameY" :width="col.w - 8" :height="NAME_H" rx="10" />
            <Fit
              text-anchor="middle"
              :text="col.title"
              :room="col.w - 60"
              font="slice"
              :x="col.x + col.w / 2"
              :y="layout.nameY + NAME_H / 2 + 4.5"
            />
            <Mark :mark="col.mark" :at="[col.x + 20, layout.nameY + NAME_H / 2]" />
          </g>
        </g>

        <Sticky v-for="(note, i) in notes" :key="i" :sticky="note" />

        <template v-for="(chapter, i) in layout.chapters" :key="chapter.name + chapter.x">
          <g v-if="chapter.title" class="chapter">
            <path :d="arrow(chapter.x, chapter.w, i === 0)" />
            <Fit
              :text="chapter.title"
              :room="chapter.w - (i === 0 ? 38 : 46)"
              font="chapter"
              :x="chapter.x + (i === 0 ? 16 : 24)"
              :y="layout.nameY - 12 - ARROW_H / 2 + 5"
            />
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

        <g
          v-for="row in layout.rows"
          :key="row.id"
          class="lane-name"
          :class="[row.kind, { idle: used && !used.has(row.id) }]"
          :style="{ transform: pin }"
        >
          <rect :x="0" :y="row.y + 1" :width="LABEL_W + 16" :height="row.h - 1" mask="url(#pin-mask)" />
          <Fit v-if="row.label" class="lane-label" :text="row.label" :room="LANE_ROOM" font="lane" :lines="laneLines(row)" :x="16" :y="row.y + 22" />
          <text v-if="row.sub" class="lane-kind" :x="16" :y="row.y + 37 + (drawnLines(row) - 1) * 15">
            {{ row.sub }}
          </text>
        </g>
      </g>
    </svg>
  </div>
</template>
