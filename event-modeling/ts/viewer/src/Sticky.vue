<script setup lang="ts">
import { ICON, NOTE_PAD, NOTE_W, STICKY_LINE, type Sticky } from "./layout.ts"

// A note on the canvas: square paper in its kind's colour, lighter than the card it is about, level
// with it, its kind's icon starting its text.
defineProps<{ sticky: Sticky }>()
</script>

<template>
  <g class="sticky" :class="sticky.kind" :transform="`translate(${sticky.x} ${sticky.y})`" role="note" :aria-label="`${sticky.kind} note on ${sticky.subject}: ${sticky.text}`">
    <title>{{ sticky.subject }}: {{ sticky.text }}</title>
    <rect class="paper" :width="NOTE_W" :height="sticky.h" />
    <text v-for="(line, i) in sticky.lines" :key="i" :x="NOTE_PAD" :y="NOTE_PAD + 8 + i * STICKY_LINE"><template v-if="i === 0 && line.startsWith(ICON[sticky.kind])"><tspan class="icon">{{ ICON[sticky.kind] }}</tspan>{{ line.slice(ICON[sticky.kind].length) }}</template><template v-else>{{ line }}</template></text>
  </g>
</template>
