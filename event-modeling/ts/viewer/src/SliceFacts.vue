<script setup lang="ts">
import { computed } from "vue"
import type { Board } from "./board.ts"
import { actorOf, type Column, firstCard, type Layout, parse, served, source } from "./layout.ts"
import Messages from "./Messages.vue"
import Name from "./Name.vue"
import Notes from "./Notes.vue"

// What a slice is, the same wherever it shows, the opened slice and the detail: who and what
// it reads, its mapping, its validation (errors and warnings), then its notes, above its specifications.
const props = defineProps<{ model: Board; layout: Layout; column: Column }>()
const emit = defineEmits<{ link: [canonical: string] }>()

const slice = computed(() => props.column.slice)
const who = computed(() => actorOf(props.model, slice.value))
const triggers = computed(() => {
  const t = slice.value.trigger
  return t ? (Array.isArray(t) ? t : [t]).map((x) => parse(x).name) : []
})
function follow(name: string) {
  const id = firstCard(props.layout, name)?.id
  if (id) emit("link", id)
}
</script>

<template>
  <div class="facts">
    <dl>
      <template v-if="who.actor"><dt>Actor</dt><dd>{{ who.actor }}</dd></template>
      <template v-if="who.from"><dt>From</dt><dd>{{ who.from }}</dd></template>
      <template v-if="served(slice)"><dt>Service</dt><dd>{{ slice.ui }}</dd></template>
      <template v-if="slice.context?.length"><dt>Context</dt><dd>{{ slice.context.join(", ") }}</dd></template>
      <template v-if="slice.polls"><dt>Polls</dt><dd><Name :name="slice.polls" link @click="follow(slice.polls)" /></dd></template>
      <template v-if="slice.reads?.length">
        <dt>Reads</dt>
        <dd><Name v-for="r in slice.reads" :key="r" :name="r" link @click="follow(r)" /></dd>
      </template>
      <template v-if="triggers.length">
        <dt>On</dt>
        <dd><Name v-for="t in triggers" :key="t" :name="t" link @click="follow(t)" /></dd>
      </template>
    </dl>
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
    <template v-if="slice.notes">
      <h3>Notes</h3>
      <Notes :notes="slice.notes" />
    </template>
  </div>
</template>
