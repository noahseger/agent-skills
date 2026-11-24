<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue"
import type { Feed } from "../../src/spec.ts"
import type { Board } from "./board.ts"
import Canvas from "./Canvas.vue"
import Detail from "./Detail.vue"
import {
  type Box,
  boxOf,
  crumbs,
  fromHash,
  hashOf,
  ICON,
  layout,
  nextError,
  type Scope,
  type Selection,
} from "./layout.ts"
import Messages from "./Messages.vue"
import { measure } from "./measure.ts"
import Nav from "./Nav.vue"
import { read } from "./read.ts"
import SliceView from "./SliceView.vue"

const model = ref<Board | null>(null)
const error = ref<string | null>(null)
const live = ref(false)

const selection = ref<Selection | null>(null)
const picked = computed(() =>
  typeof selection.value === "object" && selection.value && "column" in selection.value
    ? selection.value
    : null,
)
/** The selected slice or chapter, which the canvas fits. */
const scope = computed<Scope | null>(() =>
  typeof selection.value === "object" ? selection.value : null,
)
const hovered = ref<string | null>(null)
/** The keyboard leads, so hover shows nothing, from a key press until the mouse next moves. */
const keyed = ref(false)
/** Bumping `seq` fits the slice or chapter, or with none the whole model. */
const focus = ref<{ scope: Scope | null; seq: number }>({ scope: null, seq: 0 })
/** The board alone, for showing the model to others: no navigation, detail, marks or selection. */
const present = ref(false)

const drawn = computed(() => (model.value ? layout(model.value, measure) : null))
const selectedBox = computed(() => (drawn.value && boxOf(drawn.value, picked.value)) ?? null)
const selectedColumn = computed(() => {
  const sel = picked.value
  return sel && drawn.value?.columns[sel.column] ? drawn.value.columns[sel.column] : null
})
const sliceOpen = computed(() => picked.value?.view === "slice")
const path = computed(() =>
  present.value
    ? crumbs(model.value?.name ?? "Event model", null, null)
    : crumbs(model.value?.name ?? "Event model", drawn.value, selection.value),
)

const LEGEND: [string, string][] = [
  ["ui", "screen"],
  ["command", "command"],
  ["event", "event"],
  ["external", "external event"],
  ["readModel", "view"],
  ["automation", "automation"],
]

// The selection lives in the URL hash, so Back works and every view is a link.
function go(sel: Selection | null, options: { push?: boolean; zoom?: boolean } = {}) {
  selection.value = sel
  const hash = hashOf(sel)
  if (options.push !== false && hash !== location.hash) {
    history.pushState(null, "", hash || location.pathname)
  }
  if (options.zoom && sel && sel !== "model" && !("view" in sel && sel.view === "slice")) {
    focus.value = { scope: sel, seq: focus.value.seq + 1 }
  }
}
function selectChapter(chapter: number) {
  go({ chapter }, { zoom: true })
}
function step(delta: number) {
  const columns = drawn.value?.columns ?? []
  if (columns.length === 0) return
  // From a chapter, or from nothing the whole board, → steps to its first slice and ← to its last.
  const sel = scope.value
  const inside =
    sel && "chapter" in sel ? columns.filter((c) => c.chapter === sel.chapter) : columns
  const edge = (delta > 0 ? inside[0] : inside.at(-1))?.index ?? 0
  const current = picked.value?.column ?? edge - delta
  const column = Math.min(columns.length - 1, Math.max(0, current + delta))
  go({ column, ...(sliceOpen.value ? { view: "slice" } : {}) }, { zoom: true })
}
function stepError(delta: 1 | -1) {
  if (!drawn.value) return
  const at = selection.value === "model" ? "model" : (picked.value?.column ?? null)
  const next = nextError(drawn.value, at, delta)
  if (next === "model") go("model")
  else if (next !== undefined)
    go({ column: next, ...(sliceOpen.value ? { view: "slice" } : {}) }, { zoom: true })
}
function togglePresent() {
  present.value = !present.value
  if (present.value) focus.value = { scope: null, seq: focus.value.seq + 1 }
}
function pick(box: Box, zoom = false) {
  const view = sliceOpen.value ? { view: "slice" as const } : {}
  go({ column: box.column, kind: box.kind, name: box.name, ...view }, { zoom })
}
function follow(canonical: string) {
  const box = drawn.value?.boxes.find((b) => b.id === canonical)
  if (box) pick(box, true)
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
    go(fromHash(location.hash), { push: false, zoom: !loaded })
    loaded = true
    return
  }
  const res = await fetch("/model.json", { cache: "no-store" })
  if (res.ok) {
    model.value = read((await res.json()) as Feed)
    error.value = null
    go(fromHash(location.hash), { push: false, zoom: !loaded })
    loaded = true
  } else {
    error.value = await res.text()
  }
}

let feed: EventSource | undefined
const onPop = () => go(fromHash(location.hash), { push: false, zoom: true })
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
  keyed.value = true
}
// A real move: the browser also sends moves of none when the canvas slides under a resting pointer.
function onMove(e: PointerEvent) {
  if (e.movementX || e.movementY) keyed.value = false
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
  window.addEventListener("pointermove", onMove)
  window.addEventListener("popstate", onPop)
})
onUnmounted(() => {
  feed?.close()
  window.removeEventListener("keydown", onKey)
  window.removeEventListener("pointermove", onMove)
  window.removeEventListener("popstate", onPop)
})
</script>

<template>
  <div class="app" :class="{ presenting: present, keyed }">
    <header class="top">
      <h1 class="crumbs">
        <template v-for="(crumb, i) in path" :key="crumb.level">
          <span v-if="i > 0" class="sep" aria-hidden="true">›</span>
          <button v-if="i < path.length - 1" type="button" :title="crumb.text" @click="go(crumb.to, { zoom: true })">{{ crumb.text }}</button>
          <span v-else :title="crumb.text">{{ crumb.text }}</span>
        </template>
      </h1>
      <span v-if="model?.description" class="description">{{ model.description }}</span>
      <span class="legend">
        <span v-for="[kind, label] in LEGEND" :key="kind" class="swatch" :class="kind">{{ label }}</span>
        <span v-for="(icon, kind) in ICON" :key="kind" class="swatch note" :class="kind" :data-icon="icon">{{ kind }}</span>
      </span>
      <details class="keys">
        <summary>Shortcuts</summary>
        <dl>
          <dt>← →</dt><dd>move between slices</dd>
          <dt>Enter</dt><dd>open a slice</dd>
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
      <Nav v-if="drawn && !present" :layout="drawn" :selected="selection" @select="openSlice" @chapter="selectChapter" @model="go('model')" />
      <SliceView
        v-if="drawn && model && sliceOpen && selectedColumn && !present"
        :layout="drawn"
        :model="model"
        :column="selectedColumn"
        :selected-box="selectedBox?.id ?? null"
        :hovered="keyed ? null : hovered"
        @select-card="pick"
        @hover="hovered = $event"
        @link="follow"
        @step="step"
        @close="go({ column: selectedColumn.index }, { zoom: true })"
      />
      <Canvas
        v-else-if="drawn && model"
        :layout="drawn"
        :selected="present ? null : scope"
        :selected-box="present ? null : (selectedBox?.id ?? null)"
        :hovered="keyed ? null : hovered"
        :focus="focus"
        @select-card="pick"
        @select-slice="go({ column: $event }, { zoom: true })"
        @select-chapter="selectChapter"
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
