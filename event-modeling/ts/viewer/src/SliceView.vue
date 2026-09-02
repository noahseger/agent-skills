<script setup lang="ts">
import { computed } from "vue"
import type { ModelJson } from "../../src/json.ts"
import Card from "./Card.vue"
import {
  type Box,
  CARD_W,
  COMPACT_H,
  type Column,
  type Edge,
  LANE_PAD,
  type Layout,
  parse,
  path,
  STACK_GAP,
} from "./layout.ts"

// One slice at full width: its column as drawn on the canvas, the facts about
// it, and every specification with room to read. The page scrolls.
const props = defineProps<{
  layout: Layout
  model: ModelJson
  column: Column
  selectedBox: string | null
  hovered: string | null
}>()
const emit = defineEmits<{
  selectCard: [box: Box]
  hover: [name: string | null]
  link: [canonical: string]
  step: [delta: number]
  close: []
}>()

const chapter = computed(() => props.layout.chapters[props.column.chapter])

// The column as drawn on the canvas, with the lanes this slice does not use
// closed up, so the cards sit together. What the slice reads is drawn on the
// canvas from the read model's own card in another column; here it gets a
// reference card of its own, just above whatever reads it.
const local = computed(() => {
  const index = props.column.index
  const mine = props.layout.boxes.filter((b) => b.column === index)
  const within = (b: Box, r: { y: number; h: number }) => b.y >= r.y && b.y + b.h <= r.y + r.h
  const blocks: { label: string; boxes: Box[] }[] = []
  for (const r of props.layout.rows) {
    const inRow = mine.filter((b) => within(b, r))
    if (r.kind === "specs" || inRow.length === 0) continue
    blocks.push({ label: r.label, boxes: inRow })
  }

  const s = props.column.slice
  const consumer =
    mine.find((b) => b.kind === "automation") ?? mine.find((b) => b.kind === "command")
  const refs: Box[] = []
  const extra: Edge[] = []
  for (const name of [...(s.reads ?? []), ...(s.polls ? [s.polls] : [])]) {
    const full = props.layout.boxes.find(
      (b) => b.name === name && b.kind === "readModel" && !b.compact,
    )
    if (!full || !consumer) continue
    const ref: Box = {
      ...full,
      id: `read:${name}`,
      compact: true,
      canonical: full.id,
      column: index,
      x: props.column.x + (props.column.w - CARD_W) / 2,
      y: refs.length * (COMPACT_H + STACK_GAP),
      w: CARD_W,
      h: COMPACT_H,
    }
    refs.push(ref)
    extra.push({ from: ref.id, to: consumer.id, dashed: true })
  }
  if (refs.length > 0) {
    const at = blocks.findIndex((b) => b.boxes.some((b) => b.id === consumer?.id))
    blocks.splice(Math.max(0, at), 0, { label: "Reads", boxes: refs })
  }

  const boxes: Box[] = []
  const lanes: { label: string; y: number; h: number }[] = []
  let y = 0
  for (const block of blocks) {
    const top = Math.min(...block.boxes.map((b) => b.y)) - LANE_PAD - 10
    const bottom = Math.max(...block.boxes.map((b) => b.y + b.h)) + LANE_PAD
    for (const b of block.boxes) boxes.push({ ...b, y: b.y + y - top })
    lanes.push({ label: block.label, y, h: bottom - top })
    y += bottom - top
  }
  return { boxes, lanes, height: y, extra }
})
const byId = computed(() => new Map(local.value.boxes.map((b) => [b.id, b])))
const edges = computed(() => [
  ...props.layout.edges.filter((e) => !e.points && byId.value.has(e.from) && byId.value.has(e.to)),
  ...local.value.extra,
])
const specs = computed(() => props.layout.specs.filter((s) => s.column === props.column.index))
const viewBox = computed(() => `${props.column.x} 0 ${props.column.w} ${local.value.height}`)

const slice = computed(() => props.column.slice)
const actor = computed(() => props.model.actors.find((a) => a.id === slice.value.actor)?.name)
const triggers = computed(() => {
  const t = slice.value.trigger
  return t ? (Array.isArray(t) ? t : [t]).map((x) => parse(x).name) : []
})
const first = props.layout.columns.length > 0 ? 0 : -1
const last = props.layout.columns.length - 1

/** The card an element is drawn in full on, for a link out of the facts. */
function canonical(name: string): string | undefined {
  return props.layout.boxes.find((b) => b.name === name && !b.compact)?.id
}
function follow(name: string) {
  const id = canonical(name)
  if (id) emit("link", id)
}
function cardClass(b: Box) {
  return { selected: b.id === props.selectedBox, lit: props.hovered === b.name }
}
</script>

<template>
  <section class="slice-view" aria-label="Slice">
    <header class="slice-header">
      <div class="crumbs">
        <span class="chapter">{{ chapter?.title }}</span>
        <span class="sep">›</span>
        <span class="name">{{ column.title }}</span>
        <span v-if="column.noted" class="note-dot"></span>
      </div>
      <div class="controls">
        <button type="button" aria-label="Previous slice" :disabled="column.index <= first" @click="emit('step', -1)">←</button>
        <button type="button" aria-label="Next slice" :disabled="column.index >= last" @click="emit('step', 1)">→</button>
        <button type="button" class="canvas-btn" @click="emit('close')">Canvas</button>
      </div>
    </header>

    <div class="slice-body">
      <svg class="column" :viewBox="viewBox">
        <g v-for="lane in local.lanes" :key="lane.label + lane.y">
          <line class="lane-line" :x1="column.x" :x2="column.x + column.w" :y1="lane.y" :y2="lane.y" />
          <text v-if="lane.label" class="lane-tag" :x="column.x + 6" :y="lane.y + 11">{{ lane.label }}</text>
        </g>
        <path
          v-for="(e, i) in edges"
          :key="i"
          class="edge"
          :class="{ dashed: e.dashed }"
          :d="path(byId.get(e.from)!, byId.get(e.to)!)"
          marker-end="url(#arrow)"
        />
        <Card
          v-for="b in local.boxes"
          :key="b.id"
          :box="b"
          :class="cardClass(b)"
          @click.stop="emit('selectCard', b)"
          @pick="emit('selectCard', b)"
          @link="emit('link', $event)"
          @pointerenter="emit('hover', b.name)"
          @pointerleave="emit('hover', null)"
        />
      </svg>

      <div class="slice-right">
        <div class="facts">
          <p v-if="slice.note" class="note"><span class="badge" aria-hidden="true">i</span>{{ slice.note }}</p>
          <dl>
            <template v-if="actor"><dt>Actor</dt><dd>{{ actor }}</dd></template>
            <template v-if="slice.ui"><dt>Service</dt><dd>{{ slice.ui }}</dd></template>
            <template v-if="slice.query?.length"><dt>Query</dt><dd>{{ slice.query.join(", ") }}</dd></template>
            <template v-if="slice.polls">
              <dt>Polls</dt>
              <dd><button type="button" class="ref" @click="follow(slice.polls)">{{ slice.polls }}</button></dd>
            </template>
            <template v-if="slice.reads?.length">
              <dt>Reads</dt>
              <dd>
                <button v-for="r in slice.reads" :key="r" type="button" class="ref" @click="follow(r)">{{ r }}</button>
              </dd>
            </template>
            <template v-if="triggers.length">
              <dt>On</dt>
              <dd>
                <button v-for="t in triggers" :key="t" type="button" class="ref" @click="follow(t)">{{ t }}</button>
              </dd>
            </template>
          </dl>
          <template v-if="slice.mapping">
            <h3>Mapping</h3>
            <dl v-for="(fields, event) in slice.mapping" :key="event">
              <template v-for="(src, field) in fields" :key="field">
                <dt>{{ event }}.{{ field }}</dt>
                <dd>
                  {{ src.from !== undefined ? `← ${src.from}` : src.count !== undefined ? `count of ${src.count}` : `= ${JSON.stringify(src.value)}` }}
                </dd>
              </template>
            </dl>
          </template>
        </div>

        <h3 v-if="specs.length" class="specs-title">Specifications</h3>
        <div class="specs-grid">
          <article v-for="spec in specs" :key="spec.title.join()" class="hspec">
            <h4>{{ spec.title.join(" ") }}</h4>
            <div v-for="step in spec.steps" :key="step.word" class="hstep">
              <span class="word">{{ step.word }}</span>
              <div class="hcards">
                <div v-for="(card, i) in step.cards" :key="i" class="hcard" :class="card.kind" @pointerenter="emit('hover', card.name)" @pointerleave="emit('hover', null)">
                  <div class="hname">{{ card.name }}</div>
                  <div v-for="line in card.lines" :key="line" class="hline">{{ line }}</div>
                </div>
              </div>
            </div>
          </article>
        </div>
      </div>
    </div>
  </section>
</template>
