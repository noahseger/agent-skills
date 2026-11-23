<script setup lang="ts">
import { STICKY_LINE, STICKY_PAD, type Sticky } from "./layout.ts"

// A note on the canvas: square paper in its kind's colour, so it reads as talk about the model.
defineProps<{ sticky: Sticky; x: number; w: number }>()
</script>

<template>
  <g class="sticky" :class="sticky.kind" :transform="`translate(${x} ${sticky.y})`" role="note" :aria-label="`${sticky.kind} note: ${sticky.text}`">
    <title>{{ sticky.text }}</title>
    <rect class="paper" :width="w" :height="sticky.h" />
    <text v-for="(line, i) in sticky.lines" :key="i" :x="STICKY_PAD" :y="STICKY_PAD + 9 + i * STICKY_LINE">{{ line }}</text>
  </g>
</template>
