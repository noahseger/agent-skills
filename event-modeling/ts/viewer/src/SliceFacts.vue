<script setup lang="ts">
import { computed } from "vue"
import type { Note } from "../../src/types.ts"
import { type Column, KIND, type Kind, type Layout, source } from "./layout.ts"
import Messages from "./Messages.vue"
import Name from "./Name.vue"
import Notes from "./Notes.vue"

// What a slice says beyond its drawing, the same in the opened slice and the detail: its context,
// its mapping, its validation, then its notes and its elements', each under the element, as validation is.
const props = defineProps<{ layout: Layout; column: Column }>()

const slice = computed(() => props.column.slice)
const notes = computed(() => {
  const groups: { element: string; kind?: Kind; notes: Note[] }[] = []
  if (slice.value.notes?.length) groups.push({ element: "", notes: slice.value.notes })
  for (const b of props.layout.boxes)
    if (b.column === props.column.index && !b.compact && b.notes?.length)
      groups.push({ element: b.name, kind: b.kind, notes: b.notes })
  return groups
})
</script>

<template>
  <div class="facts">
    <dl v-if="slice.context?.length"><dt>Context</dt><dd>{{ slice.context.join(", ") }}</dd></dl>
    <template v-if="slice.mapping">
      <h3>Mapping</h3>
      <dl v-for="(fields, event) in slice.mapping" :key="event">
        <template v-for="(src, field) in fields" :key="field">
          <dt><Name :name="String(event)" />.{{ field }}</dt>
          <dd>{{ source(src) }}</dd>
        </template>
      </dl>
    </template>
    <template v-if="column.messages.length">
      <h3>Validation</h3>
      <Messages :messages="column.messages" :boxes="layout.boxes" />
    </template>
    <template v-if="notes.length">
      <h3>Notes</h3>
      <div v-for="g in notes" :key="g.element" class="about">
        <div v-if="g.element" class="element">
          <span v-if="g.kind" class="kind" :class="g.kind">{{ KIND[g.kind] }}</span>
          <Name :name="g.element" :kind="g.kind" />
        </div>
        <Notes :notes="g.notes" />
      </div>
    </template>
  </div>
</template>
