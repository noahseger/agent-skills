<script setup lang="ts">
import type { Mark, Pt } from "./layout.ts"

// An error is a red disc with "!"; a warning, a grey ring; done, nothing. In a drawing, `at` places it.
defineProps<{ mark?: Mark | undefined; at?: Pt }>()

const SAID: Record<Mark, string> = { error: "Has an error", warning: "Unfinished" }
</script>

<template>
  <g v-if="mark && at" :class="`mark-${mark}`" :transform="`translate(${at[0]} ${at[1]})`" role="img" :aria-label="SAID[mark]">
    <circle :r="mark === 'error' ? 7 : 5.5" />
    <text v-if="mark === 'error'" text-anchor="middle" y="3.5">!</text>
  </g>
  <span v-else-if="mark" :class="`mark-${mark}`" role="img" :aria-label="SAID[mark]"></span>
</template>
