<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue"
import type { ModelJson } from "../../src/json.ts"
import Canvas from "./Canvas.vue"
import Detail from "./Detail.vue"
import { type Box, layout } from "./layout.ts"

const model = ref<ModelJson | null>(null)
const error = ref<string | null>(null)
const live = ref(false)
const selected = ref<Box | null>(null)
const hovered = ref<string | null>(null)

const drawn = computed(() => (model.value ? layout(model.value) : null))

const LEGEND: [string, string][] = [
  ["ui", "screen"],
  ["command", "command"],
  ["event", "event"],
  ["readModel", "read model"],
  ["automation", "automation"],
]

// The last good model stays on screen while the error shows above it.
async function refresh() {
  const res = await fetch("/model.json", { cache: "no-store" })
  if (res.ok) {
    model.value = (await res.json()) as ModelJson
    error.value = null
    select(selected.value?.name ?? decodeURIComponent(location.hash.slice(1)), selected.value?.id)
  } else {
    error.value = await res.text()
  }
}

// The URL hash names the selected card, so a link opens the model on it.
function select(name: string | null | undefined, id?: string) {
  const boxes = drawn.value?.boxes ?? []
  const box = name
    ? (boxes.find((b) => b.id === id && b.name === name) ?? boxes.find((b) => b.name === name))
    : undefined
  selected.value = box ?? null
  history.replaceState(null, "", box ? `#${encodeURIComponent(box.name)}` : location.pathname)
}

let feed: EventSource | undefined
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
})
onUnmounted(() => {
  feed?.close()
  window.removeEventListener("keydown", onKey)
})

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") select(null)
}
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
      <Canvas
        v-if="drawn && model"
        :layout="drawn"
        :selected="selected?.id ?? null"
        :hovered="hovered"
        @select="select($event?.name, $event?.id)"
        @hover="hovered = $event"
      />
      <div v-else class="empty">Waiting for the model…</div>
      <Detail
        v-if="selected && drawn && model"
        :box="selected"
        :layout="drawn"
        :model="model"
        @close="select(null)"
      />
    </div>
  </div>
</template>
