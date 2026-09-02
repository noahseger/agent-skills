<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue"
import Card from "./Card.vue"
import { type Box, HEADER_H, LABEL_W, type Layout, NAME_H, path } from "./layout.ts"

const props = defineProps<{ layout: Layout; selected: string | null; hovered: string | null }>()
const emit = defineEmits<{ select: [box: Box | null]; hover: [name: string | null] }>()

const el = ref<HTMLDivElement | null>(null)
const view = ref({ x: 0, y: 0, k: 1 })
const dragging = ref(false)
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
onMounted(fit)
watch(
  () => props.layout.width + props.layout.height,
  (now, before) => {
    if (before === undefined) fit()
  },
)

let last: { x: number; y: number } | null = null
function down(e: PointerEvent) {
  if (e.button !== 0) return
  last = { x: e.clientX, y: e.clientY }
  dragging.value = true
}
function move(e: PointerEvent) {
  if (!last) return
  view.value = {
    ...view.value,
    x: view.value.x + e.clientX - last.x,
    y: view.value.y + e.clientY - last.y,
  }
  last = { x: e.clientX, y: e.clientY }
}
function up() {
  last = null
  dragging.value = false
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
  const state = { selected: b.id === props.selected, lit: false, dim: false }
  if (lit.value) {
    state.lit = lit.value.named.has(b.id)
    state.dim = !lit.value.cards.has(b.id)
  }
  return state
}
const transform = computed(
  () => `translate(${view.value.x} ${view.value.y}) scale(${view.value.k})`,
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
    @click.self="emit('select', null)"
  >
    <svg @click.self="emit('select', null)">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" />
        </marker>
        <marker id="arrow-lit" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#2563eb" />
        </marker>
      </defs>
      <g :transform="transform">
        <g v-for="row in layout.rows" :key="row.id">
          <rect class="lane" :class="row.kind" :x="0" :y="row.y" :width="layout.width" :height="row.h" />
          <line class="lane-line" :x1="0" :x2="layout.width" :y1="row.y" :y2="row.y" />
          <text v-if="row.label" class="lane-label" :x="16" :y="row.y + 22">{{ row.label }}</text>
          <text v-if="row.label" class="lane-kind" :x="16" :y="row.y + 37">
            {{ row.kind === "actor" ? "actor" : "stream" }}
          </text>
        </g>
        <line
          class="lane-line"
          :x1="0"
          :x2="layout.width"
          :y1="layout.height"
          :y2="layout.height"
        />
        <g v-for="chapter in layout.chapters" :key="chapter.name + chapter.x">
          <text class="chapter-title" :x="chapter.x + 20" :y="HEADER_H - 22">{{ chapter.name }}</text>
          <line
            class="chapter-rule"
            :x1="chapter.x + 20"
            :x2="chapter.x + chapter.w - 20"
            :y1="HEADER_H - 10"
            :y2="HEADER_H - 10"
          />
        </g>
        <text
          v-for="col in layout.columns"
          :key="col.index"
          class="slice-name"
          text-anchor="middle"
          :x="col.x + col.w / 2"
          :y="layout.nameY + NAME_H - 8"
        >
          {{ col.slice.name }}
        </text>
        <path
          v-for="(edge, i) in layout.edges"
          :key="i"
          class="edge"
          :class="{ dashed: edge.dashed, ...edgeClass(i) }"
          :d="path(byId.get(edge.from)!, byId.get(edge.to)!, edge.via)"
          :marker-end="lit?.edges.has(i) ? 'url(#arrow-lit)' : 'url(#arrow)'"
        />
        <Card
          v-for="box in layout.boxes"
          :key="box.id"
          :box="box"
          :class="cardClass(box)"
          @click.stop="emit('select', box)"
          @pointerenter="emit('hover', box.name)"
          @pointerleave="emit('hover', null)"
        />
      </g>
    </svg>
  </div>
</template>
