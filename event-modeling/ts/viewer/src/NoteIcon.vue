<script setup lang="ts">
import type { NoteKind } from "../../src/types.ts"
import { ICON } from "./layout.ts"

// A kind of note as its icon, in the kind's colour: in the legend, and on a navigation row with notes.
defineProps<{ kind: NoteKind }>()
</script>

<template>
  <span class="note-icon" :class="kind" role="img" :aria-label="`${kind} note`">{{ ICON[kind] }}</span>
</template>
