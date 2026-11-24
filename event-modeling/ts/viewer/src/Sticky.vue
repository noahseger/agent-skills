<script setup lang="ts">
import { computed } from "vue"
import {
  NOTE_W,
  STICKY_HEAD,
  STICKY_HEAD_LINE,
  STICKY_LINE,
  STICKY_PAD,
  type Sticky,
} from "./layout.ts"

// A note on the canvas: square paper in its kind's colour, lighter than the card it is about, with
// a header naming what it is about, since it stands apart from it.
const props = defineProps<{ sticky: Sticky }>()
/** Where the text starts, under the header. */
const body = computed(
  () => STICKY_PAD + STICKY_HEAD + 8 + (props.sticky.head.length - 1) * STICKY_HEAD_LINE,
)
</script>

<template>
  <g class="sticky" :class="sticky.kind" :transform="`translate(${sticky.x} ${sticky.y})`" role="note" :aria-label="`${sticky.kind} note: ${sticky.text}`">
    <title>{{ sticky.text }}</title>
    <rect class="paper" :width="NOTE_W" :height="sticky.h" />
    <text v-for="(line, i) in sticky.head" :key="`h${i}`" class="head" :x="STICKY_PAD" :y="STICKY_PAD + 8 + i * STICKY_HEAD_LINE">{{ line }}</text>
    <text v-for="(line, i) in sticky.lines" :key="i" :x="STICKY_PAD" :y="body + i * STICKY_LINE">{{ line }}</text>
  </g>
</template>
