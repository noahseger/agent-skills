<script setup lang="ts">
import { computed } from "vue"
import { words } from "../../src/types.ts"
import type { Board, BoardField } from "./board.ts"
import { type Box, type Column, KIND, type Layout, parse, parseClause, source } from "./layout.ts"
import Messages from "./Messages.vue"
import Name from "./Name.vue"

const props = defineProps<{
  box: Box | null
  column: Column
  layout: Layout
  model: Board
  /** Whether the slice is already open at full width. */
  open: boolean
}>()
defineEmits<{ close: []; open: []; goto: [column: number] }>()

const slice = computed(() => props.column.slice)

// A compact card is a reference; its fields are where the element is drawn in full.
const fields = computed(() => {
  const box = props.box
  if (!box) return { fields: [], keys: [] }
  if (!box.compact) return { fields: box.fields, keys: box.keys }
  const full = props.layout.boxes.find((b) => b.name === box.name && !b.compact)
  return full ? { fields: full.fields, keys: full.keys } : { fields: [], keys: [] }
})

// Each field with its type, then an object's own fields beneath it, indented.
const rows = computed(() => {
  const typed = props.box ? (props.model.fields?.[props.box.name] ?? []) : []
  const flat = (f: BoardField, depth: number): { f: BoardField; depth: number }[] => [
    { f, depth },
    ...(f.fields ?? []).flatMap((s) => flat(s, depth + 1)),
  ]
  return fields.value.fields.flatMap((name) => {
    const f = typed.find((t) => t.name === name)
    return f ? flat(f, 0) : [{ f: { name, type: "" }, depth: 0 }]
  })
})

const note = computed(() => (props.box ? props.model.notes[props.box.name] : undefined))
const actor = computed(() =>
  (slice.value.actors ?? [slice.value.actor])
    .map((id) => props.model.actors.find((a) => a.id === id)?.name)
    .flatMap((name) => (name === undefined ? [] : [words(name)]))
    .join(", "),
)
const mapping = computed(() =>
  props.box?.kind === "event" || props.box?.kind === "command"
    ? slice.value.mapping?.[props.box.name]
    : undefined,
)
const triggers = computed(() => {
  const t = slice.value.trigger
  return t ? (Array.isArray(t) ? t : [t]).map((x) => parse(x).name) : []
})

// The element's specifications, or the slice's when nothing is selected.
interface Group {
  column: number
  heading: string
  tests: { name: string; given: string[]; when: string; then: string[] }[]
}
const groups = computed<Group[]>(() => {
  const name = props.box?.name
  const out: Group[] = []
  for (const col of props.layout.columns) {
    const tests = name
      ? col.slice.tests.filter((t) =>
          [...t.given, t.when, ...t.then].some((c) => c && parseClause(c).name === name),
        )
      : col.index === props.column.index
        ? col.slice.tests
        : []
    if (tests.length === 0) continue
    const chapter = props.layout.chapters[col.chapter]?.title ?? ""
    out.push({
      column: col.index,
      heading: chapter ? `${chapter} › ${col.title}` : col.title,
      tests,
    })
  }
  return out
})

const isError = (clause: string) => clause.startsWith("Error:")
/** The JSON says `Error:`; the model and the manual say rejected. A name reads as words. */
const show = (clause: string) => {
  const { name } = parseClause(clause)
  const named = clause.startsWith(name) ? words(name) + clause.slice(name.length) : clause
  return named.replace(/^Error:/, "Rejected:")
}
const mentions = (clause: string) =>
  props.box !== null && parseClause(clause).name === props.box.name
</script>

<template>
  <aside class="detail" aria-label="Details">
    <header>
      <span class="kind" :class="box?.kind ?? 'slice'">{{ box ? KIND[box.kind] : "slice" }}</span>
      <h2><Name v-if="box" :name="box.name" /><template v-else>{{ column.title }}</template></h2>
      <button v-if="!open" class="open" type="button" title="Open the slice" @click="$emit('open')">Open</button>
      <button class="close" type="button" title="Close (Esc)" @click="$emit('close')">×</button>
    </header>

    <p v-if="note" class="note"><span class="badge" aria-hidden="true">i</span>{{ note }}</p>
    <Messages :messages="column.messages" :boxes="layout.boxes" />

    <template v-if="fields.fields.length">
      <h3>{{ box?.kind === "ui" ? "Query" : "Fields" }}</h3>
      <table>
        <tr v-for="({ f, depth }, i) in rows" :key="i">
          <td class="name" :style="{ paddingLeft: `${depth * 14}px` }">{{ f.name }}{{ f.optional ? "?" : "" }}</td>
          <td class="type">{{ f.type }}</td>
          <td class="hint">
            <template v-if="depth === 0 && fields.keys.includes(f.name)">key</template>
            <template v-else-if="depth === 0 && mapping?.[f.name]">{{ source(mapping[f.name]!) }}</template>
            <div v-if="f.description" class="said">{{ f.description }}</div>
          </td>
        </tr>
      </table>
    </template>

    <h3>Slice</h3>
    <dl>
      <dt>Name</dt>
      <dd><Name :name="column.label" /></dd>
      <template v-if="actor"><dt>Actor</dt><dd>{{ actor }}</dd></template>
      <template v-if="slice.ui"><dt>Service</dt><dd>{{ slice.ui }}</dd></template>
      <template v-if="slice.context?.length"><dt>Context</dt><dd>{{ slice.context.join(", ") }}</dd></template>
      <template v-if="slice.polls"><dt>Polls</dt><dd><Name :name="slice.polls" kind="readModel" /></dd></template>
      <template v-if="slice.reads?.length"><dt>Reads</dt><dd><Name v-for="r in slice.reads" :key="r" :name="r" kind="readModel" /></dd></template>
      <template v-if="triggers.length"><dt>On</dt><dd><Name v-for="t in triggers" :key="t" :name="t" /></dd></template>
    </dl>
    <p v-if="slice.note" class="note" style="margin-top: 10px"><span class="badge" aria-hidden="true">i</span>{{ slice.note }}</p>

    <template v-if="groups.length">
      <h3>Specifications</h3>
      <template v-for="g in groups" :key="g.column">
        <button v-if="box" type="button" class="group" @click="$emit('goto', g.column)">{{ g.heading }}</button>
        <div v-for="t in g.tests" :key="t.name" class="spec">
          <div class="name">{{ t.name }}</div>
          <div v-if="t.given.length" class="step">
            <span class="word">given</span>
            <span><code v-for="c in t.given" :key="c" :class="{ mark: mentions(c) }">{{ show(c) }}</code></span>
          </div>
          <div v-if="t.when" class="step">
            <span class="word">when</span>
            <span><code :class="{ mark: mentions(t.when) }">{{ show(t.when) }}</code></span>
          </div>
          <div class="step">
            <span class="word">then</span>
            <span>
              <code v-for="c in t.then" :key="c" :class="{ rejected: isError(c), mark: mentions(c) }">{{ show(c) }}</code>
            </span>
          </div>
        </div>
      </template>
    </template>
  </aside>
</template>
