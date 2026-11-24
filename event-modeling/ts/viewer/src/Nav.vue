<script setup lang="ts">
import { computed } from "vue"
import type { Layout, Selection } from "./layout.ts"
import Mark from "./Mark.vue"

const props = defineProps<{ layout: Layout; selected: Selection | null }>()
const sel = computed(() => (typeof props.selected === "object" ? props.selected : null))
const selectedColumn = computed(() =>
  sel.value && "column" in sel.value ? sel.value.column : null,
)
const selectedChapter = computed(() =>
  sel.value && "chapter" in sel.value ? sel.value.chapter : null,
)
defineEmits<{ select: [column: number]; chapter: [chapter: number]; model: [] }>()
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
        :class="{ selected: ci === selectedChapter }"
        :aria-current="ci === selectedChapter ? 'true' : undefined"
        @click="$emit('chapter', ci)"
      >
        {{ chapter.title }}
      </button>
      <button
        v-for="col in layout.columns.filter((c) => c.chapter === ci)"
        :key="col.index"
        type="button"
        class="slice"
        :class="{ selected: col.index === selectedColumn, inside: chapter.title }"
        :aria-current="col.index === selectedColumn ? 'true' : undefined"
        @click="$emit('select', col.index)"
      >
        {{ col.title }}
        <span v-if="col.noted" class="note-dot" role="img" aria-label="Has a note"></span>
        <Mark :mark="col.mark" />
      </button>
    </template>
  </nav>
</template>
