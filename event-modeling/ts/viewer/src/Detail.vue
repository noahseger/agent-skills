<script setup lang="ts">
import { computed } from "vue"
import type { Board, BoardField } from "./board.ts"
import { type Box, type Column, firstCard, KIND, type Layout, type Spec, source } from "./layout.ts"
import Messages from "./Messages.vue"
import Name from "./Name.vue"
import Notes from "./Notes.vue"
import SliceFacts from "./SliceFacts.vue"
import Specs from "./Specs.vue"

const props = defineProps<{
  box: Box | null
  column: Column
  layout: Layout
  model: Board
  /** Whether the slice is already open at full width. */
  open: boolean
}>()
const emit = defineEmits<{
  close: []
  open: []
  goto: [column: number]
  link: [canonical: string]
}>()
const slice = computed(() => props.column.slice)
// Everything said about the selected element, in whichever slice says it; a slice's own are in its facts.
const said = computed(() => {
  const name = props.box?.name
  if (!name) return []
  const all = [...props.layout.columns.flatMap((c) => c.messages), ...props.layout.model.messages]
  return [...new Set(all)].filter((m) => m.element === name)
})

// A compact card is a reference; its fields and notes are where the element is drawn in full.
const full = computed(() => {
  const box = props.box
  return box?.compact ? firstCard(props.layout, box.name) : box
})
const fields = computed(() => ({ fields: full.value?.fields ?? [], keys: full.value?.keys ?? [] }))

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

const mapping = computed(() =>
  props.box?.kind === "event" || props.box?.kind === "command"
    ? slice.value.mapping?.[props.box.name]
    : undefined,
)

// The element's specifications, its slice's first, or the slice's when nothing is selected. An
// opened slice shows its own beside this.
const groups = computed(() => {
  const name = props.box?.name
  const here = props.column.index
  const mine = (s: Spec) =>
    name ? s.steps.some((st) => st.cards.some((c) => c.name === name)) : s.column === here
  const columns = [
    ...props.layout.columns.filter((col) => col.index === here && !props.open),
    ...props.layout.columns.filter((col) => col.index !== here),
  ]
  return columns.flatMap((col) => {
    const specs = props.layout.specs.filter((s) => s.column === col.index && mine(s))
    if (specs.length === 0) return []
    const chapter = props.layout.chapters[col.chapter]?.title ?? ""
    return [
      { column: col.index, heading: chapter ? `${chapter} › ${col.title}` : col.title, specs },
    ]
  })
})
</script>

<template>
  <aside class="detail" aria-label="Details">
    <header>
      <span class="kind" :class="box?.kind ?? 'slice'">{{ box ? KIND[box.kind] : "slice" }}</span>
      <h2>
        <button v-if="!open" type="button" class="named link" title="Open the slice (Enter)" @click="$emit('open')"><Name v-if="box" :name="box.name" /><template v-else>{{ column.title }}</template></button>
        <template v-else><Name v-if="box" :name="box.name" /><template v-else>{{ column.title }}</template></template>
      </h2>
      <button class="close" type="button" title="Close (Esc)" @click="$emit('close')">×</button>
    </header>

    <SliceFacts v-if="!open && !box" :layout="layout" :column="column" />

    <template v-if="fields.fields.length">
      <h3>{{ box?.kind === "ui" ? "Query" : "Fields" }}</h3>
      <table>
        <tr v-for="({ f, depth }, i) in rows" :key="i">
          <td class="name" :style="{ paddingLeft: `${depth * 14}px` }">{{ f.name }}{{ f.optional ? "?" : "" }}</td>
          <td class="type">{{ f.type }}</td>
          <td class="hint">
            <span v-if="depth === 0 && fields.keys.includes(f.name)" class="kind" :class="box?.kind">KEY</span>
            <template v-else-if="depth === 0 && mapping?.[f.name]">{{ source(mapping[f.name]!) }}</template>
            <div v-if="f.description" class="said">{{ f.description }}</div>
          </td>
        </tr>
      </table>
    </template>

    <!-- A declaration in no slice has no slice to name. -->
    <template v-if="!open && box && layout.boxes.some((b) => b.column === column.index && b.id !== box?.id)">
      <h3>Slice</h3>
      <dl><dt>Name</dt><dd><Name :name="column.label" link @click="$emit('open')" /></dd></dl>
    </template>

    <template v-if="said.length">
      <h3>Validation</h3>
      <Messages :messages="said" :boxes="layout.boxes" :self="box?.name" />
    </template>

    <template v-if="full?.notes">
      <h3>Notes</h3>
      <Notes :notes="full.notes" />
    </template>

    <template v-if="groups.length">
      <h3>Specifications</h3>
      <template v-for="g in groups" :key="g.column">
        <Name v-if="box" class="group" :name="g.heading" link @click="$emit('goto', g.column)" />
        <Specs :specs="g.specs" :mark="box?.name" />
      </template>
    </template>
  </aside>
</template>
