<script setup lang="ts">
import { STICKY_LINE, STICKY_PAD, type Sticky } from "./layout.ts"

// A note on the canvas: a sticky in its kind's colour, its corner folded.
defineProps<{ sticky: Sticky; x: number; w: number }>()
const FOLD = 7
</script>

<template>
  <g class="sticky" :class="sticky.kind" :transform="`translate(${x} ${sticky.y})`" role="note" :aria-label="`${sticky.kind} note: ${sticky.text}`">
    <title>{{ sticky.text }}</title>
    <path class="paper" :d="`M0 0 H${w} V${sticky.h - FOLD} L${w - FOLD} ${sticky.h} H0 Z`" />
    <path class="fold" :d="`M${w} ${sticky.h - FOLD} H${w - FOLD} V${sticky.h} Z`" />
    <text v-for="(line, i) in sticky.lines" :key="i" :x="STICKY_PAD" :y="STICKY_PAD + 9 + i * STICKY_LINE">{{ line }}</text>
  </g>
</template>
