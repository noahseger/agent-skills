<script setup lang="ts">
import { computed } from "vue"
import { type Column, type Layout, source } from "./layout.ts"
import Messages from "./Messages.vue"
import Name from "./Name.vue"

// What a slice says beyond the board: its context, its mapping and its validation. Its notes are on the board.
const props = defineProps<{ layout: Layout; column: Column }>()

const slice = computed(() => props.column.slice)
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
  </div>
</template>
