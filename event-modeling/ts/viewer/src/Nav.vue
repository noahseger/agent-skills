<script setup lang="ts">
import type { Layout } from "./layout.ts"

defineProps<{ layout: Layout; selectedColumn: number | null }>()
defineEmits<{ select: [column: number] }>()
</script>

<template>
  <nav class="nav" aria-label="Chapters and slices">
    <template v-for="(chapter, ci) in layout.chapters" :key="chapter.name + ci">
      <button
        type="button"
        class="chapter"
        @click="$emit('select', layout.columns.find((c) => c.chapter === ci)?.index ?? 0)"
      >
        {{ chapter.title }}
      </button>
      <button
        v-for="col in layout.columns.filter((c) => c.chapter === ci)"
        :key="col.index"
        type="button"
        class="slice"
        :class="{ selected: col.index === selectedColumn }"
        :aria-current="col.index === selectedColumn ? 'true' : undefined"
        @click="$emit('select', col.index)"
      >
        {{ col.title }}
        <span v-if="col.noted" class="note-dot" role="img" aria-label="Has a note"></span>
        <span v-if="col.warned" class="warn-dot" role="img" aria-label="Unfinished"></span>
      </button>
    </template>
    <p class="hint">← → to move between slices · Enter or double-click to open one · Esc to go back</p>
  </nav>
</template>
