<script setup lang="ts">
import type { Layout } from "./layout.ts"
import Mark from "./Mark.vue"

defineProps<{ layout: Layout; selected: number | "model" | null }>()
defineEmits<{ select: [column: number]; model: [] }>()
</script>

<template>
  <nav class="nav" aria-label="Chapters and slices">
    <button
      type="button"
      class="slice"
      :class="{ selected: selected === 'model' }"
      :aria-current="selected === 'model' ? 'true' : undefined"
      @click="$emit('model')"
    >
      Model
      <Mark :mark="layout.model.mark" />
    </button>
    <template v-for="(chapter, ci) in layout.chapters" :key="chapter.name + ci">
      <button
        v-if="chapter.title"
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
        :class="{ selected: col.index === selected, inside: chapter.title }"
        :aria-current="col.index === selected ? 'true' : undefined"
        @click="$emit('select', col.index)"
      >
        {{ col.title }}
        <span v-if="col.noted" class="note-dot" role="img" aria-label="Has a note"></span>
        <Mark :mark="col.mark" />
      </button>
    </template>
  </nav>
</template>
