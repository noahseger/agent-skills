<script setup lang="ts">
import { NOTE_W, STICKY_LINE, STICKY_PAD, type Sticky } from "./layout.ts"

// A note on the canvas: square paper in its kind's colour, lighter than the card it is about, level
// with it, its kind's icon starting its text.
defineProps<{ sticky: Sticky }>()
</script>

<template>
  <g class="sticky" :class="sticky.kind" :transform="`translate(${sticky.x} ${sticky.y})`" role="note" :aria-label="`${sticky.kind} note on ${sticky.subject}: ${sticky.text}`">
    <title>{{ sticky.subject }}: {{ sticky.text }}</title>
    <rect class="paper" :width="NOTE_W" :height="sticky.h" />
    <text v-for="(line, i) in sticky.lines" :key="i" :x="STICKY_PAD" :y="STICKY_PAD + 8 + i * STICKY_LINE">{{ line }}</text>
  </g>
</template>
