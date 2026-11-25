<script setup lang="ts">
import { MARK_R, NOTE_PAD, NOTE_TEXT_X, NOTE_W, STICKY_LINE, type Sticky } from "./layout.ts"
import Mark from "./Mark.vue"

// A note on the canvas: square paper in its kind's colour, lighter than the card it is about, level
// with it: its kind's badge, then its text, as in a panel.
defineProps<{ sticky: Sticky }>()
</script>

<template>
  <g class="sticky" :class="sticky.kind" :transform="`translate(${sticky.x} ${sticky.y})`" role="note" :aria-label="`${sticky.kind} note on ${sticky.subject}: ${sticky.text}`">
    <title>{{ sticky.subject }}: {{ sticky.text }}</title>
    <rect class="paper" :width="NOTE_W" :height="sticky.h" />
    <Mark :mark="sticky.kind" :at="[NOTE_PAD + MARK_R, NOTE_PAD + 8 - 0.27 * 9]" />
    <text v-for="(line, i) in sticky.lines" :key="i" :x="NOTE_TEXT_X" :y="NOTE_PAD + 8 + i * STICKY_LINE">{{ line }}</text>
  </g>
</template>
