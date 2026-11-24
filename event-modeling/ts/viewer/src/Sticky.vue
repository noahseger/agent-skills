<script setup lang="ts">
import { STICKY_HEAD, STICKY_LINE, STICKY_PAD, type Sticky } from "./layout.ts"

// A note on the canvas: square paper in its kind's colour, lighter than the card it is about, with
// a header naming that card, since the rail sets it apart. A question or a critical note says so in
// words too, not only in colour.
defineProps<{ sticky: Sticky; x: number; w: number }>()
const LABEL = { question: "Question · ", critical: "Critical · ", info: "" } as const
</script>

<template>
  <g class="sticky" :class="sticky.kind" :transform="`translate(${x} ${sticky.y})`" role="note" :aria-label="`${sticky.kind} note: ${sticky.text}`">
    <title>{{ sticky.text }}</title>
    <rect class="paper" :width="w" :height="sticky.h" />
    <text class="head" :x="STICKY_PAD" :y="STICKY_PAD + 8">{{ LABEL[sticky.kind] }}{{ sticky.subject }}</text>
    <text v-for="(line, i) in sticky.lines" :key="i" :x="STICKY_PAD" :y="STICKY_PAD + STICKY_HEAD + 8 + i * STICKY_LINE">{{ line }}</text>
  </g>
</template>
