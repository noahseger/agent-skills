<script setup lang="ts">
import type { Layout } from "./layout.ts"

defineProps<{ layout: Layout; selectedColumn: number | null }>()
defineEmits<{ select: [column: number] }>()
</script>

<template>
  <nav class="nav">
    <template v-for="(chapter, ci) in layout.chapters" :key="chapter.name + ci">
      <div class="chapter">{{ chapter.name }}</div>
      <button
        v-for="col in layout.columns.filter((c) => c.chapter === ci)"
        :key="col.index"
        type="button"
        class="slice"
        :class="{ selected: col.index === selectedColumn }"
        @click="$emit('select', col.index)"
      >
        {{ col.label }}
        <span v-if="col.noted" class="note-dot"></span>
      </button>
    </template>
    <p class="hint">← → move between slices</p>
  </nav>
</template>
