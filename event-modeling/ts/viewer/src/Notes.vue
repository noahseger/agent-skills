<script setup lang="ts">
import type { Note } from "../../src/types.ts"

// Notes in full, in the colours of their stickies on the canvas.
defineProps<{ notes: readonly Note[] }>()
</script>

<template>
  <ul class="notes">
    <li v-for="(note, i) in notes" :key="i" class="sticky-note" :class="note.kind">
      <span v-if="note.kind !== 'info'" class="tag">{{ note.kind }}</span>
      {{ note.text }}
    </li>
  </ul>
</template>
