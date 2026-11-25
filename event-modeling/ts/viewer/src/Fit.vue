<script setup lang="ts">
import { computed } from "vue"
import { type Font, fitLines } from "./layout.ts"
import { measure } from "./measure.ts"

// SVG text in the lines that fit its room, the last cut with "…"; cut, it keeps the whole as a tooltip.
const props = withDefaults(
  defineProps<{
    text: string
    room: number
    font: Font
    x: number
    lines?: number
    line?: number
  }>(),
  { lines: 1, line: 15 },
)
const shown = computed(() =>
  fitLines(props.text, props.room, props.lines, (s) => measure(s, props.font)),
)
const bare = (s: string) => s.replace(/\s/g, "")
const cut = computed(() => bare(shown.value.join("")) !== bare(props.text))
</script>

<template>
  <text :x="x">
    <title v-if="cut">{{ text }}</title>
    <tspan v-for="(l, i) in shown" :key="i" :x="x" :dy="i === 0 ? 0 : line">{{ l }}</tspan>
  </text>
</template>
