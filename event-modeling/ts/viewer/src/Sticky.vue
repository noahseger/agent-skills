<script setup lang="ts">
import { NOTE_PAD, NOTE_W, STICKY_LINE, type Sticky } from "./layout.ts"
import Mark from "./Mark.vue"

// A note on the canvas: square paper in its kind's colour, lighter than the card it is about, level
// with it, its kind's badge on its top-left corner, level with the title of what it is about.
defineProps<{ sticky: Sticky }>()
</script>

<template>
  <g class="sticky" :class="sticky.kind" :transform="`translate(${sticky.x} ${sticky.y})`" role="note" :aria-label="`${sticky.kind} note on ${sticky.subject}: ${sticky.text}`">
    <title>{{ sticky.subject }}: {{ sticky.text }}</title>
    <rect class="paper" :width="NOTE_W" :height="sticky.h" />
    <text v-for="(line, i) in sticky.lines" :key="i" :x="NOTE_PAD" :y="NOTE_PAD + 8 + i * STICKY_LINE">{{ line }}</text>
    <Mark :mark="sticky.kind" :at="[0, 0]" />
  </g>
</template>
