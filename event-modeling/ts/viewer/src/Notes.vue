<script setup lang="ts">
import type { Note } from "../../src/types.ts"
import Mark from "./Mark.vue"

// Notes in full, in the colours of their stickies on the canvas.
defineProps<{ notes: readonly Note[] }>()
</script>

<template>
  <ul class="notes">
    <li v-for="(note, i) in notes" :key="i" class="said" :class="note.kind">
      <Mark :mark="note.kind" />
      <span>{{ note.text }}</span>
    </li>
  </ul>
</template>
