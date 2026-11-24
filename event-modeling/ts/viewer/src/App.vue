<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue"
import type { Feed } from "../../src/spec.ts"
import type { Board } from "./board.ts"
import Canvas from "./Canvas.vue"
import Detail from "./Detail.vue"
import { type Box, layout, nextError } from "./layout.ts"
import Messages from "./Messages.vue"
import { measure } from "./measure.ts"
import Nav from "./Nav.vue"
import { read } from "./read.ts"
import SliceView from "./SliceView.vue"

const model = ref<Board | null>(null)
const error = ref<string | null>(null)
const live = ref(false)

/** A slice, within it a card by kind and name, and whether the slice is open at full width. */
interface Selection {
  column: number
  kind?: Box["kind"]
  name?: string
  view?: "slice"
}
/** A slice, or the model's own messages. */
const selection = ref<Selection | "model" | null>(null)
const picked = computed(() => (selection.value === "model" ? null : selection.value))
const at = computed(() => (selection.value === "model" ? "model" : (picked.value?.column ?? null)))
const hovered = ref<string | null>(null)
/** Bumping `seq` brings the column into view, or with none the whole model. */
const focus = ref<{ column: number | null; seq: number }>({ column: null, seq: 0 })
/** The board alone, for showing the model to others: no navigation, detail, marks or selection. */
const present = ref(false)

const drawn = computed(() => (model.value ? layout(model.value, measure) : null))
const selectedBox = computed<Box | null>(() => {
  const sel = picked.value
  if (!sel?.name) return null
  return (
    drawn.value?.boxes.find(
      (b) => b.column === sel.column && b.kind === sel.kind && b.name === sel.name,
    ) ?? null
  )
})
const selectedColumn = computed(() => {
  const sel = picked.value
  return sel && drawn.value?.columns[sel.column] ? drawn.value.columns[sel.column] : null
})
const sliceOpen = computed(() => picked.value?.view === "slice")

const LEGEND: [string, string][] = [
  ["ui", "screen"],
  ["command", "command"],
  ["event", "event"],
  ["external", "external event"],
  ["readModel", "view"],
  ["automation", "automation"],
]

// The selection lives in the URL hash, so Back works and every view is a link.
function hashOf(sel: Selection | "model" | null): string {
  if (!sel) return ""
  if (sel === "model") return "#model"
  const card = sel.kind && sel.name ? `/${sel.kind}/${encodeURIComponent(sel.name)}` : ""
  return `#${sel.view === "slice" ? "s" : "c"}${sel.column}${card}`
}
function fromHash(): Selection | "model" | null {
  if (location.hash === "#model") return "model"
  const m = location.hash.match(/^#([cs])(\d+)(?:\/(\w+)\/(.*))?$/)
  if (!m) return null
  const sel: Selection = { column: Number(m[2]) }
  if (m[1] === "s") sel.view = "slice"
  if (m[3] && m[4]) {
    sel.kind = m[3] as Box["kind"]
    sel.name = decodeURIComponent(m[4])
  }
  return sel
}
function go(sel: Selection | "model" | null, options: { push?: boolean; zoom?: boolean } = {}) {
  selection.value = sel
  const hash = hashOf(sel)
  if (options.push !== false && hash !== location.hash) {
    history.pushState(null, "", hash || location.pathname)
  }
  if (options.zoom && sel && sel !== "model" && sel.view !== "slice") {
    focus.value = { column: sel.column, seq: focus.value.seq + 1 }
  }
}
function step(delta: number) {
  const count = drawn.value?.columns.length ?? 0
  if (count === 0) return
  const current = picked.value?.column ?? (delta > 0 ? -1 : count)
  const column = Math.min(count - 1, Math.max(0, current + delta))
  go({ column, ...(sliceOpen.value ? { view: "slice" } : {}) }, { zoom: true })
}
function stepError(delta: 1 | -1) {
  if (!drawn.value) return
  const next = nextError(drawn.value, at.value, delta)
  if (next === "model") go("model")
  else if (next !== undefined)
    go({ column: next, ...(sliceOpen.value ? { view: "slice" } : {}) }, { zoom: true })
}
function togglePresent() {
  present.value = !present.value
  if (present.value) focus.value = { column: null, seq: focus.value.seq + 1 }
}
function pick(box: Box) {
  go({
    column: box.column,
    kind: box.kind,
    name: box.name,
    ...(sliceOpen.value ? { view: "slice" } : {}),
  })
}
function follow(canonical: string) {
  const box = drawn.value?.boxes.find((b) => b.id === canonical)
  if (box) {
    go(
      {
        column: box.column,
        kind: box.kind,
        name: box.name,
        ...(sliceOpen.value ? { view: "slice" } : {}),
      },
      { zoom: true },
    )
  }
}
function openSlice(column: number) {
  go({ column, view: "slice" })
}

// An exported page carries the model in a script tag: no server, no feed.
const embedded = document.getElementById("model")
const snapshot = embedded !== null

// The last good model stays on screen while the error shows above it.
let loaded = false
async function refresh() {
  if (embedded) {
    model.value = read(JSON.parse(embedded.textContent ?? "null") as Feed)
    go(fromHash(), { push: false, zoom: !loaded })
    loaded = true
    return
  }
  const res = await fetch("/model.json", { cache: "no-store" })
  if (res.ok) {
    model.value = read((await res.json()) as Feed)
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
  // A letter with a modifier is the browser's.
  const letter = e.metaKey || e.ctrlKey || e.altKey ? "" : e.key.toLowerCase()
  // Left and right move between slices; up and down are left to the page.
  if (e.key === "ArrowRight") step(1)
  else if (e.key === "ArrowLeft") step(-1)
  else if (letter === "e") stepError(e.shiftKey ? -1 : 1)
  else if (letter === "p") togglePresent()
  else if (e.key === "Enter" && picked.value && !sliceOpen.value) {
    openSlice(picked.value.column)
  } else if (e.key === "Escape") {
    const sel = picked.value
    go(sel?.view === "slice" ? { column: sel.column } : null, { zoom: true })
  } else return
  e.preventDefault()
}
onMounted(() => {
  refresh()
  if (!snapshot) {
    feed = new EventSource("/events")
    // A reconnected feed may have missed a save, so reload.
    feed.onopen = () => {
      if (live.value === false && loaded) void refresh()
      live.value = true
    }
    feed.onerror = () => {
      live.value = false
    }
    feed.onmessage = () => refresh()
  }
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
  <div class="app" :class="{ presenting: present }">
    <header class="top">
      <h1>{{ model?.name ?? "Event model" }}</h1>
      <span v-if="model?.description" class="description">{{ model.description }}</span>
      <span class="legend">
        <span v-for="[kind, label] in LEGEND" :key="kind" class="swatch" :class="kind">{{ label }}</span>
      </span>
      <details class="keys">
        <summary>Keys</summary>
        <dl>
          <dt>← →</dt><dd>move between slices</dd>
          <dt>Enter</dt><dd>open a slice (or double-click)</dd>
          <dt>Esc</dt><dd>go back</dd>
          <dt>E</dt><dd>next error (Shift-E: previous)</dd>
          <dt>P</dt><dd>present</dd>
        </dl>
      </details>
      <button type="button" class="present" :aria-pressed="present" title="The board alone (P)" @click="togglePresent">Present</button>
      <span class="status" role="status">
        <span class="dot" :class="{ off: !live && !snapshot, error: error !== null }" aria-hidden="true"></span>
        {{ error !== null ? "Model didn't load" : snapshot ? "Exported copy" : live ? "Live" : "Disconnected" }}
      </span>
    </header>
    <pre v-if="error !== null" class="error" role="alert">{{ error }}</pre>
    <main class="body">
      <Nav v-if="drawn && !present" :layout="drawn" :selected="at" @select="openSlice" @model="go('model')" />
      <SliceView
        v-if="drawn && model && sliceOpen && selectedColumn && !present"
        :layout="drawn"
        :model="model"
        :column="selectedColumn"
        :selected-box="selectedBox?.id ?? null"
        :hovered="hovered"
        @select-card="pick"
        @hover="hovered = $event"
        @link="follow"
        @step="step"
        @close="go({ column: selectedColumn.index }, { zoom: true })"
      />
      <Canvas
        v-else-if="drawn && model"
        :layout="drawn"
        :selected-column="present ? null : (picked?.column ?? null)"
        :selected-box="present ? null : (selectedBox?.id ?? null)"
        :hovered="hovered"
        :focus="focus"
        @select-card="pick"
        @select-slice="go({ column: $event }, { zoom: true })"
        @open-slice="openSlice"
        @link="follow"
        @hover="hovered = $event"
        @clear="go(null)"
      />
      <div v-else class="empty">Waiting for the model…</div>
      <Detail
        v-if="selectedColumn && drawn && model && !present && (!sliceOpen || selectedBox)"
        :box="selectedBox"
        :column="selectedColumn"
        :layout="drawn"
        :model="model"
        :open="sliceOpen"
        @close="go(sliceOpen ? { column: selectedColumn.index, view: 'slice' } : null)"
        @open="openSlice(selectedColumn.index)"
        @goto="openSlice"
      />
      <aside v-else-if="selection === 'model' && drawn && !present" class="detail" aria-label="Details">
        <header>
          <h2>Model</h2>
          <button class="close" type="button" title="Close (Esc)" @click="go(null)">×</button>
        </header>
        <Messages :messages="drawn.model.messages" :boxes="drawn.boxes" />
        <p v-if="!drawn.model.mark" class="note">Nothing left to do.</p>
      </aside>
    </main>
  </div>
</template>
