<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue"
import type { ModelJson } from "../../src/json.ts"
import Canvas from "./Canvas.vue"
import Detail from "./Detail.vue"
import { type Box, layout } from "./layout.ts"
import Nav from "./Nav.vue"

const model = ref<ModelJson | null>(null)
const error = ref<string | null>(null)
const live = ref(false)

/** A slice, and within it a card by kind and name. */
interface Selection {
  column: number
  kind?: Box["kind"]
  name?: string
}
const selection = ref<Selection | null>(null)
const hovered = ref<string | null>(null)
const focus = ref<{ column: number | null; seq: number }>({ column: null, seq: 0 })

const drawn = computed(() => (model.value ? layout(model.value) : null))
const selectedBox = computed<Box | null>(() => {
  const sel = selection.value
  if (!sel?.name) return null
  return (
    drawn.value?.boxes.find(
      (b) => b.column === sel.column && b.kind === sel.kind && b.name === sel.name,
    ) ?? null
  )
})
const selectedColumn = computed(() => {
  const sel = selection.value
  return sel && drawn.value?.columns[sel.column] ? drawn.value.columns[sel.column] : null
})

const LEGEND: [string, string][] = [
  ["ui", "screen"],
  ["command", "command"],
  ["event", "event"],
  ["readModel", "read model"],
  ["automation", "automation"],
]

// The URL hash is the selection, so every click is a history entry and a link.
function hashOf(sel: Selection | null): string {
  if (!sel) return ""
  const card = sel.kind && sel.name ? `/${sel.kind}/${encodeURIComponent(sel.name)}` : ""
  return `#c${sel.column}${card}`
}
function fromHash(): Selection | null {
  const m = location.hash.match(/^#c(\d+)(?:\/(\w+)\/(.*))?$/)
  if (!m) return null
  const column = Number(m[1])
  if (!m[2] || !m[3]) return { column }
  return { column, kind: m[2] as Box["kind"], name: decodeURIComponent(m[3]) }
}
function go(sel: Selection | null, options: { push?: boolean; zoom?: boolean } = {}) {
  selection.value = sel
  const hash = hashOf(sel)
  if (options.push !== false && hash !== location.hash) {
    history.pushState(null, "", hash || location.pathname)
  }
  if (options.zoom && sel) focus.value = { column: sel.column, seq: focus.value.seq + 1 }
}
function step(delta: number) {
  const count = drawn.value?.columns.length ?? 0
  if (count === 0) return
  const current = selection.value?.column ?? (delta > 0 ? -1 : count)
  const column = Math.min(count - 1, Math.max(0, current + delta))
  go({ column }, { zoom: true })
}
function follow(canonical: string) {
  const box = drawn.value?.boxes.find((b) => b.id === canonical)
  if (box) go({ column: box.column, kind: box.kind, name: box.name }, { zoom: true })
}

// The last good model stays on screen while the error shows above it.
let loaded = false
async function refresh() {
  const res = await fetch("/model.json", { cache: "no-store" })
  if (res.ok) {
    model.value = (await res.json()) as ModelJson
    error.value = null
    go(fromHash(), { push: false, zoom: !loaded })
    loaded = true
  } else {
    error.value = await res.text()
  }
}

let feed: EventSource | undefined
const onPop = () => go(fromHash(), { push: false, zoom: true })
function onKey(e: KeyboardEvent) {
  if (e.target instanceof HTMLInputElement) return
  if (e.key === "ArrowRight" || e.key === "ArrowDown") step(1)
  else if (e.key === "ArrowLeft" || e.key === "ArrowUp") step(-1)
  else if (e.key === "Escape") go(null)
  else return
  e.preventDefault()
}
onMounted(() => {
  refresh()
  feed = new EventSource("/events")
  feed.onopen = () => {
    live.value = true
  }
  feed.onerror = () => {
    live.value = false
  }
  feed.onmessage = () => refresh()
  window.addEventListener("keydown", onKey)
  window.addEventListener("popstate", onPop)
})
onUnmounted(() => {
  feed?.close()
  window.removeEventListener("keydown", onKey)
  window.removeEventListener("popstate", onPop)
})
</script>

<template>
  <div class="app">
    <header class="top">
      <h1>{{ model?.name ?? "Event model" }}</h1>
      <span v-if="model?.description" class="description">{{ model.description }}</span>
      <span class="legend">
        <span v-for="[kind, label] in LEGEND" :key="kind" class="swatch" :class="kind">{{ label }}</span>
      </span>
      <span class="status">
        <span class="dot" :class="{ off: !live, error: error !== null }"></span>
        {{ error !== null ? "assembly failed" : live ? "live" : "disconnected" }}
      </span>
    </header>
    <pre v-if="error !== null" class="error">{{ error }}</pre>
    <div class="body">
      <Nav
        v-if="drawn"
        :layout="drawn"
        :selected-column="selection?.column ?? null"
        @select="go({ column: $event }, { zoom: true })"
      />
      <Canvas
        v-if="drawn && model"
        :layout="drawn"
        :selected-column="selection?.column ?? null"
        :selected-box="selectedBox?.id ?? null"
        :hovered="hovered"
        :focus="focus"
        @select-card="go({ column: $event.column, kind: $event.kind, name: $event.name })"
        @select-slice="go({ column: $event }, { zoom: true })"
        @link="follow"
        @hover="hovered = $event"
        @clear="go(null)"
      />
      <div v-else class="empty">Waiting for the model…</div>
      <Detail
        v-if="selectedColumn && drawn && model"
        :box="selectedBox"
        :column="selectedColumn"
        :layout="drawn"
        :model="model"
        @close="go(null)"
      />
    </div>
  </div>
</template>
